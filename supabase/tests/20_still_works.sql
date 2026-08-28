-- The other half: everything the app legitimately does must still work.
\set QUIET on

\echo '--- A. anon reads the leaderboard projection -------------------------'
select set_config('request.jwt.claim.sub', '', false) \gset
set role anon;
do $$
declare n int;
begin
  select count(*) into n from public.profiles_public;
  if n = 3 then raise notice 'PASS: anon reads % rows from profiles_public', n;
  else raise notice 'FAIL: anon saw % rows, expected 3', n; end if;
end $$;

do $$
begin
  begin
    perform friend_code from public.profiles_public limit 1;
    raise notice 'FAIL: profiles_public exposes friend_code';
  exception when undefined_column then
    raise notice 'PASS: profiles_public has no friend_code column';
  end;
end $$;

do $$
begin
  begin
    perform public.profile_by_friend_code('ABC234');
    raise notice 'FAIL: anon could call profile_by_friend_code';
  exception when insufficient_privilege then
    raise notice 'PASS: anon refused on profile_by_friend_code';
  end;
end $$;
reset role;

\echo ''
\echo '--- B. a signed-in player looks up a friend code ---------------------'
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false) \gset
set role authenticated;
do $$
declare got record; n int;
begin
  select * into got from public.profile_by_friend_code('abc234');   -- lower-case on purpose
  if got.id = '11111111-1111-1111-1111-111111111111'::uuid and got.username = 'brave-otter-101'
    then raise notice 'PASS: code lookup resolved % (case/space insensitive)', got.username;
    else raise notice 'FAIL: code lookup returned %', got; end if;

  select count(*) into n from public.profile_by_friend_code('NOPE99');
  if n = 0 then raise notice 'PASS: unknown code returns no row';
  else raise notice 'FAIL: unknown code returned % row(s)', n; end if;
end $$;

\echo ''
\echo '--- C. own profile is still fully readable (needs friend_code) -------'
do $$
declare c text; n int;
begin
  select friend_code into c from public.profiles where id = auth.uid();
  if c is not null then raise notice 'PASS: own row readable, own friend_code = %', c;
  else raise notice 'FAIL: could not read own friend_code'; end if;
  select count(*) into n from public.profiles;
  if n = 1 then raise notice 'PASS: sees only own row (%)', n;
  else raise notice 'FAIL: sees % rows on the base table', n; end if;
end $$;

\echo ''
\echo '--- D. the real friend request -> accept flow ------------------------'
-- attacker(2) sends victim(1) a request
do $$
begin
  insert into public.friends (user_id, friend_id, status)
  values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','pending');
  raise notice 'PASS: pending request written by the requester';
exception when others then raise notice 'FAIL: request refused — %', sqlerrm;
end $$;
reset role;

-- victim(1) sees it as incoming and accepts by writing the reciprocal edge
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false) \gset
set role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.friends
   where friend_id = auth.uid() and status = 'pending';
  if n = 1 then raise notice 'PASS: victim sees % incoming request', n;
  else raise notice 'FAIL: victim sees % incoming', n; end if;
end $$;

do $$
begin
  insert into public.friends (user_id, friend_id, status)
  values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','accepted');
  raise notice 'PASS: accept written (reciprocal edge existed)';
exception when others then raise notice 'FAIL: accept refused — %', sqlerrm;
end $$;

-- and the bystander(3), who asked nobody, still cannot force one
do $$
begin
  insert into public.friends (user_id, friend_id, status)
  values ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','accepted');
  raise notice 'FAIL: accepted edge to a non-requester was written';
exception when insufficient_privilege then
  raise notice 'PASS: accepted edge to a non-requester still refused';
end $$;
reset role;

\echo ''
\echo '--- E. a legitimate result still posts -------------------------------'
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false) \gset
set role authenticated;
do $$
declare m jsonb;
begin
  -- the largest honest row: 100-point history plus the usual scalar keys
  select jsonb_build_object('history', jsonb_agg(g * 987654)) into m from generate_series(1,100) g;
  m := m || jsonb_build_object('netWorth', 1234567, 'happiness', 72, 'age', 64, 'good', 1,
                               'startYear', 1957, 'seed', 998877665, 'backgroundId','student',
                               'engine', 7, 'verified', 1, 'daily','2026-08-27');
  insert into public.results (user_id, mode, score, verdict, metrics)
  values (auth.uid(), 'infinite', 1234567, 'Financially Free', m);
  raise notice 'PASS: full 100-point result row accepted (% bytes)', pg_column_size(m);
exception when others then raise notice 'FAIL: honest result refused — %', sqlerrm;
end $$;

\echo ''
\echo '--- E2. the honest extremes of the score column -----------------------'
-- The bound is only correct if it still admits the best and worst runs the engine
-- can actually produce. Both numbers are measured, not chosen: 12,000 headless
-- Infinite runs on the most aggressive honest line topped out at 15,511,231,154
-- and bottomed out at -3,711,410 (see the 01b migration header).
do $$
begin
  insert into public.results (user_id, mode, score, verdict, metrics)
  values (auth.uid(), 'infinite', 15511231154, 'Financially Free', '{}'::jsonb);
  raise notice 'PASS: the best measured honest run still inserts (15,511,231,154)';
exception when others then raise notice 'FAIL: honest maximum refused — %', sqlerrm;
end $$;
do $$
begin
  insert into public.results (user_id, mode, score, verdict, metrics)
  values (auth.uid(), 'infinite', -3711410, 'Underwater', '{}'::jsonb);
  raise notice 'PASS: the worst measured honest run still inserts (-3,711,410)';
exception when others then raise notice 'FAIL: honest minimum refused — %', sqlerrm;
end $$;

\echo ''
\echo '--- F. a legitimate username change ----------------------------------'
do $$
begin
  update public.profiles set username = 'clever-heron-404' where id = auth.uid();
  raise notice 'PASS: normal username accepted';
exception when others then raise notice 'FAIL: normal username refused — %', sqlerrm;
end $$;
do $$
begin
  update public.profiles set username = 'a_b-c 1' where id = auth.uid();
  raise notice 'PASS: underscore/hyphen/space username accepted';
exception when others then raise notice 'FAIL: refused — %', sqlerrm;
end $$;
reset role;

\echo ''
\echo '--- G. ensureProfile still mints a row, and a real save still writes --'
-- The write-surface migration takes UPDATE off `profiles` at table level and hands
-- back one column. Two things must survive that: the INSERT that mints all three
-- columns, and the size bound on `saves` admitting an honest run.
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false) \gset
set role authenticated;
do $$
begin
  -- The row already exists, so a unique_violation is the PASS: privilege is checked
  -- before constraints, so reaching the unique index proves INSERT still carries
  -- friend_code and avatar_seed.
  insert into public.profiles (id, username, avatar_seed, friend_code)
  values (auth.uid(), 'clever-heron-606', 'dddddddd', 'ZZZ999');
  raise notice 'FAIL: a duplicate profile insert should not have succeeded';
exception
  when unique_violation then
    raise notice 'PASS: ensureProfile can still INSERT all three columns';
  when insufficient_privilege then
    raise notice 'FAIL: INSERT on profiles was revoked along with UPDATE';
end $$;

do $$
begin
  begin
    update public.profiles set avatar_seed = 'eeeeeeee' where id = auth.uid();
    raise notice 'FAIL: avatar_seed is still updatable';
  exception when insufficient_privilege then
    raise notice 'PASS: avatar_seed is not updatable';
  end;
end $$;

do $$
declare st jsonb;
begin
  -- A 21-year story state with a journal line per year, padded well past anything
  -- the engine writes.
  select jsonb_build_object('version', 7, 'seed', 998877665, 'years', jsonb_agg(
           jsonb_build_object('i', g, 'cash', g * 1000, 'debt', g * 250,
                              'note', 'A year of paying it down and hoping it held.')))
    into st from generate_series(1, 21) g;
  insert into public.saves (user_id, mode, state) values (auth.uid(), 'story', st);
  raise notice 'PASS: a full 21-year cloud save still writes (% bytes)', pg_column_size(st);
exception when others then raise notice 'FAIL: honest save refused — %', sqlerrm;
end $$;
reset role;
\echo ''
