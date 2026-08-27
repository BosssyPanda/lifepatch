-- Probes the three holes. Run against old schema (expect VULNERABLE) and again
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
  exception when check_violation then
    raise notice 'CLOSED: username charset CHECK refused it';
  end;
end $$;
reset role;
\echo ''
