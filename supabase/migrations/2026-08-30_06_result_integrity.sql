-- ===========================================================================
-- LifePatch — the `results` write surface, and two tables with no ceiling.
--
-- Safe to run at any time, before or after a deploy, and idempotent. Nothing
-- here changes what any client can READ, so no build depends on it and no build
-- breaks without it. There is no deploy order: unlike 05, this file takes away
-- nothing the app uses.
--
-- One theme, carried on from `2026-08-28_04_write_surface.sql`: a policy answers
-- WHICH ROW and never WHICH COLUMN, and a column with no CHECK is a column the
-- client defines. 04 applied that reading to `profiles` and `saves`. `results`,
-- `streaks` and `mastery` were left on the old footing, and this is them.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. A result row may not choose its own timestamp, or its own URL.
--
-- `results - insert own` constrains whose row you write and says nothing about
-- which columns. Supabase's default privileges hand `authenticated` table-wide
-- INSERT, so a player posting straight at PostgREST names `created_at` and `id`
-- as freely as they name their score.
--
-- WHAT THAT BUYS THEM. `topResults` filters the weekly board with
-- `gte("created_at", weekAgoIso())`, and a timestamp in the year 3000 is inside
-- every week that will ever be computed: the row takes permanent first place on
-- *This week* and no honest run can age it out. `metrics.daily` is the same axis
-- for the Daily Ledger board. And `id` is the `/r/{id}` slug — the address the
-- player's "statement" is served from on this origin — which a client picking
-- its own UUID gets to choose.
--
-- THE FIX IS THE ONE `profiles` GOT: a table grant traded for a column list.
-- Same mechanics, same order, and for the same reason 04 §2 spells out —
-- PostgreSQL will not let a column-level REVOKE carve an exception out of a
-- table-level grant, so the table grant goes first and the columns come back.
--
-- The five columns granted are exactly the five `submitResult` writes
-- (lib/cloud/results.ts). `id` and `created_at` fall to their defaults, which is
-- what they already did for every honest row ever written — so this changes no
-- behaviour the app has.
--
-- UPDATE goes too, and is a different kind of statement. `results` carries no
-- UPDATE policy at all, so RLS already refuses every update from these roles and
-- the grant has never done anything. Removing a privilege that is inert today is
-- how it stays inert after the next policy is added by someone reading the
-- policies rather than the grants.
--
-- `anon` is named for completeness and gets nothing back. The row policy asserts
-- `auth.uid() = user_id`, which an anonymous request can never satisfy, so these
-- statements remove a grant that was never reachable.
-- ---------------------------------------------------------------------------
revoke insert on public.results from authenticated;
revoke insert on public.results from anon;
revoke update on public.results from authenticated;
revoke update on public.results from anon;
grant insert (user_id, mode, score, verdict, metrics) on public.results to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Two integer columns nobody bounded.
--
-- `results.score` got `results_score_sane` in `2026-08-27_01b_score_bounds.sql`
-- for a documented reason. `streaks` never did, and it is the more exposed of the
-- two: `current` and `longest` are plain `int` under an update-own policy, and the
-- table is PUBLICLY READABLE by design so friends can see each other's streaks. One
-- PATCH puts 2,147,483,647 in `StreakChip` and beside that player's leaderboard row.
--
-- Nothing ranks on a streak, so this is cosmetic rather than competitive — which is
-- exactly why it is a CHECK and not a redesign. 100,000 days is 273 years: past any
-- streak a living player can hold and far short of anything that reads as a number
-- the game printed by accident.
--
-- `longest >= current` is the invariant `nextStreak` (lib/cloud/streaks.ts) has
-- always maintained — `longest: Math.max(prev.longest, current)` — and which nothing
-- outside that function was ever required to respect.
--
-- `mastery.level` has the same gap with a smaller blast radius: the table is
-- read-own-only, so a forged level is visible to the forger and nobody else. It is
-- bounded here anyway because the bound is free and the number is already written
-- down — MAX_MASTERY_LEVEL in lib/cloud/mastery.ts.
-- CHANGING MAX_MASTERY_LEVEL NOW NEEDS A MIGRATION alongside the code change.
--
-- REPAIR BEFORE CONSTRAIN. `alter table ... add constraint` validates existing rows
-- and fails on the first one that does not conform, which would leave this file
-- half-applied on any database that already carries a forged value. Clamping first
-- makes the file safe to run against a live table in any state. Both updates are
-- no-ops on conforming rows — the `where` clauses see to that — so this costs one
-- indexless pass over two small tables and nothing else.
-- ---------------------------------------------------------------------------
update public.streaks
   set current = least(greatest(current, 0), 100000),
       longest = greatest(
         least(greatest(longest, 0), 100000),
         least(greatest(current, 0), 100000)
       )
 where current < 0 or current > 100000
    or longest < 0 or longest > 100000
    or longest < current;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.streaks'::regclass and conname = 'streaks_sane'
  ) then
    alter table public.streaks add constraint streaks_sane check (
      current between 0 and 100000
      and longest between 0 and 100000
      and longest >= current
    );
  end if;
end $$;

update public.mastery
   set level = least(greatest(level, 0), 5)
 where level < 0 or level > 5;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.mastery'::regclass and conname = 'mastery_level_sane'
  ) then
    alter table public.mastery add constraint mastery_level_sane check (level between 0 and 5);
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 3. A ceiling on how many rows one player can leave behind.
--
-- `saves` is bounded two ways — `unique (user_id, mode)` caps the count and
-- `saves_state_small` caps the size. `results` is bounded per row (8 KiB, by
-- `results_metrics_small`) and not at all per player: one account can insert
-- indefinitely, nothing prunes, and there is no cost ceiling. Section 1 removes the
-- forged half of that; this is the unforged half, which is just as unmetered.
--
-- WHY A PRUNE AND NOT A REFUSAL. Refusing the insert past the cap is the smaller
-- piece of code and the worse behaviour: the player it eventually stops is the one
-- who plays the most, and it stops them by silently declining to record a run they
-- finished honestly. Deleting surplus is the failure that falls on the abusive
-- account first and on the dedicated player last.
--
-- WHICH ROWS GO, AND THE ONE THAT NEVER DOES. Oldest first — a shared /r/{id} link
-- gets its traffic in a burst right after the run (the reasoning app/api/og/[id]
-- already carries about its own cache TTL), so the oldest rows are the ones whose
-- links have already been spent.
--
-- But oldest-first alone would eventually delete a player's BEST run and quietly
-- demote them on a board that ranks each player by exactly that row — a leaderboard
-- that forgets your best result is worse than the storage it saves. So the best
-- rankable row for that (user_id, mode) is spared unconditionally, whatever its age.
--
-- "Rankable" is the same test `lib/cloud/results.ts` applies before ranking: a NaN
-- score sorts ABOVE every real number in Postgres, so `order by score desc` alone
-- would nominate a garbage row as the one to protect forever. `score < 1e15` is
-- false for NaN, which is the same asymmetry `results_score_sane` relies on.
--
-- 500 per (user_id, mode) is ~83 hours of finished Story runs in one mode. Worst
-- case per account is 3 modes x 500 rows: ~2.8 MiB of honest rows (the measured
-- 100-point row is 1,867 bytes) and 12 MiB if every row is filled to the 8 KiB
-- ceiling. A player at 12 MiB has done something on purpose.
--
-- SECURITY DEFINER, deliberately. The cap is a schema invariant, not a user action.
-- Under `security invoker` the prune would run with the inserting role's own DELETE
-- privilege — so the day someone revokes DELETE on `results` from `authenticated`
-- (a plausible next hardening; nothing in the app deletes a result), every insert
-- would start failing instead. The function cannot be pointed anywhere: both keys
-- come from NEW, and NEW.user_id is already pinned to `auth.uid()` by the insert
-- policy.
--
-- NO ONE-TIME PRUNE. A table that is already over the cap is brought down to it by
-- the next insert for that (user_id, mode) — `surplus` is computed, not assumed —
-- so this file deletes nothing on the way in. A migration that silently drops rows
-- is a migration nobody can safely re-read.
-- ---------------------------------------------------------------------------
create or replace function public.results_cap_per_player()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cap constant int := 500;
  surplus int;
  keep_id uuid;
begin
  select count(*) - cap + 1 into surplus
    from public.results r
   where r.user_id = new.user_id and r.mode = new.mode;

  if surplus is null or surplus <= 0 then
    return new;
  end if;

  -- The player's best RANKABLE run for this mode. `score < 1e15` excludes NaN,
  -- which would otherwise sort first and be protected forever.
  select r.id into keep_id
    from public.results r
   where r.user_id = new.user_id and r.mode = new.mode
     and r.score > -1e15 and r.score < 1e15
   order by r.score desc, r.created_at asc, r.id asc
   limit 1;

  delete from public.results d
   where d.id in (
     select r.id
       from public.results r
      where r.user_id = new.user_id and r.mode = new.mode
        and (keep_id is null or r.id <> keep_id)
      -- `id` as a second key so the choice is total: `created_at` alone ties for
      -- rows written in the same millisecond and would leave the planner to pick.
      order by r.created_at asc, r.id asc
      limit surplus
   );

  return new;
end;
$$;

-- Hygiene, matching the two helpers in schema.sql: a new function is granted to
-- PUBLIC by default and `anon` inherits it, so PUBLIC is revoked first. A trigger
-- function is invoked by the trigger and not by a caller, so this removes a door
-- rather than closing one that was in use.
revoke all on function public.results_cap_per_player() from public;
revoke all on function public.results_cap_per_player() from anon;
revoke all on function public.results_cap_per_player() from authenticated;

drop trigger if exists results_cap_per_player on public.results;
create trigger results_cap_per_player
  before insert on public.results
  for each row execute function public.results_cap_per_player();


-- ---------------------------------------------------------------------------
-- What is deliberately NOT here.
--
-- No `check (created_at <= now())`. The grant in §1 is the fix; a CHECK on a column
-- the client can no longer name would be a second lock on a door that has none.
--
-- No rate limit on inserts. That is a shape the database is bad at and PostgREST
-- gives no hook for — it belongs beside the username gate, in an Edge Function, on
-- the day results stop being a direct write. §3 bounds the standing cost, which is
-- the part that compounds.
--
-- No DELETE change. `results - delete own` stays: a player removing their own run is
-- a feature, and app/api/og/[id] already carries the cache reasoning for a row that
-- can disappear.
-- ---------------------------------------------------------------------------
