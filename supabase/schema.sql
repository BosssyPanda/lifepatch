-- ===========================================================================
-- LifePatch — database schema, policies and functions.
--
-- Run this whole file in the Supabase SQL editor. It is safe to run more than
-- once and safe to run against a project that already has rows: every table is
-- `create ... if not exists`, every policy is dropped before it is created, and
-- nothing here deletes a row. The two statements that COULD lose data are left
-- commented out with an explanation of when you would want them.
--
-- ── The one thing to know before you run it ────────────────────────────────
-- The file is in two parts.
--
--   PART A is everything below, up to the marked line. It hardens what is
--   already there — bounds, constraints, indexes, and policies that stop a
--   browser claiming things it has no business claiming. It does NOT change
--   how the game posts a score, so the app keeps working exactly as it does
--   now, whether or not the verification route is deployed.
--
--   PART B is a short block at the very end, and it is the cutover: it closes
--   the browser's ability to insert a life-sim result at all, leaving
--   `app/api/submit-result` as the only way one can be written. Run it ONLY
--   once that route is live — i.e. once `SUPABASE_SERVICE_ROLE_KEY` is set in
--   your hosting environment and a deploy carrying the route has finished.
--   Run it early and finished runs will not reach the board (they are parked in
--   the client's retry queue, so nothing is lost — they simply wait).
-- ===========================================================================


-- ===========================================================================
-- SAVES — one in-progress run per player per mode.
-- ===========================================================================

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
drop policy if exists "own saves - select" on public.saves;
create policy "own saves - select" on public.saves
  for select using (auth.uid() = user_id);

drop policy if exists "own saves - insert" on public.saves;
create policy "own saves - insert" on public.saves
  for insert with check (auth.uid() = user_id);

drop policy if exists "own saves - update" on public.saves;
create policy "own saves - update" on public.saves
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own saves - delete" on public.saves;
create policy "own saves - delete" on public.saves
  for delete using (auth.uid() = user_id);


-- ===========================================================================
-- PROFILES — pseudonymous player identity. Usernames only, no real names, no PII.
-- ===========================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 24),
  avatar_seed text not null,
  friend_code text not null unique,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- ── Why the public read policy is gone ────────────────────────────────────
-- It used to be `for select using (true)`, over a table whose primary key IS
-- `auth.users.id`. Two columns on that table are not public information:
--
--   • `id` is the account's real user id. Anyone could walk the table and
--     collect every player's, which is the identifier needed to target the
--     friends table and to correlate a player across `results` and `streaks`.
--   • `friend_code` is the secret that lets someone send you a friend request.
--     Readable by everyone, it is not a secret and the friends feature has no
--     consent step left in it.
--
-- Leaderboards genuinely need a username and an avatar for a set of ids they
-- already hold, and nothing more. That is what `profiles_for` below is: the three
-- safe columns, for ids you name. Your own row stays fully readable to you, which
-- is where the app gets your own friend code from.
drop policy if exists "profiles - public read" on public.profiles;
drop policy if exists "profiles - read own" on public.profiles;
create policy "profiles - read own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles - insert own" on public.profiles;
create policy "profiles - insert own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles - update own" on public.profiles;
create policy "profiles - update own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ── The display half of a profile, and nothing else ───────────────────────
-- A LOOKUP, not a listing, and the difference is the whole point.
--
-- The obvious shape here is a view over the three safe columns — and it is wrong
-- in a way worth writing down, because the first version of this file used one.
-- A view carries no row-level security of its own, so `select * from
-- profiles_public` hands back every row to anyone: the friend code is gone, but
-- the table is still walkable, and walking it is how you collect every player's
-- account id. That is the half of the problem this block says it is fixing.
--
-- A function takes the ids you are asking about. Every real caller already has
-- them — `getProfiles` resolves the names for a page of leaderboard rows it has
-- already fetched — and nobody has a use for "give me everyone". You can learn
-- the name behind an id you have seen; you cannot discover ids you have not.
--
-- `security definer` because the caller cannot read other people's `profiles`
-- rows, which is the point; `search_path` pinned so the body cannot be
-- redirected; the input array bounded so it cannot become a listing by being
-- asked 100,000 questions at once.
drop view if exists public.profiles_public;

create or replace function public.profiles_for(ids uuid[])
returns table (id uuid, username text, avatar_seed text)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.username, p.avatar_seed
  from public.profiles p
  where p.id = any(ids[1:200]);
$$;

revoke all on function public.profiles_for(uuid[]) from public;
grant execute on function public.profiles_for(uuid[]) to anon, authenticated;

-- ── The username charset ──────────────────────────────────────────────────
-- Usernames render on a public leaderboard and inside a 1200x630 share card.
-- Unrestricted text there accepts homoglyph impersonation (a Cyrillic 'а' in
-- someone else's name) and RTL override characters, which can reorder the rest
-- of the row around them. Letters, digits, spaces, `_` and `-` cover every
-- generated name (`brave-otter-421`) and every reasonable chosen one.
--
-- Added NOT VALID on purpose: it applies to every insert and update from now
-- on, and leaves rows that already exist alone. Nobody's name is taken away by
-- running this file. Once you have looked at what is already in the table:
--
--   alter table public.profiles validate constraint profiles_username_charset;
--
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_username_charset'
  ) then
    alter table public.profiles
      add constraint profiles_username_charset
      check (username ~ '^[A-Za-z0-9 _-]+$') not valid;
  end if;
end $$;

-- ── Friend-code lookup, without a readable friend_code column ──────────────
-- The only legitimate question anyone asks of someone else's friend code is
-- "whose is this?", asked with the code already in hand. That is a function,
-- not a table read: it answers for one code at a time and returns the two
-- fields the friends UI needs. The column itself stays unreadable.
--
-- SECURITY DEFINER because the caller cannot read `profiles` rows other than
-- their own — that is the point. `search_path` is pinned so the function body
-- cannot be redirected by a caller-set path.
create or replace function public.find_by_friend_code(code text)
returns table (id uuid, username text)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.username
  from public.profiles p
  where p.friend_code = upper(trim(code))
  limit 1;
$$;

revoke all on function public.find_by_friend_code(text) from public;
grant execute on function public.find_by_friend_code(text) to authenticated;


-- ===========================================================================
-- RESULTS — one row per finished run. Leaderboards + shareable result cards.
-- ===========================================================================

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

-- The leaderboard filters `metrics->>'backgroundId'`, `metrics->>'daily'` and
-- the comparability marker in the database rather than over a fetched page, so
-- the expressions are worth an index once a board has real traffic.
create index if not exists results_metrics_background_idx
  on public.results ((metrics->>'backgroundId'));
create index if not exists results_metrics_daily_idx
  on public.results ((metrics->>'daily'));

-- ── One row per run, enforced where it can actually be enforced ────────────
-- `lib/cloud/results.ts` carries a durable dedupe that survives reloads, and it
-- is genuinely good at what it can see. What it cannot see is another tab: two
-- report screens open on the same finished run both check, both find nothing,
-- and both insert. The seed is unique to a run, so this closes it at the table
-- — and the verification route reads a 23505 from here as "already posted" and
-- hands back the existing row rather than erroring.
--
-- Partial, because a row written before seeds were recorded has no seed and
-- must not collide with every other seedless row of the same mode.
--
-- IF THIS STATEMENT FAILS with "could not create unique index", your table
-- already contains duplicates — almost certainly from exactly the two-tab race
-- above. Nothing here will delete them for you. Look at them first:
--
--   select user_id, mode, metrics->>'seed' as seed, count(*), min(created_at)
--   from public.results
--   where metrics->>'seed' is not null
--   group by 1, 2, 3 having count(*) > 1;
--
-- and then, if you are happy to lose the later copies (the earliest row per run
-- is kept, which is the one every share link already points at):
--
--   delete from public.results r using public.results keep
--   where r.metrics->>'seed' is not null
--     and keep.metrics->>'seed' = r.metrics->>'seed'
--     and keep.user_id = r.user_id and keep.mode = r.mode
--     and (keep.created_at, keep.id) < (r.created_at, r.id);
--
create unique index if not exists results_user_mode_seed_idx
  on public.results (user_id, mode, (metrics->>'seed'))
  where metrics->>'seed' is not null;

alter table public.results enable row level security;

-- ── Bounds on what a row may contain ──────────────────────────────────────
-- `verdict` renders into the OG card, the page `<title>` and `og:description`.
-- React and Satori escape it, so this is not an XSS hole — it is a phishing
-- primitive: unbounded attacker-chosen text on your own domain, in a link
-- preview, above your own wordmark. The closed set is the one in
-- `lib/verdict.ts` plus the three the Rat Race recap can produce.
--
-- NOT VALID for the same reason as the username charset: it governs everything
-- written from now on and leaves existing rows where they are. To tighten it
-- once you have checked what is in there:
--
--   alter table public.results validate constraint results_verdict_known;
--
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'results_verdict_known') then
    alter table public.results
      add constraint results_verdict_known
      check (verdict in (
        'Financially Free', 'Comfortable', 'Rich Enough',
        'Getting By', 'Underwater', 'The Estate',
        'Escaped the Rat Race', 'Still Racing', 'Buried in Debt'
      )) not valid;
  end if;

  -- A score outside this is not a run, it is a typo or a probe. The widest real
  -- number the engine produces is a long Infinite run's net worth, orders of
  -- magnitude inside it.
  if not exists (select 1 from pg_constraint where conname = 'results_score_sane') then
    alter table public.results
      add constraint results_score_sane
      check (score > -1e15 and score < 1e15) not valid;
  end if;

  -- `metrics` carries a capped 100-point history and a dozen scalars — about
  -- 2 KB at its largest. This stops the column being used as free storage.
  if not exists (select 1 from pg_constraint where conname = 'results_metrics_bounded') then
    alter table public.results
      add constraint results_metrics_bounded
      check (jsonb_typeof(metrics) = 'object' and octet_length(metrics::text) <= 16384) not valid;
  end if;
end $$;

-- Leaderboards are public reads.
drop policy if exists "results - public read" on public.results;
create policy "results - public read" on public.results
  for select using (true);

-- ── The verified flag becomes unforgeable, here, in Part A ────────────────
-- `metrics.verified` is what puts "Replayed" beside a score. It used to be
-- written by the same browser that computed the score it was vouching for,
-- which means it attested to nothing at all: a modified client writes both
-- halves and the row is indistinguishable from an honest one.
--
-- This policy refuses any client insert carrying the key. The service role
-- bypasses RLS, so `app/api/submit-result` — which derives the score by
-- replaying the run — remains the only writer that can set it. The flag is
-- therefore honest from the moment you run this file, whether or not that route
-- is deployed yet: with no route, no row gets the flag, which is the correct
-- answer rather than a false one.
drop policy if exists "results - insert own" on public.results;
create policy "results - insert own" on public.results
  for insert with check (
    auth.uid() = user_id
    and not (metrics ? 'verified')
  );

drop policy if exists "results - delete own" on public.results;
create policy "results - delete own" on public.results
  for delete using (auth.uid() = user_id);

-- Deliberately no update policy: a posted result is a record of something that
-- happened. Deleting your own is allowed; editing it is not.

-- Rows written before this file existed may carry a client-authored `verified`
-- flag, which never meant anything. They are pre-v7 and the leaderboard's
-- comparability filter already keeps them off today's board, so they are left
-- alone. To strip the claim from their share pages as well:
--
--   update public.results set metrics = metrics - 'verified'
--   where metrics ? 'verified';


-- ===========================================================================
-- STREAKS — the daily habit loop.
-- ===========================================================================

create table if not exists public.streaks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  current int not null default 0,
  longest int not null default 0,
  last_played_on date
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'streaks_bounded') then
    alter table public.streaks
      add constraint streaks_bounded
      check (current >= 0 and longest >= current and longest <= 100000) not valid;
  end if;
end $$;

alter table public.streaks enable row level security;

-- Streaks are public-readable so friends can see each other's streaks.
drop policy if exists "streaks - public read" on public.streaks;
create policy "streaks - public read" on public.streaks
  for select using (true);

drop policy if exists "streaks - upsert own" on public.streaks;
create policy "streaks - upsert own" on public.streaks
  for insert with check (auth.uid() = user_id);

drop policy if exists "streaks - update own" on public.streaks;
create policy "streaks - update own" on public.streaks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Bumping a streak atomically ───────────────────────────────────────────
-- The client used to read the row, compute the next value and write it back.
-- Two tabs finishing a run in the same minute both read `current = 4` and both
-- write 5, so a day is silently eaten — and the same read-modify-write is what
-- lets a caller simply write any number it likes.
--
-- This does the whole thing in one statement, server-side, from the row that is
-- actually there. `today` is passed in rather than taken from `now()` because a
-- streak is about the player's OWN days: `lib/cloud/streaks.ts` keys on the
-- local calendar date, deliberately unlike the Daily Ledger, which is UTC for
-- everyone. The date is the only thing the caller supplies, and the worst it can
-- do with it is move its own streak.
create or replace function public.bump_streak(today date)
returns public.streaks
language plpgsql
security invoker
set search_path = public
as $$
declare
  result public.streaks;
begin
  insert into public.streaks as s (user_id, current, longest, last_played_on)
  values (auth.uid(), 1, 1, today)
  on conflict (user_id) do update
    set current = case
          when s.last_played_on = today then s.current
          when s.last_played_on = today - 1 then s.current + 1
          else 1
        end,
        longest = greatest(s.longest, case
          when s.last_played_on = today then s.current
          when s.last_played_on = today - 1 then s.current + 1
          else 1
        end),
        last_played_on = today
  returning * into result;
  return result;
end;
$$;

revoke all on function public.bump_streak(date) from public;
grant execute on function public.bump_streak(date) to authenticated;


-- ===========================================================================
-- FRIENDS — opt-in edges, added by code, never by search.
-- ===========================================================================

create table if not exists public.friends (
  user_id uuid not null references auth.users (id) on delete cascade,
  friend_id uuid not null references auth.users (id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id)
);

-- The primary key indexes the `user_id` side only, so every "edges involving
-- me" read — which is an `or` across both columns — sequentially scanned the
-- table for the second half.
create index if not exists friends_friend_idx on public.friends (friend_id);

alter table public.friends enable row level security;

-- ── What a friendship IS ──────────────────────────────────────────────────
-- An edge means "I want to be connected to you". A FRIENDSHIP is two of them,
-- one in each direction, and the client reads it that way (`listFriendIds`).
--
-- That structural rule is what makes the feature safe, and it is why the old
-- policies were not. They let anyone insert a row with any `status`, and the
-- client counted a single edge in EITHER direction as a friendship — so one
-- request, `{user_id: me, friend_id: anyone, status: 'accepted'}`, silently made
-- you their friend, with their board and their streak visible to you and no
-- notification on their side. Both halves are closed here: a self-authored edge
-- can only ever be `pending`, and one edge is never a friendship.
drop policy if exists "friends - read own edges" on public.friends;
create policy "friends - read own edges" on public.friends
  for select using (auth.uid() = user_id or auth.uid() = friend_id);

drop policy if exists "friends - insert own" on public.friends;
create policy "friends - insert own" on public.friends
  for insert with check (
    auth.uid() = user_id
    and friend_id <> auth.uid()
    and (
      -- Asking is always allowed, and asking is all a first edge can be.
      status = 'pending'
      -- Accepting is an INSERT, not an update: the person accepting has no edge
      -- of their own yet, which is exactly what makes it an acceptance. Allowed
      -- only when the other side has already written theirs, so `accepted` still
      -- cannot be self-declared — the same condition the update policy applies,
      -- because it is the same act arriving through a different verb.
      or exists (
        select 1 from public.friends r
        where r.user_id = friends.friend_id and r.friend_id = auth.uid()
      )
    )
  );

-- `accepted` is a UI state — "I have seen this and said yes" — layered on top of
-- the structural rule, and it still cannot be self-declared: promoting your own
-- edge requires the other side to have written theirs.
drop policy if exists "friends - update own" on public.friends;
create policy "friends - update own" on public.friends
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (
      status = 'pending'
      or exists (
        select 1 from public.friends r
        where r.user_id = friends.friend_id and r.friend_id = auth.uid()
      )
    )
  );

drop policy if exists "friends - delete own" on public.friends;
create policy "friends - delete own" on public.friends
  for delete using (auth.uid() = user_id);

-- Reconcile anything the old policies allowed. A one-sided `accepted` edge is
-- demoted to the request it always actually was; nothing is deleted, so a
-- genuine request survives as a request. A no-op on an empty table.
update public.friends f
set status = 'pending'
where f.status = 'accepted'
  and not exists (
    select 1 from public.friends r
    where r.user_id = f.friend_id and r.friend_id = f.user_id
  );


-- ===========================================================================
-- MASTERY — the "Money Brain" concept map. One row per concept.
-- ===========================================================================

create table if not exists public.mastery (
  user_id uuid not null references auth.users (id) on delete cascade,
  concept_id text not null check (char_length(concept_id) <= 64),
  level int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, concept_id)
);

do $$
begin
  -- `lib/concepts.ts` tops out at level 5. Anything above it is not a level the
  -- game can award.
  if not exists (select 1 from pg_constraint where conname = 'mastery_level_bounded') then
    alter table public.mastery
      add constraint mastery_level_bounded
      check (level >= 0 and level <= 5) not valid;
  end if;
end $$;

alter table public.mastery enable row level security;

drop policy if exists "mastery - read own" on public.mastery;
create policy "mastery - read own" on public.mastery
  for select using (auth.uid() = user_id);

drop policy if exists "mastery - insert own" on public.mastery;
create policy "mastery - insert own" on public.mastery
  for insert with check (auth.uid() = user_id);

drop policy if exists "mastery - update own" on public.mastery;
create policy "mastery - update own" on public.mastery
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ===========================================================================
-- ===========================================================================
--                                  PART B
--
--                        THE CUTOVER. NOT YET.
--
-- Everything above is safe to run today. The block below is not — it removes
-- the browser's ability to insert a Story or Infinite result, which is the
-- change that makes a life-sim score mean something, and which BREAKS posting
-- entirely until `app/api/submit-result` is live.
--
-- Run it only when all three of these are true:
--
--   1. `SUPABASE_SERVICE_ROLE_KEY` is set in your hosting environment
--      (Vercel → Project → Settings → Environment Variables). It must NOT have
--      a `NEXT_PUBLIC_` prefix: those are inlined into the JavaScript every
--      visitor downloads.
--   2. A deploy carrying that variable AND the route has finished. NEXT_PUBLIC
--      values are baked at build time, so setting a variable without
--      redeploying changes nothing.
--   3. Finishing a run puts a row on the board with "Replayed" beside it. That
--      is the route answering; without the key it answers 503 and the client
--      quietly inserts the row itself.
--
-- Until then, leave it commented. A run that cannot post is not lost — the
-- client parks it and retries on the next load — but it does not appear either,
-- and that is a confusing state to put your players in for no reason.
--
-- To undo the cutover, re-run PART A: it recreates the permissive insert policy.
-- ===========================================================================
-- ===========================================================================

-- drop policy if exists "results - insert own" on public.results;
-- create policy "results - insert own" on public.results
--   for insert with check (
--     auth.uid() = user_id
--     and not (metrics ? 'verified')
--     -- The Rat Race keeps posting from the browser, and that is the honest
--     -- reading rather than an exemption: its state records dice rolls, not
--     -- decisions, so there is no action log to replay and nothing a server
--     -- could re-derive. It never carries the flag, and its board is protected
--     -- instead by the score-version filter in `lib/cloud/comparability.ts`.
--     and mode = 'cashflow'
--   );
