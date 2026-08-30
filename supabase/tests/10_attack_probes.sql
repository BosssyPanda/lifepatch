-- Probes the holes. Run against the old schema (expect VULNERABLE) and again
-- after the migrations (expect CLOSED). Identical file both times.

\set VICTIM   '''11111111-1111-1111-1111-111111111111'''
\set ATTACKER '''22222222-2222-2222-2222-222222222222'''

\echo ''
\echo '--- 1. anon dumping friend codes -------------------------------------'
select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$
declare n int;
begin
  begin
    select count(*) into n from public.profiles;
    if n > 0 then
      raise notice 'VULNERABLE: anon read % profile row(s) from the base table', n;
    else
      raise notice 'CLOSED: anon read 0 rows from profiles';
    end if;
  exception when insufficient_privilege then
    raise notice 'CLOSED: anon refused on profiles (%)', sqlerrm;
  end;
end $$;
reset role;

\echo ''
\echo '--- 2. attacker forcing an accepted friendship -----------------------'
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
do $$
begin
  begin
    insert into public.friends (user_id, friend_id, status)
    values ('22222222-2222-2222-2222-222222222222',
            '11111111-1111-1111-1111-111111111111', 'accepted');
    raise notice 'VULNERABLE: unilateral accepted edge was written';
  exception
    when insufficient_privilege then raise notice 'CLOSED: RLS refused the unilateral accepted edge';
    when unique_violation then raise notice 'SKIP: edge already present';
  end;
end $$;
reset role;

\echo ''
\echo '--- 3. arbitrary verdict on a public result page ---------------------'
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
do $$
begin
  begin
    insert into public.results (user_id, mode, score, verdict, metrics)
    values ('22222222-2222-2222-2222-222222222222', 'story', 1,
            'ACCOUNT SUSPENDED — verify at lifepatch-support.example', '{}');
    raise notice 'VULNERABLE: arbitrary verdict accepted';
  exception when check_violation then
    raise notice 'CLOSED: verdict CHECK refused it';
  end;
end $$;
reset role;

\echo ''
\echo '--- 4. 100k-point history (render amplification) ---------------------'
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
do $$
declare big jsonb;
begin
  select jsonb_build_object('history', jsonb_agg(g)) into big from generate_series(1, 100000) g;
  begin
    insert into public.results (user_id, mode, score, verdict, metrics)
    values ('22222222-2222-2222-2222-222222222222', 'story', 1, 'Comfortable', big);
    raise notice 'VULNERABLE: 100000-point history accepted';
  exception when check_violation then
    raise notice 'CLOSED: metrics CHECK refused it';
  end;
end $$;
reset role;

\echo ''
\echo '--- 6. a score that outranks every real one --------------------------'
-- Postgres orders NaN above every numeric, and every board is `order by score
-- desc`. So this single row is permanent first place until a CHECK refuses it.
-- The probe asserts the ORDERING, not just the insert: a row that lands but sorts
-- below an honest score would not be the bug.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
do $$
declare top numeric;
begin
  begin
    insert into public.results (user_id, mode, score, verdict, metrics)
    values ('22222222-2222-2222-2222-222222222222', 'infinite', 'NaN', 'Comfortable', '{}'::jsonb);
    select score into top from public.results where mode = 'infinite' order by score desc limit 1;
    if top is not null and top = 'NaN'::numeric then
      raise notice 'VULNERABLE: NaN score accepted AND holds first place on the board';
    else
      raise notice 'VULNERABLE: NaN score accepted (top of board is %)', top;
    end if;
  exception when check_violation then
    raise notice 'CLOSED: score CHECK refused NaN';
  end;
  begin
    insert into public.results (user_id, mode, score, verdict, metrics)
    values ('22222222-2222-2222-2222-222222222222', 'infinite', 1e100000, 'Comfortable', '{}'::jsonb);
    raise notice 'VULNERABLE: a 100001-digit score accepted';
  exception when check_violation then
    raise notice 'CLOSED: score CHECK refused a 100001-digit score';
  end;
end $$;
reset role;

\echo ''
\echo '--- 5. homoglyph / RTL username -------------------------------------'
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
do $$
begin
  begin
    update public.profiles
       set username = 'brave' || chr(8237) || 'otter'   -- RTL override
     where id = '22222222-2222-2222-2222-222222222222';
    raise notice 'VULNERABLE: RTL-override username accepted';
  exception
    -- Both are closed, and which one fires depends on how far the migrations have
    -- got. The charset CHECK (migration 01) refuses the VALUE; migration 05 takes
    -- the column's UPDATE grant away entirely, and a privilege check runs first.
    when check_violation then
      raise notice 'CLOSED: username charset CHECK refused it';
    when insufficient_privilege then
      raise notice 'CLOSED: no UPDATE privilege on profiles.username';
  end;
end $$;
reset role;

\echo ''
\echo '--- 7. a player choosing their own friend code -----------------------'
-- `friend_code` is what schema.sql calls "the sole capability guarding addByCode",
-- and migration 02 exists because it was once enumerable. Minting it from a CSPRNG
-- is pointless if the holder can PATCH it to something they picked — the row policy
-- asserts only `auth.uid() = id`, which is the right answer to WHICH ROW and no
-- answer at all to WHICH COLUMNS.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
do $$
declare c text;
begin
  begin
    update public.profiles set friend_code = 'AAAAAA' where id = auth.uid();
    select friend_code into c from public.profiles where id = auth.uid();
    if c = 'AAAAAA' then
      raise notice 'VULNERABLE: a player set their own friend_code to a value they picked';
      update public.profiles set friend_code = 'XYZ789' where id = auth.uid();
    else
      raise notice 'CLOSED: friend_code unchanged (%)', c;
    end if;
  exception when insufficient_privilege then
    raise notice 'CLOSED: no UPDATE privilege on profiles.friend_code';
  end;
end $$;
reset role;

\echo ''
\echo '--- 8. an unbounded cloud save (unmetered storage) -------------------'
-- The size is measured on the in-memory datum, which is what a CHECK sees, rather
-- than on the stored row — TOAST would compress a repetitive payload and report a
-- number the constraint never evaluates.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
do $$
declare big jsonb; n int;
begin
  select jsonb_build_object('junk', jsonb_agg(g)) into big from generate_series(1, 200000) g;
  n := pg_column_size(big);
  begin
    insert into public.saves (user_id, mode, state)
    values ('22222222-2222-2222-2222-222222222222', 'story', big);
    raise notice 'VULNERABLE: a %-byte save was accepted', n;
  exception when check_violation then
    raise notice 'CLOSED: saves CHECK refused a %-byte state', n;
  end;
end $$;
reset role;

\echo ''
\echo '--- 9. a name the word list refuses, written anyway ------------------'
-- The charset CHECK holds at the database and always did; the WORD LIST ran in the
-- browser and nowhere else, so it applied to everyone except the person who did not
-- run it. `lifepatch-staff` is the cheap case and the one that matters: it is
-- perfectly legal ASCII, so migration 01's charset constraint has no opinion on it,
-- and it claims an authority the game grants nobody, on a public leaderboard.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
do $$
declare n text;
begin
  begin
    update public.profiles set username = 'lifepatch-staff' where id = auth.uid();
    select username into n from public.profiles where id = auth.uid();
    if n = 'lifepatch-staff' then
      raise notice 'VULNERABLE: an impersonation name the filter refuses was written';
      update public.profiles set username = 'sly-raven-202' where id = auth.uid();
    else
      raise notice 'CLOSED: username unchanged (%)', n;
    end if;
  exception when insufficient_privilege then
    raise notice 'CLOSED: renaming goes through the profile function, not PostgREST';
  end;
end $$;
reset role;

\echo ''
\echo '--- 10. the same bypass at signup, plus a chosen friend code ---------'
-- The easier route of the two, and the one migration 04 could not reach: pick the
-- row's contents once, at creation, and never call the rename path at all. The
-- friend code rides along — 04 revoked UPDATE on it, but INSERT was still the
-- client's, so a player could still choose the capability that guards addByCode.
-- User 4 exists in auth.users with no profile, which is what a fresh signup is.
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
set role authenticated;
do $$
begin
  begin
    insert into public.profiles (id, username, avatar_seed, friend_code)
    values (auth.uid(), 'lifepatch-admin', 'dddddddd', 'AAAAAA');
    raise notice 'VULNERABLE: a new account named itself, and chose its own friend code';
  exception when insufficient_privilege then
    raise notice 'CLOSED: creating a profile goes through the profile function';
  end;
end $$;
reset role;
\echo ''
\echo '--- 11. a result row that names its own timestamp --------------------'
-- `topResults` narrows the weekly board with `gte("created_at", weekAgoIso())`.
-- A row dated in the year 3000 is inside every week that will ever be computed,
-- so it takes first place on *This week* and no honest run can age it out. The
-- probe asserts the row is INSIDE the weekly window, not merely that it inserted:
-- a forged timestamp the board would not have shown is not the bug.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
do $$
declare n int;
begin
  begin
    insert into public.results (user_id, mode, score, verdict, metrics, created_at)
    values ('22222222-2222-2222-2222-222222222222', 'story', 1, 'Comfortable', '{}',
            timestamptz '3000-01-01 00:00:00+00');
    select count(*) into n from public.results
     where mode = 'story' and created_at >= now() - interval '7 days';
    raise notice 'VULNERABLE: a year-3000 row is on the weekly board (% row(s))', n;
  exception when insufficient_privilege then
    raise notice 'CLOSED: no INSERT privilege on results.created_at';
  end;
end $$;
reset role;

\echo ''
\echo '--- 12. a player choosing their own /r/{id} slug ----------------------'
-- `id` is the address the player statement is served from on this origin.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
do $$
begin
  begin
    insert into public.results (id, user_id, mode, score, verdict, metrics)
    values ('dddddddd-dddd-dddd-dddd-dddddddddddd',
            '22222222-2222-2222-2222-222222222222', 'story', 1, 'Comfortable', '{}');
    raise notice 'VULNERABLE: a player chose their own result id (share slug)';
  exception
    when insufficient_privilege then raise notice 'CLOSED: no INSERT privilege on results.id';
    when unique_violation then raise notice 'SKIP: that id is already taken';
  end;
end $$;
reset role;

\echo ''
\echo '--- 13. a streak nobody bounded, on a public table --------------------'
-- `streaks` is public-read by design so friends can see each other's streaks, and
-- `current`/`longest` are plain `int` under an update-own policy with no column
-- rule. Self-seeding rather than seeded, because the runner's between-pass cleanup
-- does not touch this table and the AFTER pass has to find the same starting state
-- the BEFORE pass did.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
do $$
declare n int;
begin
  insert into public.streaks (user_id, current, longest, last_played_on)
  values ('22222222-2222-2222-2222-222222222222', 1, 1, current_date)
  on conflict (user_id) do nothing;
  begin
    update public.streaks set current = 2147483647, longest = 2147483647
     where user_id = '22222222-2222-2222-2222-222222222222';
    select current into n from public.streaks
     where user_id = '22222222-2222-2222-2222-222222222222';
    if n = 2147483647 then
      raise notice 'VULNERABLE: a public streak of % was accepted', n;
    else
      raise notice 'CLOSED: streak unchanged (%)', n;
    end if;
  exception when check_violation then
    raise notice 'CLOSED: streaks CHECK refused 2147483647';
  end;
end $$;
reset role;

\echo ''
\echo '--- 14. mastery past the game own ceiling ----------------------------'
-- MAX_MASTERY_LEVEL is 5 (lib/cloud/mastery.ts) and lived only in the client.
-- Read-own-only, so the blast radius is the forger's own Money Brain — bounded
-- because the bound is free. `update` rather than a second `insert`, so the AFTER
-- pass measures the CHECK instead of the primary key.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
do $$
declare n int;
begin
  insert into public.mastery (user_id, concept_id, level)
  values ('22222222-2222-2222-2222-222222222222', 'probe-compound-interest', 0)
  on conflict (user_id, concept_id) do nothing;
  begin
    update public.mastery set level = 999
     where user_id = '22222222-2222-2222-2222-222222222222'
       and concept_id = 'probe-compound-interest';
    select level into n from public.mastery
     where user_id = '22222222-2222-2222-2222-222222222222'
       and concept_id = 'probe-compound-interest';
    if n = 999 then
      raise notice 'VULNERABLE: mastery level % accepted (game maximum is 5)', n;
    else
      raise notice 'CLOSED: mastery level unchanged (%)', n;
    end if;
  exception when check_violation then
    raise notice 'CLOSED: mastery CHECK refused level 999';
  end;
end $$;
reset role;

\echo ''
\echo '--- 15. unbounded result rows for one player -------------------------'
-- `saves` is capped by `unique (user_id, mode)`; `results` is capped per row and
-- not at all per player. 600 rows is over the 500 cap, so the count afterwards is
-- the whole assertion: unpruned it stays 600, pruned it settles at the cap.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
do $$
declare n int;
begin
  for i in 1..600 loop
    insert into public.results (user_id, mode, score, verdict, metrics)
    values ('22222222-2222-2222-2222-222222222222', 'infinite', i, 'Comfortable', '{}');
  end loop;
  select count(*) into n from public.results
   where user_id = '22222222-2222-2222-2222-222222222222' and mode = 'infinite';
  if n > 500 then
    raise notice 'VULNERABLE: one player holds % result rows in one mode', n;
  else
    raise notice 'CLOSED: result rows capped at % for one player and mode', n;
  end if;
end $$;
reset role;
\echo ''
