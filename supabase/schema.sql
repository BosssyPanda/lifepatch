-- LifePatch cloud saves. Run this in the Supabase SQL editor.
--
-- This is the FRESH-INSTALL file: it describes the schema as it should be on a
-- new project. If you already ran an older copy of it against a live database,
-- do NOT re-run this one — apply the files in supabase/migrations/ in order
-- instead. They reach the same end state without touching your data, and 02, 05
-- and 07 each have a deploy-ordering requirement this file does not — 05 wants the
-- `profile` function live first, 07 wants to land before it is redeployed. (03 is the one
-- exception: it rotates live friend codes, so it is opt-in and its header says when.)
--
-- EITHER WAY, DEPLOY THE `profile` EDGE FUNCTION. Nothing but the service role may
-- write `profiles` in the schema below, so `supabase/functions/profile` is what
-- creates and renames players. Without it a fresh signup gets no profile row.
--
--   supabase functions deploy profile --project-ref <ref>

create table if not exists public.saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('story', 'infinite')),
  state jsonb not null,
  -- The one client-written column with no shape to constrain, so bound its size
  -- instead. `results` carries three CHECKs on the way in; this table is written
  -- by the same browser, through the same endpoint, under a policy that says
  -- whose row it is and nothing whatsoever about what is in it. A 21-year story
  -- state with its journal is a few KB, so 256 KiB is generous against a real run
  -- by three orders of magnitude and still refuses a save slot used as unmetered
  -- storage — which `loadRun` would then pull straight back into memory.
  constraint saves_state_small check (pg_column_size(state) <= 262144),
  updated_at timestamptz not null default now(),
  unique (user_id, mode)
);

alter table public.saves enable row level security;

-- Each user can only see and write their own saves.
create policy "own saves - select" on public.saves
  for select using (auth.uid() = user_id);

create policy "own saves - insert" on public.saves
  for insert with check (auth.uid() = user_id);

create policy "own saves - update" on public.saves
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own saves - delete" on public.saves
  for delete using (auth.uid() = user_id);

-- ===========================================================================
-- LifePatch v2 — social, competitive & mastery layer.
-- All tables are pseudonymous: usernames only, no real names/PII, no chat.
-- ===========================================================================

-- Public-facing player identity. Username + avatar are pseudonymous.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 24),
  -- The charset is the real defence on a name that renders publicly: it refuses
  -- zero-width joiners, RTL overrides, combining marks and Unicode homoglyphs —
  -- the tools for impersonating another player on the leaderboard. Word-level
  -- screening is the shared word list at supabase/functions/_shared/username.ts,
  -- which the `profile` Edge Function runs server-side; this is the half that has
  -- to hold at the database whatever the caller did or did not run.
  constraint profiles_username_charset
    check (username ~ '^[A-Za-z0-9][A-Za-z0-9 _-]{1,22}[A-Za-z0-9]$'),
  avatar_seed text not null,
  friend_code text not null unique,
  created_at timestamptz not null default now(),
  -- Where the `profile` function's rename limiter keeps score. `rename` answers 409
  -- for "taken" and 400 for "the filter refuses that", and two distinguishable
  -- answers plus unlimited attempts is an oracle for who exists. The answers stay
  -- honest — a player who picks a taken name has to be told it is taken — and the
  -- ATTEMPTS are bounded instead, at five an hour.
  --
  -- In the database rather than in the function because an Edge Function is
  -- stateless and horizontally scaled: an in-memory counter enforces "five per hour
  -- per isolate you happen to land on", which is not a limit. Written only by the
  -- service role, like `username` itself; `read own` keeps both off every other
  -- player's screen and `profiles_public` projects neither.
  rename_window_start timestamptz,
  rename_attempts int not null default 0
);

alter table public.profiles enable row level security;

-- You read your OWN row, and only your own. Everyone else's public columns come
-- from `profiles_public` below.
--
-- This used to be `using (true)` under a comment reading "leaderboards show
-- username + avatar only" — an accurate description of the intent and of nothing
-- the SQL did. RLS cannot project columns, so granting the row granted
-- `friend_code` with it, to anyone holding the publishable key (i.e. every
-- browser). That made the entire player base and all of its codes enumerable,
-- which voids the one property the friends feature rests on: "added by code,
-- never by search".
create policy "profiles - read own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles - insert own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles - update own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Belt and braces: RLS already refuses an anonymous caller (no auth.uid(), so
-- "read own" matches nothing). This makes it a grant-level fact instead, so a
-- future policy edit cannot quietly re-open the table.
revoke select on public.profiles from anon;

-- WHICH ROW is a policy question; WHICH COLUMNS is a grant question, and the
-- policy above only ever answered the first. `friend_code` is the sole capability
-- guarding addByCode, and letting a player PATCH their own to a value they picked
-- defeats the CSPRNG that mints it. `avatar_seed` goes with it for a structural
-- reason rather than a security one: both are written exactly once, by
-- `ensureProfile`'s INSERT, and no code path updates either afterwards.
--
-- It has to be this way round. A column-level REVOKE cannot carve an exception
-- out of a table-level grant: Supabase's default privileges hand `authenticated`
-- table-wide UPDATE, and `revoke update (friend_code) ...` against that raises a
-- warning and changes nothing at all. So the table grant goes and exactly one
-- column comes back. INSERT is untouched, so `ensureProfile` still mints all
-- three; `username` stays updatable because `updateUsername` is a real feature
-- and the only column any code path updates.
revoke update on public.profiles from authenticated;
revoke update on public.profiles from anon;

-- And `username` goes the same way, which leaves nothing writable here at all.
--
-- Screening ran in the browser and nowhere else, so it applied to everyone except
-- the person who did not run it: one PATCH, or more easily one INSERT at signup,
-- put any string on the public leaderboard. The charset CHECK above holds at the
-- database and always did — it refuses the homoglyphs and RTL overrides a word list
-- cannot address anyway — but the word list itself had no server-side half.
--
-- It does now, and it is the SAME half: supabase/functions/_shared/username.ts is
-- one module that the browser and the `profile` Edge Function both import. A SQL
-- translation of it would have been a second implementation, and two copies of that
-- normalisation drift until the server starts refusing names the browser has just
-- accepted.
--
-- The three policies above are untouched and still correct. They answer WHICH ROW;
-- this answers WHICH VALUE, which no policy could. The Edge Function writes with the
-- service role and so passes both.
revoke insert on public.profiles from authenticated;
revoke insert on public.profiles from anon;

-- The public projection. `security_invoker = off` is deliberate and load-bearing:
-- the view runs as its owner, so it sees past the row-level policy above and can
-- still show every player on a leaderboard. It is also the default, written out
-- so it reads as a decision. friend_code is NOT here and must never be added.
create or replace view public.profiles_public
  with (security_invoker = off) as
  select id, username, avatar_seed, created_at
  from public.profiles;

-- REVOKE FIRST, and never collapse these two lines into the grant alone. A view
-- created in `public` inherits Supabase's stock `grant all on all tables in
-- schema public to anon, authenticated`, and a `grant` cannot narrow what is
-- already held. Left as-is this view is auto-updatable (a bare projection of one
-- table) AND runs as its owner, so an inherited UPDATE or DELETE is a straight
-- bypass of the row policy on `profiles` — the exact hole the lockdown closes.
-- See 2026-09-02_08_profiles_public_readonly.sql.
revoke all on public.profiles_public from anon, authenticated;
grant select on public.profiles_public to anon, authenticated;

-- Code lookup as a point query: one row in, at most one row out, and never the
-- code itself — so a result cannot seed the next lookup and there is no filter,
-- offset or ordering with which to walk the table.
create or replace function public.profile_by_friend_code(code text)
returns table (id uuid, username text, avatar_seed text)
language sql security definer stable
set search_path = public
as $$
  select p.id, p.username, p.avatar_seed
  from public.profiles p
  where p.friend_code = upper(trim(code))
  limit 1;
$$;

-- A new function is granted to PUBLIC by default and `anon` inherits that, so
-- revoking from `anon` alone would leave the grant standing. Revoke PUBLIC first.
revoke all on function public.profile_by_friend_code(text) from public;
revoke all on function public.profile_by_friend_code(text) from anon;
grant execute on function public.profile_by_friend_code(text) to authenticated;

-- One row per finished run. Drives leaderboards + shareable result cards.
create table if not exists public.results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('story', 'infinite', 'cashflow')),
  -- Bounded because `numeric` is not. Postgres orders NaN ABOVE every real
  -- number, so one hand-posted `{"score": "NaN"}` takes permanent first place on
  -- `order by score desc` and no honest run can displace it; a 100,001-digit
  -- integer inserts just as happily and reaches the client as `Infinity`. Watch
  -- which test does the work: for `numeric`, `'NaN' = 'NaN'` is TRUE, so only the
  -- upper bound refuses NaN. ±1e15 clears the largest score 12,000 headless
  -- Infinite runs could produce (15,511,231,154) by ~64,000x — see
  -- supabase/migrations/2026-08-27_01b_score_bounds.sql for the measurement, and
  -- engine-props P15 for the check that keeps it honest.
  score numeric not null constraint results_score_sane check (
    score > -1e15 and score < 1e15
  ),
  -- The closed set the game can actually produce: lib/verdict.ts VERDICTS (six
  -- life-sim archetypes) plus the three Rat Race strings in lib/cloud/buildResult.ts.
  -- Unconstrained, this column let any account mint an official-looking
  -- "statement" on your own domain — it is the <h1> of /r/{id}, the page <title>
  -- and og:description, and up-to-118px display type on the generated OG image.
  -- Not XSS (React and Satori both escape); content injection on a trusted origin.
  -- ADDING OR RENAMING A VERDICT NOW NEEDS A MIGRATION alongside the code change.
  verdict text not null constraint results_verdict_known check (
    verdict in (
      'Financially Free', 'Comfortable', 'Rich Enough',
      'Getting By', 'Underwater', 'The Estate',
      'Escaped the Rat Race', 'Still Racing', 'Buried in Debt'
    )
  ),
  -- The writer caps the net-worth series at 100 points, but that cap lives only
  -- in the client. A row posted straight at PostgREST with a 100,000-element
  -- `history` becomes six figures of SVG geometry on an unauthenticated page —
  -- a bandwidth amplifier pointed at your own bill. 8 KiB is ~6x the largest
  -- honest row (~1.3 KiB) and still refuses that by three orders of magnitude.
  metrics jsonb not null default '{}'::jsonb,
  constraint results_metrics_small check (pg_column_size(metrics) <= 8192),
  constraint results_metrics_history_bounded check (
    jsonb_typeof(metrics -> 'history') is distinct from 'array'
    or jsonb_array_length(metrics -> 'history') <= 200
  ),
  created_at timestamptz not null default now()
);

create index if not exists results_mode_score_idx on public.results (mode, score desc);
create index if not exists results_user_idx on public.results (user_id);

alter table public.results enable row level security;

-- Leaderboards are public reads; you can only write your own results.
create policy "results - public read" on public.results
  for select using (true);
create policy "results - insert own" on public.results
  for insert with check (auth.uid() = user_id);
create policy "results - delete own" on public.results
  for delete using (auth.uid() = user_id);

-- WHICH ROW is a policy question; WHICH COLUMNS is a grant question, and the
-- policy above only ever answered the first. Supabase's default privileges hand
-- `authenticated` table-wide INSERT, so a player posting straight at PostgREST
-- names `created_at` and `id` as freely as they name their score: a timestamp in
-- the year 3000 is inside every week `topResults` will ever compute, taking
-- permanent first place on the weekly board, and `id` is the /r/{id} slug their
-- "statement" is served from on this origin. The five columns below are exactly
-- the five `submitResult` writes.
--
-- IT HAS TO BE DONE THIS WAY ROUND — see the note on `profiles` above; a
-- column-level REVOKE cannot carve an exception out of a table-level grant.
--
-- UPDATE goes for a different reason: `results` has no UPDATE policy, so RLS
-- already refuses every update and the grant has never done anything. It is
-- removed so it stays that way after the next policy is written by someone
-- reading the policies rather than the grants.
revoke insert on public.results from authenticated;
revoke insert on public.results from anon;
revoke update on public.results from authenticated;
revoke update on public.results from anon;
grant insert (user_id, mode, score, verdict, metrics) on public.results to authenticated;

-- A ceiling on how many rows one player can leave behind.
--
-- `saves` is bounded by `unique (user_id, mode)` and by `saves_state_small`.
-- `results` is bounded per row (8 KiB) and not at all per player: one account can
-- insert indefinitely and nothing prunes. Pruning rather than refusing, because a
-- refusal past the cap falls first on the player who plays the most and falls by
-- silently declining to record a run they finished honestly.
--
-- Oldest first: a shared /r/{id} link takes its traffic in a burst right after the
-- run, so the oldest rows are the ones whose links are already spent. The best
-- RANKABLE row is spared whatever its age — a board that ranks each player by
-- their single best run must not be allowed to forget it. `score < 1e15` is the
-- test that excludes NaN, which sorts above every real number in Postgres and
-- would otherwise be nominated as the row to protect forever.
--
-- SECURITY DEFINER because the cap is a schema invariant, not a user action:
-- under `security invoker` the prune would need the inserting role's own DELETE
-- privilege, so revoking DELETE on `results` from `authenticated` would start
-- failing inserts instead. Both keys come from NEW, and NEW.user_id is already
-- pinned to `auth.uid()` by the insert policy, so it cannot be pointed elsewhere.
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

revoke all on function public.results_cap_per_player() from public;
revoke all on function public.results_cap_per_player() from anon;
revoke all on function public.results_cap_per_player() from authenticated;

drop trigger if exists results_cap_per_player on public.results;
create trigger results_cap_per_player
  before insert on public.results
  for each row execute function public.results_cap_per_player();

-- Daily streak per player (loss-aversion habit loop).
create table if not exists public.streaks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  current int not null default 0,
  longest int not null default 0,
  last_played_on date,
  -- `results.score` is bounded because `numeric` is not; these two are bounded
  -- because `int` is not and because this table is PUBLICLY READABLE by design so
  -- friends can see each other's streaks. Under an update-own policy with no
  -- column rule, one PATCH puts 2,147,483,647 in `StreakChip` and beside that
  -- player's leaderboard row. Nothing ranks on a streak, so this is cosmetic
  -- rather than competitive — which is why it is a CHECK and not a redesign.
  -- 100,000 days is 273 years. `longest >= current` is the invariant
  -- `nextStreak` (lib/cloud/streaks.ts) has always maintained and which nothing
  -- outside that function was ever required to respect.
  constraint streaks_sane check (
    current between 0 and 100000
    and longest between 0 and 100000
    and longest >= current
  )
);

alter table public.streaks enable row level security;

-- Streaks are public-readable so friends can see each other's streaks.
create policy "streaks - public read" on public.streaks
  for select using (true);
create policy "streaks - upsert own" on public.streaks
  for insert with check (auth.uid() = user_id);
create policy "streaks - update own" on public.streaks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Opt-in friend edges (added by friend code). One row per direction.
create table if not exists public.friends (
  user_id uuid not null references auth.users (id) on delete cascade,
  friend_id uuid not null references auth.users (id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id)
);

alter table public.friends enable row level security;

-- A policy that subqueries its own table risks "infinite recursion detected in
-- policy for relation". A security-definer helper sidesteps RLS and settles it.
create or replace function public.has_incoming_request(target uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.friends f
    where f.user_id = target and f.friend_id = auth.uid()
  );
$$;

revoke all on function public.has_incoming_request(uuid) from public;
revoke all on function public.has_incoming_request(uuid) from anon;
grant execute on function public.has_incoming_request(uuid) to authenticated;

-- You can see edges you're part of, and only write your own side — and an
-- `accepted` edge additionally requires that they actually asked.
--
-- The earlier "insert own" policy constrained WHOSE SIDE of an edge you wrote and
-- never the STATUS you wrote there, so anyone could insert
--   { user_id: <them>, friend_id: <victim>, status: 'accepted' }
-- and be counted by listFriendIds(), which accepts an accepted edge in either
-- direction. It was invisible too: listIncoming() only surfaces `pending`, so a
-- directly-inserted `accepted` edge never showed up as a request to decline.
--
-- NOTE ON SHAPE: accepting is an INSERT, not an update. A request is an edge
-- them -> me; accepting writes the reciprocal edge me -> them. So the policy
-- cannot simply forbid `accepted` — it allows it exactly when the reciprocal
-- edge already exists.
create policy "friends - read own edges" on public.friends
  for select using (auth.uid() = user_id or auth.uid() = friend_id);
create policy "friends - write own side" on public.friends
  for insert with check (
    auth.uid() = user_id
    and (status = 'pending' or public.has_incoming_request(friend_id))
  );
create policy "friends - accept own" on public.friends
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (status = 'pending' or public.has_incoming_request(friend_id))
  );
create policy "friends - delete own" on public.friends
  for delete using (auth.uid() = user_id);

-- Concept mastery progress (the "Money Brain" map). One row per concept.
create table if not exists public.mastery (
  user_id uuid not null references auth.users (id) on delete cascade,
  concept_id text not null check (char_length(concept_id) <= 64),
  -- The same gap `streaks` had, with a smaller blast radius: this table is
  -- read-own-only, so a forged level is visible to the forger and nobody else.
  -- Bounded anyway because the bound is free and the number is already written
  -- down — MAX_MASTERY_LEVEL in lib/cloud/mastery.ts.
  -- CHANGING MAX_MASTERY_LEVEL NOW NEEDS A MIGRATION alongside the code change.
  level int not null default 0 constraint mastery_level_sane check (level between 0 and 5),
  updated_at timestamptz not null default now(),
  primary key (user_id, concept_id)
);

alter table public.mastery enable row level security;

create policy "mastery - read own" on public.mastery
  for select using (auth.uid() = user_id);
create policy "mastery - insert own" on public.mastery
  for insert with check (auth.uid() = user_id);
create policy "mastery - update own" on public.mastery
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
