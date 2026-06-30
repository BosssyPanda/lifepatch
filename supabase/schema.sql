-- LifePatch cloud saves. Run this in the Supabase SQL editor.

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
  username text not null unique,
  avatar_seed text not null,
  friend_code text not null unique,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Anyone may read profiles (leaderboards show username + avatar only).
create policy "profiles - public read" on public.profiles
  for select using (true);
create policy "profiles - insert own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles - update own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- One row per finished run. Drives leaderboards + shareable result cards.
create table if not exists public.results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('story', 'infinite', 'cashflow')),
  score numeric not null,
  verdict text not null,
  metrics jsonb not null default '{}'::jsonb,
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

-- You can see edges you're part of, and only write your own side.
create policy "friends - read own edges" on public.friends
  for select using (auth.uid() = user_id or auth.uid() = friend_id);
create policy "friends - insert own" on public.friends
  for insert with check (auth.uid() = user_id);
create policy "friends - update own" on public.friends
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "friends - delete own" on public.friends
  for delete using (auth.uid() = user_id);

-- Concept mastery progress (the "Money Brain" map). One row per concept.
create table if not exists public.mastery (
  user_id uuid not null references auth.users (id) on delete cascade,
  concept_id text not null,
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
