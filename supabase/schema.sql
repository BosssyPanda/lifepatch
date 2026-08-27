-- LifePatch cloud saves. Run this in the Supabase SQL editor.
--
-- This is the FRESH-INSTALL file: it describes the schema as it should be on a
-- new project. If you already ran an older copy of it against a live database,
-- do NOT re-run this one — apply supabase/migrations/2026-08-27_0{1,2,3}_*.sql
-- in order instead. They reach the same end state without touching your data,
-- and 02 has a deploy-ordering requirement this file does not.

create table if not exists public.saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('story', 'infinite')),
  state jsonb not null,
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
  -- screening is a client-side blocklist (lib/cloud/profanity.ts); this is the
  -- half that has to hold at the database.
  constraint profiles_username_charset
    check (username ~ '^[A-Za-z0-9][A-Za-z0-9 _-]{1,22}[A-Za-z0-9]$'),
  avatar_seed text not null,
  friend_code text not null unique,
  created_at timestamptz not null default now()
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

-- The public projection. `security_invoker = off` is deliberate and load-bearing:
-- the view runs as its owner, so it sees past the row-level policy above and can
-- still show every player on a leaderboard. It is also the default, written out
-- so it reads as a decision. friend_code is NOT here and must never be added.
create or replace view public.profiles_public
  with (security_invoker = off) as
  select id, username, avatar_seed, created_at
  from public.profiles;

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

-- Daily streak per player (loss-aversion habit loop).
create table if not exists public.streaks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  current int not null default 0,
  longest int not null default 0,
  last_played_on date
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
  level int not null default 0,
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
