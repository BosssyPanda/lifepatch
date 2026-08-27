-- ===========================================================================
-- LifePatch security migration — PART 1b: BOUND THE SCORE COLUMN.
--
-- SAFE TO RUN RIGHT NOW, on a live database, BEFORE deploying the new build.
-- It belongs to the same class as PART 1 and is numbered to sort beside it: run
-- it with PART 1, in either order, and long before PART 2.
--
-- Idempotent, with one caveat stated plainly below: it DELETES rows whose score
-- is not a number. Read section 2 before running it.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Why `score` needs a CHECK at all, when `verdict` and `metrics` already have one.
--
-- `score` is `numeric`, client-written, and was the one column on `results` left
-- unconstrained after PART 1. PostgREST accepts anything the column accepts, and
-- two of those values are not scores:
--
--   NaN.  Postgres orders NaN ABOVE every other numeric — this is documented and
--         was verified against a real cluster, not assumed:
--
--             select ('NaN'::numeric > 1e300::numeric);   -- t
--
--         Every board runs `order by score desc`. So ONE row —
--
--             POST /rest/v1/results  {"score": "NaN", ...}
--
--         — takes first place on that mode's leaderboard permanently, and no
--         honest run can ever displace it, because no real number is greater
--         than NaN. It costs one magic-link account.
--
--   A number with more digits than a double can carry.  `numeric` has no width
--         limit here; a 100,001-digit integer inserts fine. It reaches the client
--         as `Infinity`, and it occupies the top of the board on the way.
--
-- Note which comparison catches NaN, because the obvious one does not: for
-- `numeric`, `'NaN' = 'NaN'` is TRUE (unlike IEEE floats), so a `score = score`
-- guard passes it straight through. The upper bound is what refuses it —
-- `NaN < 1e15` is false. Both facts were checked against a live cluster.
--
-- WHERE THE BOUND COMES FROM. Not from feel. The engine was driven headless over
-- 12,000 seeded Infinite runs on its most extreme honest line — every dollar into
-- the riskiest tradable asset, every year, best-cash choice on every card — and
-- the largest score it produced was 15,511,231,154 (age 82, all-in crypto). The
-- largest loss over the same sweep was -3,711,410. A bound of ±1e15 clears the
-- observed honest maximum by about 64,000x while still refusing every value
-- above. Re-measure before widening it: scripts/qa/engine-props.mjs P15 pins the
-- headroom so this comment cannot quietly go stale.
--
-- This is not anti-cheat. A forged-but-plausible score is what replay
-- verification is for (`metrics.verified`). This stops the values that are not
-- scores at all — the ones that break ordering, rendering and storage.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 2. ⚠ THIS SECTION CAN DELETE ROWS. Read before running.
--
-- NOT VALID is the wrong tool here, and for the opposite reason to PART 1 § 6.
-- There, a NOT VALID constraint would have frozen legacy rows. Here it would
-- LEAVE THE EXPLOIT RUNNING: a NaN row already in the table is not touched by a
-- constraint that skips existing rows, and it goes on holding first place. The
-- point of the migration is that row.
--
-- Such a row cannot have come from the game. Over the 12,000-run sweep above the
-- engine produced zero non-finite scores, and its honest maximum is four orders
-- of magnitude inside the bound. A row outside it was posted at the REST API by
-- hand.
--
-- To see what would go before committing to it:
--
--   select id, user_id, mode, verdict, created_at
--     from public.results
--    where not (score > -1e15 and score < 1e15);
--
-- On a database that has only ever seen writes from the game this is empty, and
-- the delete below is a no-op. Every deletion is announced with RAISE NOTICE;
-- capture the output.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select id, user_id, mode, score::text as score_text
      from public.results
     where not (score > -1e15 and score < 1e15)
  loop
    raise notice 'results: deleting unrankable row % (user %, mode %, score %)',
      r.id, r.user_id, r.mode, r.score_text;
    delete from public.results where id = r.id;
    n := n + 1;
  end loop;
  if n = 0 then
    raise notice 'results: no unrankable rows — nothing deleted';
  else
    raise notice 'results: deleted % unrankable row(s)', n;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 3. The constraint, added FULLY VALID.
--
-- Valid rather than NOT VALID because section 2 has just cleared the table of
-- violators, so the scan cannot fail — and because a constraint that is not
-- enforced against what is already there does not close this particular hole.
-- The scan takes a brief lock on a table that holds one row per finished run.
-- ---------------------------------------------------------------------------
alter table public.results drop constraint if exists results_score_sane;
alter table public.results
  add constraint results_score_sane check (score > -1e15 and score < 1e15);
