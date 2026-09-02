-- ===========================================================================
-- LifePatch — the rename ceiling only bound requests that arrived one at a time.
--
--   APPLY THIS BEFORE REDEPLOYING THE `profile` FUNCTION, on the same reasoning
--   as 07: this creates what the new code calls, so it has to exist first.
--
--     # apply this file
--     supabase functions deploy profile --project-ref <ref>
--
--   Running it early is free — nothing calls the function until the new handler
--   is live. Running it LATE is also safe here, which is the one difference from
--   07: the handler falls back to the old read-modify-write when the RPC is
--   missing, so the two can land in either order without breaking `rename`. See
--   `spendRenameAttempt` in supabase/functions/profile/index.ts.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- What 07 actually bought, and what it did not.
--
-- 07 put the counter in the database, and said why: an Edge Function is stateless
-- and horizontally scaled, so an in-memory counter enforces "five per hour per
-- isolate you happen to land on", which is not a limit. That reasoning is right,
-- and it moved the counter out of one isolate's memory.
--
-- It did not make the SPEND atomic. The handler read the row, decided, and wrote
-- back an ABSOLUTE value (`rename_attempts: spent + 1`, not an increment) across
-- two separate round trips, with nothing holding the row in between:
--
--     select rename_window_start, rename_attempts ...   -- every caller reads 0
--     decideRenameAttempt(row, now)                     -- every caller: allowed
--     update ... set rename_attempts = 1                -- every caller writes 1
--
-- So N requests issued together all read 0, all decide "allowed", and all write 1.
-- The counter lands on 1 no matter how large N is. The ceiling bounded only
-- attempts that happened to be strictly sequential — which is not how anybody
-- enumerating a namespace would issue them. One `Promise.all` of 200 renames was
-- 200 probes for one attempt's worth of counter movement, and because the word
-- filter's 400 is checked BEFORE the limiter and deliberately spends nothing, the
-- whole volley lands on the uniqueness check and comes back as clean 409/200
-- signal. That is the oracle 07 was written to close, still open.
--
-- The fix is not a better decision. It is making the read and the write one
-- statement, so the database — which is the only thing here that can — does the
-- serialising.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- One statement, and the lock does the rest.
--
-- `where` and `set` are evaluated against the SAME row under the SAME row lock:
-- the second concurrent caller blocks until the first commits, then re-evaluates
-- the `where` against the value the first wrote. Five callers arriving at once
-- therefore spend five, and the sixth matches nothing.
--
-- ZERO ROWS UPDATED MEANS REFUSED — with one exception, handled below: no such
-- profile. That case fails OPEN, matching `decideRenameAttempt`'s documented
-- behaviour and for the reason given there. `rename` has its own 404 for a
-- genuinely missing profile, so this is not the place that answer belongs.
--
-- THE CONSTANTS ARE DUPLICATED, from `_shared/renameLimit.ts`. That is a real
-- cost and it is paid on purpose: the pure function has to keep working as the
-- fallback path, so it cannot read them from here. `scripts/qa/rename-limit.mjs`
-- parses this file and fails if the two ever disagree, which is the part that
-- makes the duplication survivable.
-- ---------------------------------------------------------------------------
create or replace function public.spend_rename_attempt(uid uuid)
returns table (allowed boolean, retry_after int)
language plpgsql
security definer
set search_path = public
as $$
declare
  limit_n  constant int := 5;               -- RENAME_LIMIT
  window_i constant interval := interval '1 hour';  -- RENAME_WINDOW_MS
  window_at timestamptz;
begin
  update public.profiles p
     set rename_window_start = case
           when p.rename_window_start is null
             or now() - p.rename_window_start >= window_i then now()
           else p.rename_window_start
         end,
         rename_attempts = case
           when p.rename_window_start is null
             or now() - p.rename_window_start >= window_i then 1
           else p.rename_attempts + 1
         end
   where p.id = uid
     and (p.rename_window_start is null
          or now() - p.rename_window_start >= window_i
          or p.rename_attempts < limit_n);

  if found then
    return query select true, 0;
    return;
  end if;

  -- Nothing was updated. Either the ceiling is spent for this window, or there is
  -- no such row.
  select p.rename_window_start into window_at
    from public.profiles p
   where p.id = uid;

  -- No profile: fail open, as above.
  if not found then
    return query select true, 0;
    return;
  end if;

  -- A row matched but has no window start — unreachable, because the `where`
  -- above matches exactly that case. Answered rather than trusted: a NULL here
  -- would otherwise propagate through the arithmetic and return NULL as
  -- `retry_after`, which the handler would read as "refused, retry in nothing".
  if window_at is null then
    return query select true, 0;
    return;
  end if;

  return query select false,
    greatest(1, ceil(extract(epoch from (window_at + window_i - now())))::int);
end $$;

-- Only the service role calls this, because only the Edge Function does. A
-- limiter a client can invoke is a limiter a client can drain — `create function`
-- grants EXECUTE to PUBLIC by default, so this REVOKE is doing real work rather
-- than the belt-and-braces theatre 07 declined.
revoke all on function public.spend_rename_attempt(uuid) from public, anon, authenticated;
grant execute on function public.spend_rename_attempt(uuid) to service_role;
