# Feature brainstorm — week of 2026-09-07

Five candidates, ordered by (value ÷ effort). Every gap below was read out of the
tree, not guessed: file references are the actual seams the work would open.

**Where the product is today.** Three modes (`lib/modes.ts`): Story (1990→2010,
finite, has multiplayer rooms), Infinite (1957→now, autosaves), Rat Race (the
cash-flow board game). On top of that sit the Daily Ledger (one seeded world a
day, `lib/daily.ts`), a public leaderboard with four scopes
(`lib/cloud/results.ts`), friends (`lib/cloud/friends.ts`), streaks, a concept
mastery map, a spoiler-safe share grid (`lib/dailyShare.ts`), and a
deterministic replay engine that can already re-simulate a life with different
money (`lib/replay.ts`). Everything works guest-first and offline; Supabase is
optional.

**The through-line in these five:** the engine already computes far more than
the UI ever shows, and the social surface is one join short of being social.

---

## 1. Daily Archive — play any past Ledger, unranked

**What.** A grid of every Daily Ledger since puzzle #1: which you played, how
each went, and a "play it" button on the ones you missed. Archived runs are
explicitly unranked and never touch today's board or the streak.

**Why it matters.** The daily is the retention engine and it is currently the
game's thinnest funnel: a player who discovers LifePatch on a Thursday has
exactly one puzzle to play, then nothing until tomorrow. Meanwhile the entire
back catalogue already exists and costs nothing to store — `dailyFor(date)` is a
pure function of a date string, so puzzle #14 is recomputable forever from four
characters. This is the rare feature where the content is already written and
only the door is missing. It also gives the share grid somewhere to point:
"Ledger #63, ▲▲▬▼…" is a dead link today.

**How.**
- `lib/daily.ts` — add `listDailyDates(from, to)` over the existing `DAILY_EPOCH`
  and `isDailyDate`. No new derivation; `dailyFor` already fixes seed, background
  and puzzle number.
- `lib/dailySave.ts` — `KEEP_DAYS = 10` is a quota guard for *today's* store and
  should stay; archive attempts want their own key prefix with the same
  one-record-per-day shape, so an in-progress archive run survives a refresh
  without competing with the live daily.
- Scoring: write the result with `metrics.daily = <date>` **plus**
  `metrics.archive = true`, and exclude archived rows in `lib/cloud/results.ts`
  (both the `top_results` RPC path and the PostgREST walk). This is the one
  genuinely fiddly bit — get it wrong and someone farms yesterday onto today's
  board. Suggest a QA script (`scripts/qa/archive-fence.mjs`) in the shape of the
  existing `challenge-fence.mjs`.
- UI: an archive sheet reachable from the daily strip
  (`components/screens/DailyStrip.tsx`), rendered as a ledger index — folio
  numerals, a verdict tier per row, dot leaders. Played rows show the grid;
  unplayed rows show a BEGIN.

**Difficulty: Medium.** ~2 days. Most of the risk is the leaderboard fence, not
the feature.

---

## 2. Friends × Daily — make the two social features intersect

**What.** Today's leaderboard scope is one-of-four: `all | week | friends |
daily` (`LeaderboardScope`, `lib/cloud/results.ts:38`). So you can see the world
on today's puzzle, or your friends across all time, but **not your friends on
today's puzzle** — which is the single most social thing this game could show.
Split the one enum into two orthogonal controls: an audience (everyone /
friends) and a range (all time / this week / today's Ledger).

**Why it matters.** The daily's whole promise is "same world, everybody" and the
payoff of that promise is comparing with people you know. Right now the compare
is with strangers. A friends-on-today board turns the existing share grid from a
broadcast into a duel, and it costs almost no new machinery — the friend edges,
the daily filter and the seed-matched challenge flow (`lib/challenge.ts`,
`?vs=<resultId>`) are all already built and already tested.

**How.**
- The data layer is *already orthogonal*: `topResults` passes `p_users` and
  `p_daily` to the `top_results` RPC as separate parameters, and the PostgREST
  fallback applies `.in("user_id", …)` and `.eq("metrics->>daily", …)`
  independently. The scope enum is what collapses them
  (`scope === "friends" ? friendIds : null`). Change the option type to
  `{ audience, range, daily? }`, keep a compatibility mapping for existing
  callers, and both query paths work unchanged.
- `components/social/Leaderboard.tsx` — the tab row becomes tabs (range) plus a
  persistent FRIENDS toggle; `cacheKey` gains the audience. Empty states need one
  new line ("None of your friends have played Ledger #63 yet — nudge them").
- The nudge is a challenge link that already exists: `useShareUrl` +
  `?vs=<resultId>` drops a friend onto the exact same world.
- Optional index if `results` grows: the README already documents
  `results_daily_idx`.

**Difficulty: Easy–Medium.** ~1 day. Mostly a type refactor plus one toggle; no
SQL required.

---

## 3. Counterfactual rewind — "what if I'd said no?"

**What.** In the end-of-run report, tap any decision in the journal and see the
same life re-run with that one choice flipped: a second dotted line on the chart
and a single sentence — "you'd have finished $214k behind."

**Why it matters.** LifePatch's stated goal is financial literacy through
consequence, and the strongest teaching moment in any simulator is a
counterfactual on *your own* life — not a generic lesson card. The index ghost
already proves players respond to a second line on the chart; this is the same
affordance pointed at a decision instead of an allocation. It is also the most
"screenshot-able" thing the game could add.

**How.**
- `lib/replay.ts` already does 90% of this. `replayRun(ticket, { allocate })`
  re-simulates the same life with different money by force-feeding the recorded
  `pendingEvents` from the journal. Add `ReplayOpts.overrideChoice?: { year,
  eventId, choiceId }` on the same driver.
- The caveat is in the module's own docstring and must be honoured: outcomes are
  salted by `(seed, year, eventId, choiceId)`, so flipping a choice legitimately
  changes the roll — but the *draw* must still come from the journal, or later
  years get dealt a different hand and the comparison stops being a
  counterfactual. Force the recorded draws; let only the outcome move.
- UI: `components/screens/LifeReport.tsx` journal rows become buttons;
  `components/share/AnnotatedLifeChart.tsx` already renders a ghost line and can
  take a third series. Keep it to one active counterfactual at a time — a chart
  with five dotted lines teaches nothing.
- Guard: only offer it on runs with a journal (`RUN_VERSION` 6+, per
  `lib/runEngine.ts:43`); older saves show nothing rather than a wrong line.

**Difficulty: Medium.** ~2–3 days, most of it in making the delta read as one
honest sentence rather than a wall of numbers.

---

## 4. The Coach — cross-device weak spots and a targeted drill

**What.** Two halves of one feature: (a) sync the weak-spot record to the cloud
so coaching survives a new device, and (b) spend it on something the player can
see — a short drill of 5 tagged decisions built from the concept you keep
blowing, plus a weekly "report card".

**Why it matters.** The clever half is already built and invisible.
`lib/weakSpots.ts` counts, per concept, how many tagged moments you met and how
many went badly; `initRun` snapshots it and `runEngine` doubles the draw weight
of cards that teach those concepts (`eventTeachesAny`). A player is being coached
right now and has no idea. Meanwhile the record is device-local — its own
docstring calls this out — so it resets when you switch phones, which is exactly
when a returning player most needs continuity. Surfacing it converts a hidden
system into a reason to come back, and mastery (which only ever goes *up*) can
finally show the other half of the truth.

**How.**
- Storage: mirror the `mastery` table's shape and posture — a `weak_spots` table
  (`user_id`, `concept_id`, `met`, `missed`, `updated_at`) with the same
  own-row-only RLS policies, plus the guest/local fallback that
  `lib/cloud/mastery.ts` already models. Everything must keep working with no
  Supabase configured; that is the house rule for this whole subsystem.
- Drill: `lib/eventConcepts.ts` already unions the concepts each life event
  *could* teach. A drill is a filtered draw over `LIFE_EVENTS` for one concept,
  run through the existing `LifeEventCard` outside a run, writing mastery on a
  correct application and weak-spot counts either way.
- Report card: extend `components/learn/MasteryMap.tsx` and
  `MoneyBrainMeter.tsx` to show hit rate beside level — "Leverage · level 2 · 3
  of 11". Chartreuse stays a reward mark per DESIGN.md; misses read as ink.
- Migration: additive only, in the `supabase/schema.sql` idempotent style, and
  covered by `scripts/qa/rls-migration.mjs`.

**Difficulty: Medium–Hard.** ~3–4 days. The sync is routine; the drill is a new
play surface and needs real writing and QA.

---

## 5. CI that actually runs the QA suite

**What.** There is no `.github/` in this repo. Nineteen QA scripts exist
(`scripts/qa/`) — palette contrast audit, engine property sweeps, golden draws,
RLS migration checks, multiplayer transport, screenshot smoke — and they run only
when someone remembers to type them. Add a `npm run qa` aggregate and a GitHub
Actions workflow: lint, typecheck, build, engine/property/QA scripts, then the
Playwright shots against a built server.

**Why it matters.** DESIGN.md states the rule outright — *"A pairing that has not
been measured does not ship"* — and notes that `palette-audit` sat cited but
uncommitted for months, ungateable by anyone. The last twenty commits are almost
entirely defect fixes found by hand-playing the game. This suite is the cheapest
per-hour quality lever in the repo and it is currently opt-in. It also makes
every other feature on this list safer to ship, which is why it is here rather
than in a backlog.

**How.**
- `package.json` — `"qa": "npm run lint && npm run typecheck && node scripts/qa/…"`
  chaining the pure-node checks; keep the browser-driven ones (`*-shot.mjs`,
  `smoke.mjs`) in a second script since they need a running server.
- `.github/workflows/ci.yml` — Node 24 (per `engines`), `npm ci`, the pure job on
  every push; a second job that runs `next build && next start` and points
  `QA_BASE_URL` at it. `scripts/qa/harness.mjs` already discovers a pinned
  Chromium via `/opt/pw-browsers/chromium-*` and falls back to Playwright's own
  download, so both environments work.
- No secrets: everything runs against the local/guest fallback path by design.

**Difficulty: Easy.** ~half a day, and it pays for itself on the first red build.

---

## Runners-up (not costed)

- **Rat Race is asymmetric.** Story has a daily seed, rooms, and a friends board;
  the board game has none of them. A seeded "Ledger of the day" for Rat Race
  would reuse `lib/cashflow/rng.ts` wholesale — but it is a Hard multi-week item
  because the board game's turn loop is much longer than a Story year.
- **Cloud-sync the daily save.** `lib/dailySave.ts` is honest that a second
  device is a second attempt. Worth doing only if the daily board starts
  mattering competitively — i.e. after #2.

---

## Suggested order

**#5 → #2 → #1 → #3 → #4.** CI first because it protects the rest; then the
cheapest social win; then the archive that gives the daily a back catalogue; then
the two teaching features, which need the most writing.
