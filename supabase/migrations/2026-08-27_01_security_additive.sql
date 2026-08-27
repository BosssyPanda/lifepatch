-- ===========================================================================
-- LifePatch security migration — PART 1 of 2: ADDITIVE.
--
-- SAFE TO RUN RIGHT NOW, on a live database, BEFORE deploying the new build.
-- Nothing here removes a grant or narrows a policy that the currently-deployed
-- client depends on, so the running app keeps working exactly as it does today.
--
-- Idempotent: re-running it is a no-op.
--
-- Run PART 2 (2026-08-27_02_profiles_lockdown.sql) only AFTER the new build is
-- live. That file is the one that closes the friend-code leak, and it breaks any
-- client still doing `select * from profiles` — which is every build before this
-- one. See the header of that file.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. profiles: a public projection that CANNOT carry the friend code.
--
-- RLS has no column granularity: "profiles - public read" grants whole rows, so
-- `friend_code` ships to anyone holding the publishable key — which is every
-- browser, by design. A view is the only way to publish some columns and not
-- others.
--
-- `security_invoker = off` is deliberate and load-bearing. The view runs as its
-- owner, so it sees past the row-level policy that PART 2 puts on the base table
-- and can still show every player's username on a leaderboard. It is also the
-- default, and is written out here so it reads as a decision rather than an
-- oversight. (Supabase's linter flags this as "security definer view"; that is
-- exactly what it is, and the columns it exposes are the whole public surface.)
-- ---------------------------------------------------------------------------
create or replace view public.profiles_public
  with (security_invoker = off) as
  select id, username, avatar_seed, created_at
  from public.profiles;

comment on view public.profiles_public is
  'Public projection of profiles: username + avatar only. friend_code is NOT here and must never be added — it is the sole capability guarding addByCode.';

grant select on public.profiles_public to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. Friend-code lookup as a point query that cannot enumerate.
--
-- Takes a code, returns at most one row, and never returns the code itself.
-- There is no filter, offset or ordering a caller can use to walk the table.
-- ---------------------------------------------------------------------------
create or replace function public.profile_by_friend_code(code text)
returns table (id uuid, username text, avatar_seed text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.username, p.avatar_seed
  from public.profiles p
  where p.friend_code = upper(trim(code))
  limit 1;
$$;

-- A new function is granted to PUBLIC by default, and `anon` inherits that — so
-- revoking from `anon` alone would leave the grant intact. Revoke PUBLIC first.
revoke all on function public.profile_by_friend_code(text) from public;
revoke all on function public.profile_by_friend_code(text) from anon;
grant execute on function public.profile_by_friend_code(text) to authenticated;

comment on function public.profile_by_friend_code(text) is
  'Point lookup for the "add a friend by code" flow. Signed-in callers only. Returns no friend_code, so a result cannot be used to seed another lookup. Codes are 6 chars over a 31-glyph alphabet (~887M); consider a Supabase rate limit if the friends UI ever ships.';


-- ---------------------------------------------------------------------------
-- 3. friends: make an `accepted` edge require an actual incoming request.
--
-- "friends - insert own" constrained WHOSE SIDE of an edge you write, never the
-- STATUS you wrote there — so anyone could insert
--   { user_id: <them>, friend_id: <victim>, status: 'accepted' }
-- and be counted as a friend by listFriendIds(), which accepts an accepted edge
-- in either direction. It was invisible too: listIncoming() only ever surfaces
-- `pending`, so a directly-inserted `accepted` edge never appears as a request.
--
-- NOTE ON SHAPE: accepting is an INSERT here, not an update. A request is an
-- edge them -> me; accepting it writes the reciprocal edge me -> them. So the
-- insert policy cannot simply forbid `accepted` — it has to allow it exactly
-- when the reciprocal edge already exists.
-- ---------------------------------------------------------------------------

-- A policy that subqueries its own table risks "infinite recursion detected in
-- policy for relation". A security-definer helper sidesteps RLS and settles it.
create or replace function public.has_incoming_request(target uuid)
returns boolean
language sql
security definer
stable
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

comment on function public.has_incoming_request(uuid) is
  'True when `target` has already written an edge pointing at the caller — i.e. the caller has a real incoming friend request. Security definer so the friends policies can consult friends without recursing.';

drop policy if exists "friends - insert own" on public.friends;
drop policy if exists "friends - write own side" on public.friends;
create policy "friends - write own side" on public.friends
  for insert with check (
    auth.uid() = user_id
    and (
      -- A request is always yours to make.
      status = 'pending'
      -- An acceptance is only yours to make if they actually asked.
      or public.has_incoming_request(friend_id)
    )
  );

drop policy if exists "friends - update own" on public.friends;
drop policy if exists "friends - accept own" on public.friends;
create policy "friends - accept own" on public.friends
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (status = 'pending' or public.has_incoming_request(friend_id))
  );


-- ---------------------------------------------------------------------------
-- 4. results: pin the verdict to the closed set the game can actually produce.
--
-- `verdict` had no CHECK, and it is rendered as the <h1> of /r/{id}, as the page
-- <title> and og:description, and as up-to-118px display type on the generated
-- OG image. That is not XSS — React and Satori both escape — but it let any
-- account mint an official-looking "statement" on your own domain, with a
-- matching unfurl card. This is the ingest half of that fix; the render half
-- (a safeVerdict() guard) ships with the client.
--
-- The nine values below are the whole set:
--   lib/verdict.ts VERDICTS            — the six life-sim archetypes
--   lib/cloud/buildResult.ts           — the three Rat Race strings
-- Adding or renaming a verdict now needs a migration alongside the code change.
--
-- NOT VALID: enforced on every INSERT from here on, but existing rows are not
-- scanned, so this cannot fail on live data. To check the back catalogue and
-- promote it, see the audit queries at the foot of this file.
-- ---------------------------------------------------------------------------
alter table public.results drop constraint if exists results_verdict_known;
alter table public.results
  add constraint results_verdict_known check (
    verdict in (
      'Financially Free', 'Comfortable', 'Rich Enough',
      'Getting By', 'Underwater', 'The Estate',
      'Escaped the Rat Race', 'Still Racing', 'Buried in Debt'
    )
  ) not valid;


-- ---------------------------------------------------------------------------
-- 5. results: stop `metrics` becoming a document store.
--
-- The writer caps the net-worth series at 100 points, but that cap lives only in
-- the client. A row posted straight at PostgREST with a 100,000-element
-- `history` turns into six figures of SVG geometry on an unauthenticated,
-- uncached page — a bandwidth amplifier pointed at your own hosting bill.
--
-- 8 KiB is ~6x the largest honest row (a 100-point history plus ~15 scalar keys
-- measures ~1.3 KiB), so it has real headroom and still refuses the attack by
-- three orders of magnitude. The array cap is the direct expression of the same
-- rule; the reader caps independently, because a row is not the writer.
-- ---------------------------------------------------------------------------
alter table public.results drop constraint if exists results_metrics_small;
alter table public.results
  add constraint results_metrics_small check (pg_column_size(metrics) <= 8192) not valid;

alter table public.results drop constraint if exists results_metrics_history_bounded;
alter table public.results
  add constraint results_metrics_history_bounded check (
    jsonb_typeof(metrics -> 'history') is distinct from 'array'
    or jsonb_array_length(metrics -> 'history') <= 200
  ) not valid;


-- ---------------------------------------------------------------------------
-- 6. profiles: constrain the username charset.
--
-- Usernames render publicly on the leaderboard and were length-checked only.
-- The charset below is the real defence: it refuses zero-width joiners, RTL
-- overrides, combining marks and Unicode homoglyphs — the things used to
-- impersonate another player or to smuggle a second line of text into a row.
-- Word-level screening is a client-side blocklist (lib/cloud/profanity.ts);
-- this is the part that has to hold at the database.
--
-- ⚠ THIS SECTION CAN RENAME EXISTING PLAYERS. Read on before running.
--
-- NOT VALID is NOT usable here, and the reason is a trap worth stating plainly:
-- a NOT VALID constraint skips existing rows at creation time, but it is still
-- enforced on any later UPDATE OF THAT ROW — including an update that touches a
-- completely different column. So a legacy row whose username does not match
-- would be frozen: no username change, no avatar change, and PART 3's
-- friend-code rotation would abort on it. (This was not theoretical — it is
-- exactly how the rotation migration failed under test.)
--
-- So violating names are sanitized FIRST, and only then is the constraint added
-- as fully valid. Sanitizing keeps every allowed glyph, and falls back to a
-- generated `player-xxxxxxxx` only when nothing usable survives — which is the
-- case precisely for names that were pure control characters or homoglyphs.
-- Every change is announced with RAISE NOTICE; capture the output.
--
-- To see who would be renamed before committing to it, run the audit query at
-- the foot of this file first. On a database that has only ever seen names from
-- generateUsername() (ASCII adjective-noun-NNN) this loop does nothing at all.
-- ---------------------------------------------------------------------------
do $$
declare
  r     record;
  base  text;
  cand  text;
  i     int;
  n     int := 0;
begin
  for r in
    select id, username from public.profiles
     where username !~ '^[A-Za-z0-9][A-Za-z0-9 _-]{1,22}[A-Za-z0-9]$'
  loop
    -- Fold accented Latin letters to their base letter FIRST, so a real name
    -- survives as a name: José-Álvarez -> Jose-Alvarez, not Jos-lvarez. (Done with
    -- translate() rather than unaccent(), which is an extension Supabase projects
    -- do not have enabled by default.)
    base := translate(
      r.username,
      'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÑñÇçÝýÿÆæŒœßÐðÞþŠšŽž',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOOooooooUUUUuuuuNnCcYyyAaOoseDdTtSsZz'
    );
    -- Then keep what is allowed, drop what is not, and tidy the ends.
    base := regexp_replace(base, '[^A-Za-z0-9 _-]', '', 'g');
    base := btrim(base, ' _-');
    base := substr(base, 1, 24);
    base := btrim(base, ' _-');

    -- Nothing usable survived (a name that was entirely homoglyphs or control
    -- characters), or the remains are too short to be a name.
    if base !~ '^[A-Za-z0-9][A-Za-z0-9 _-]{1,22}[A-Za-z0-9]$' then
      base := 'player-' || substr(md5(r.id::text), 1, 8);  -- 15 chars, always legal
    end if;

    -- `username` is unique; a sanitized name can collide with a real one.
    cand := base;
    i := 0;
    while exists (select 1 from public.profiles p where p.username = cand and p.id <> r.id) loop
      i := i + 1;
      cand := substr(base, 1, 23 - char_length(i::text)) || '-' || i::text;
      cand := btrim(cand, ' _-');
      if cand !~ '^[A-Za-z0-9][A-Za-z0-9 _-]{1,22}[A-Za-z0-9]$' then
        cand := 'player-' || substr(md5(r.id::text || i::text), 1, 8);
      end if;
      if i > 100 then
        raise exception 'username sanitize: no free name for profile %', r.id;
      end if;
    end loop;

    update public.profiles set username = cand where id = r.id;
    raise notice 'username sanitized: % -> %', r.username, cand;
    n := n + 1;
  end loop;

  if n > 0 then
    raise notice 'username sanitize: % row(s) renamed', n;
  end if;
end $$;

alter table public.profiles drop constraint if exists profiles_username_charset;
alter table public.profiles
  add constraint profiles_username_charset check (
    username ~ '^[A-Za-z0-9][A-Za-z0-9 _-]{1,22}[A-Za-z0-9]$'
  );


-- ===========================================================================
-- OPTIONAL AUDIT — run these by hand; they change nothing.
--
-- ⚠ RUN THE THIRD ONE (usernames) BEFORE APPLYING THIS FILE. Section 6 renames
-- whatever it returns. The first two only report: the `results` constraints go
-- on as NOT VALID, and `results` has no UPDATE policy, so an existing row can
-- never be edited into tripping them.
--
-- All three should be empty on a database that only ever saw writes from the game.
--
--   select id, user_id, verdict from public.results
--    where verdict not in (
--      'Financially Free','Comfortable','Rich Enough','Getting By','Underwater',
--      'The Estate','Escaped the Rat Race','Still Racing','Buried in Debt');
--
--   select id, user_id, pg_column_size(metrics) as bytes,
--          jsonb_array_length(metrics -> 'history') as points
--     from public.results
--    where pg_column_size(metrics) > 8192
--       or (jsonb_typeof(metrics -> 'history') = 'array'
--           and jsonb_array_length(metrics -> 'history') > 200);
--
--   select id, username from public.profiles
--    where username !~ '^[A-Za-z0-9][A-Za-z0-9 _-]{1,22}[A-Za-z0-9]$';
--
-- If either `results` query returns rows, deal with them first — they are almost
-- certainly hand-inserted. Once both are empty you can promote those constraints
-- from NOT VALID to fully validated, which takes a brief lock:
--
--   alter table public.results validate constraint results_verdict_known;
--   alter table public.results validate constraint results_metrics_small;
--   alter table public.results validate constraint results_metrics_history_bounded;
--
-- `profiles_username_charset` needs no promotion — section 6 sanitizes first and
-- then adds it fully valid, because a NOT VALID constraint would freeze every
-- non-conforming row against all future updates.
-- ===========================================================================
