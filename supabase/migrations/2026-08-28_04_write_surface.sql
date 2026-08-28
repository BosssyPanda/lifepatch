-- ===========================================================================
-- LifePatch — narrowing the client's WRITE surface.
--
-- Safe to run at any time, before or after a deploy, and idempotent. Nothing
-- here changes what any client can READ, so no build depends on it and no build
-- breaks without it.
--
-- Two findings, one theme: the tables a browser writes to directly were trusted
-- to send only what the app sends. `results` was hardened on exactly this
-- reasoning ("the writer caps the series at 100 points, but that cap lives only
-- in the client") and the two surfaces below were left on the old footing.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. `saves.state` is the one client-written column with no size limit.
--
-- `results` carries three CHECKs on the way in — `results_metrics_small`,
-- `results_metrics_history_bounded`, `results_score_sane`. `saves.state` is
-- written by the same client, through the same PostgREST endpoint, under a
-- policy that constrains WHOSE row it is and nothing whatsoever about what is
-- in it.
--
-- So an authenticated account can PATCH a multi-megabyte `state`, once per
-- mode, on repeat. Nothing renders another player's save, so this is not a
-- leaderboard problem — it is unmetered storage on the project, and `loadRun`
-- pulls whatever is there straight back into memory on the next resume.
--
-- 256 KiB is generous against a real run (a 21-year story state with its
-- journal is a few KB) and refuses the abuse by three orders of magnitude.
--
-- `not valid` is safe here, unlike the username trap migration 01 §6
-- documents: every update to this table rewrites `state` itself, so a
-- conforming write always passes the constraint even while old rows are
-- unchecked. Validated at the end of this file — the table is small enough
-- that there is no reason to defer it.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.saves'::regclass and conname = 'saves_state_small'
  ) then
    alter table public.saves
      add constraint saves_state_small check (pg_column_size(state) <= 262144) not valid;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. A player may not choose their own capability token.
--
-- `profiles` is written directly by the browser under a policy that asserts
-- only `auth.uid() = id`. That is the right rule for WHICH row, and no rule at
-- all about which COLUMNS — so one PATCH lets a player set their own
-- `friend_code`, which `schema.sql` calls "the sole capability guarding
-- addByCode" and which migration 02 exists because it was once enumerable.
-- Picking your own guessable token defeats the whole point of minting it from
-- a CSPRNG.
--
-- `avatar_seed` goes with it for the same structural reason rather than a
-- security one: both are written exactly once, by `ensureProfile`'s INSERT, and
-- no code path in the app updates either afterwards. Revoking UPDATE on a
-- column nothing updates costs nothing and removes it from the attack surface.
--
-- INSERT is untouched — `ensureProfile` still mints all three on the way in.
-- `username` stays updatable: `updateUsername` is a real feature, and it is the
-- only column any code path updates.
--
-- IT HAS TO BE DONE THIS WAY ROUND. Both roles currently hold TABLE-level
-- UPDATE on `public.profiles`, and PostgreSQL will not let a column-level
-- REVOKE carve an exception out of a table-level grant — `revoke update
-- (friend_code) …` against a table-wide UPDATE raises a warning and changes
-- nothing at all. Verified against this project before writing it: every role
-- shows `UPDATE` at table level as well as per column. So the table grant goes
-- first, and exactly one column comes back.
--
-- `anon` gets nothing back. The row policy already requires `auth.uid() = id`,
-- which an anonymous request can never satisfy, so the grant was never doing
-- any work for it.
-- ---------------------------------------------------------------------------
revoke update on public.profiles from authenticated;
revoke update on public.profiles from anon;
grant update (username) on public.profiles to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Validate the size constraint.
--
-- Separate statement so a failure here names the offending rows without
-- rolling back the grant changes above. If it fails, the audit query is:
--   select user_id, mode, pg_column_size(state) from public.saves
--    where pg_column_size(state) > 262144;
-- ---------------------------------------------------------------------------
alter table public.saves validate constraint saves_state_small;


-- ---------------------------------------------------------------------------
-- What is deliberately NOT here: a SQL mirror of the username word list.
--
-- `lib/cloud/profanity.ts` folds case, leetspeak, separators and repeated
-- letters before matching, and carries an ALLOW list without which it rejects
-- "Scunthorpe" and "titan-grape" (the QA gate exists because the first draft
-- did exactly that). A hand-translated second copy of that algorithm would
-- diverge from the first one, and a server check that disagrees with the client
-- is worse than no server check: it rejects names the player was just told were
-- fine. The charset CHECK — `profiles_username_charset`, added in migration 01
-- — remains the load-bearing server-side rule, and closing the word-list gap
-- properly means one implementation behind an Edge Function, not two.
-- ---------------------------------------------------------------------------
