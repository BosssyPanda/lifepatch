-- ===========================================================================
-- LifePatch security migration — PART 3: ROTATE EVERY FRIEND CODE. OPTIONAL.
--
-- Run this only after PART 2, and only when you have decided to.
--
-- WHY YOU WOULD. Until PART 2 landed, every friend code in this database was
-- readable by anyone holding the publishable key. Treat all of them as public:
-- closing the leak does not un-publish what leaked. Rotating is what actually
-- restores "added by code, never by search".
--
-- WHAT IT COSTS. Any code a player has already given someone stops working, with
-- no in-app notice — the app has no way to tell them. That is the whole trade.
--
-- WHEN IT IS FREE. Today it is very close to free: no shipped UI displays a
-- friend code or consumes one (addByCode and getByFriendCode have no callers),
-- so in practice nobody is holding a code they were about to type in. If the
-- friends UI ships first, this gets more expensive — rotate before that, not
-- after.
--
-- SAFETY. Runs in one transaction; the unique index on friend_code is honoured
-- throughout, and a collision is retried rather than swallowed. Either every row
-- rotates or none does.
-- ===========================================================================

begin;

-- The same alphabet the client uses (lib/cloud/generate.ts): no 0/O/1/I/L, so a
-- code stays unambiguous read aloud or typed. 31 glyphs, 6 places (~887M).
create or replace function public.gen_friend_code()
returns text
language sql
volatile
as $$
  select string_agg(
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (floor(random() * 31)::int) + 1, 1),
    ''
  )
  from generate_series(1, 6);
$$;

do $$
declare
  r        record;
  new_code text;
  rotated  boolean;
  n        int := 0;
begin
  for r in select id from public.profiles loop
    rotated := false;
    -- 50 attempts is far past the birthday bound for any realistic player count;
    -- exhausting it means the code space is genuinely crowded, which is a fact
    -- worth failing loudly over rather than papering over with a duplicate.
    for _attempt in 1..50 loop
      new_code := public.gen_friend_code();
      begin
        update public.profiles set friend_code = new_code where id = r.id;
        rotated := true;
        exit;
      exception when unique_violation then
        null; -- drew a code already in use; go round again
      end;
    end loop;

    if not rotated then
      raise exception 'friend-code rotation: no free code found for profile % after 50 attempts', r.id;
    end if;
    n := n + 1;
  end loop;

  raise notice 'friend-code rotation: % profile(s) rotated', n;
end $$;

-- The generator was only ever scaffolding for this migration; the app mints its
-- own codes client-side. Leaving it behind would be a spare, unowned function.
drop function if exists public.gen_friend_code();

commit;


-- ===========================================================================
-- VERIFY
--   select count(*) as profiles,
--          count(distinct friend_code) as distinct_codes,
--          count(*) filter (where friend_code !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$') as malformed
--     from public.profiles;
--
-- profiles = distinct_codes, and malformed = 0.
-- ===========================================================================
