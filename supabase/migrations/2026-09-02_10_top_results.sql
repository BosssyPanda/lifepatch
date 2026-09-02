-- ===========================================================================
-- LifePatch — one round trip for a board that was taking up to seven.
--
--   OPTIONAL, and safe in either order. `topResults` calls this and falls back
--   to the page-walk it replaces when the function is absent, on the same
--   "no deploy ordering required" reasoning `fromFunction` uses in
--   lib/cloud/profiles.ts. A project that never applies this file keeps working
--   exactly as it does today, just slower.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- Why the walk exists, and why it costs what it costs.
--
-- The board shows each player's single BEST run. PostgREST has no `distinct on`,
-- so that dedupe had to happen in the client, and a single fixed over-fetch
-- assumed the top `limit * 5` scores belong to at least `limit` different people
-- — which is false exactly when the board is healthy. Ten regulars with twenty
-- finished runs each can hold the top 125 scores between three of them, and the
-- "Top 25" then renders three rows.
--
-- Walking pages until enough distinct players appear is the correct answer to
-- that, and it is what `topResults` does. The cost is that the pages are strictly
-- SEQUENTIAL: each `await` is a full round trip and the loop cannot know it is
-- done until the previous page returns. A board dominated by a few regulars — the
-- case the walk exists for — is six serial round trips, then a seventh for the
-- profiles. On mobile at ~200ms RTT that is over a second of spinner before the
-- first row appears.
--
-- `distinct on` is one line in Postgres. The dedupe belongs there.
--
-- SECURITY INVOKER, deliberately. `results` carries a "public read" policy, so
-- this needs no elevation to see what the board is allowed to see — and running
-- as the caller means RLS still decides, rather than this function becoming a
-- second, weaker answer to the same question. Two SECURITY DEFINER functions
-- already show up in the project's advisor output; this is not going to be a
-- third when it does not need to be.
--
-- The score bounds mirror `rankable()` in lib/cloud/results.ts rather than
-- trusting `results_score_sane`: the CHECK constrains rows written since it
-- landed, and Postgres sorts NaN ABOVE every real number, so one older row could
-- otherwise hold first place forever. Belt and braces, in the one query that
-- decides the ordering.
-- ---------------------------------------------------------------------------
create or replace function public.top_results(
  p_mode       text,
  p_limit      int         default 25,
  p_since      timestamptz default null,
  p_background text        default null,
  p_daily      text        default null,
  p_users      uuid[]      default null
)
returns table (
  id           uuid,
  user_id      uuid,
  mode         text,
  score        numeric,
  verdict      text,
  created_at   timestamptz,
  verified     text,
  -- Quoted to keep the camelCase the client's projected `select` already
  -- produces, so `fromProjectedRow` reads this identically either way.
  "backgroundId" text
)
language sql
stable
security invoker
set search_path = public
as $$
  select b.id, b.user_id, b.mode, b.score, b.verdict, b.created_at,
         b.metrics->>'verified'     as verified,
         b.metrics->>'backgroundId' as "backgroundId"
    from (
      -- One row per player: their best, ties broken by id so the result is a
      -- total order and two calls cannot disagree.
      select distinct on (r.user_id) r.*
        from public.results r
       where r.mode = p_mode
         and r.score > -1e15 and r.score < 1e15
         and (p_since      is null or r.created_at >= p_since)
         and (p_background is null or r.metrics->>'backgroundId' = p_background)
         and (p_daily      is null or r.metrics->>'daily' = p_daily)
         and (p_users      is null or r.user_id = any (p_users))
       order by r.user_id, r.score desc, r.id asc
    ) b
   order by b.score desc, b.id asc
   limit p_limit;
$$;

-- The board is readable by guests — `topResults` deliberately reads the cloud for
-- them, because guarding it would blank the leaderboard for everyone without an
-- account. So both client roles may call this; RLS on `results` is what decides
-- which rows come back, exactly as it does for the page-walk this replaces.
grant execute on function public.top_results(text, int, timestamptz, text, text, uuid[])
  to anon, authenticated;
