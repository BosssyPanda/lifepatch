# LifePatch — feature brainstorm, week of 2026-09-21

Five candidates, ranked by value-per-unit-of-work. Every claim about what already
exists was checked against the code, and each plan names the files it would touch.

## Where the product actually is

`main` is ~39k lines of TypeScript across four ways to play — **Story** (1990→2010),
**Infinite** (1957→today), **Rat Race** (the cash-flow board game), and the **Daily
Ledger** (one seeded Story world a day, shared by everybody). Underneath sit three
things most games this size don't have:

- **A pure, seeded, deterministic engine.** Markets are a hash of `(year, seed)`,
  card draws re-seed from `(seed, year)`, outcome rolls salt on
  `(seed, year, eventId, choiceId)` (`lib/runEngine.ts`, `lib/markets.ts`).
- **A journal of what the player did** (`RunState.journal`) plus a replay driver
  that can re-simulate a finished life exactly, or re-simulate it with different
  money (`lib/replay.ts` — `replayRun`, `verifyResult`, `ghostFor`).
- **A financial-literacy taxonomy** wired into both games: 30-odd concepts
  (`lib/concepts.ts`), cloud mastery levels (`lib/cloud/mastery.ts`), and a local
  miss-counter (`lib/weakSpots.ts`) that already biases the event draw.

The last several weeks of commits were almost entirely **hardening** — RLS, result
integrity, guest gates, multiplayer reconnection, palette audits. The foundations
are in unusually good shape and are currently under-spent. Every idea below is
leverage on something already built, not new machinery.

---

## 1 — The Daily Archive (+ one streak repair a week)

**What it is.** Let players open any past Daily Ledger back to `DAILY_EPOCH`
(2026-01-01), play it, and see that day's board. Archive runs are marked as such:
they post to that day's leaderboard, never to today's, and never touch the streak.
Separately, one "repair" a week lets a player close a single missed day and keep a
streak alive.

**Why it's worth doing.** A new player today lands on a daily game with an empty
history and one puzzle. There are already **260+ authored-by-determinism worlds**
sitting behind `dailyFor(date)` that nobody can reach — the single largest pile of
content in the product, costing zero new writing. And the streak (`lib/cloud/streaks.ts`)
is the retention loop, but it's currently all-or-nothing: miss one day on a trip and
the loss-aversion that made it work is gone for good. A repair is the standard fix
and it's the cheapest churn saved in this list.

**How.** Most of the query layer is done:

- `lib/daily.ts` — `dailyFor(date)` is already pure and already handles any date;
  add `archiveDates()` and an `isArchive` marker on the puzzle.
- `lib/cloud/results.ts` — `LeaderboardScope` **already has `"daily"` and already
  takes a `daily: "YYYY-MM-DD"` parameter**. The archive board is a parameter
  change, not a new query.
- `lib/dailySave.ts` — keyed per-day already, but `KEEP_DAYS = 10` prunes history.
  Archive runs want their own key prefix so they can't evict the real daily.
- `components/screens/DailyStrip.tsx` — the docket expands into a month grid
  (played / missed / today), in the existing section grammar.
- `lib/cloud/buildResult.ts` — `metrics.daily` already carries the date; add
  `metrics.archive: true` so today's board can exclude them.
- Streak repair: a `repairs` counter on the `streaks` row (one migration,
  additive), spent through the existing `nextStreak` pure function.

**Difficulty: Easy–Medium.** The archive alone is Easy. Streak repair adds a
migration and an anti-abuse rule (repair only a day inside the current streak's
window, at most one per ISO week).

---

## 2 — Rewind: fork a finished life at any decision

**What it is.** On the end-of-run report, every journal row gets a REWIND control.
Tap it and the game re-simulates the *same life* — same seed, same cards, same
markets — with that one choice flipped, and draws the counterfactual net-worth line
next to the one you actually lived. "You took the severance. Here's the you that
didn't."

**Why it's worth doing.** This is the teaching moment the whole product is built
around, and it's the one the report currently can't deliver. The ghost line answers
"what if you'd just bought the index" — a comparison against a robot. Rewind answers
"what if *I'd* said no", which is the question players actually leave with. It's also
the most shareable artifact the game could produce: two lines from one seed, one
decision apart.

**How.** The hard half is already shipped. `replayRun` re-simulates from the journal
with the deal **forced** — that's exactly the mechanism a counterfactual needs, and
the module header already explains why a redraw would be a different life rather than
a counterfactual. Today `ReplayOpts` exposes only `allocate`.

- `lib/replay.ts` — add `ReplayOpts.choices?: Record<number, string>` (year →
  choiceId) and apply it in the driver where the journal's act is read. The outcome
  roll is salted by `(seed, year, eventId, choiceId)`, so the other branch is
  already well-defined and reproducible — nothing new needs to be random.
- Guard with `availableChoices(eventContext(s))`: a forked choice whose `requires`
  fails at the moment it's taken must lock, exactly as it does in live play.
  This is the one real correctness risk and it has an existing answer.
- `components/share/AnnotatedLifeChart.tsx` — a third line (fork), reusing the ghost
  line's drawn-path treatment; palette-wise it reads as ink, not as a money colour.
- `components/screens/LifeReport.tsx` — the REWIND affordance per journal row, gated
  on `hasFullJournal`.
- Share: `app/api/og/[id]/route.tsx` can render the fork delta as the OG image.

**Difficulty: Medium.** Roughly a week. The engine work is small and testable
(`scripts/qa/engine-props.mjs` is the right home for "a fork of a run with no
overrides is byte-identical to the run"); most of the effort is the report UI.

---

## 3 — Drills: a two-minute session aimed at what you keep getting wrong

**What it is.** A short mode — five tagged decisions, no portfolio, no years — drawn
from `LIFE_EVENTS` filtered to the concepts the player keeps missing. Graded, feeds
mastery, ends on a one-screen "Money Brain" delta. Offered from the daily docket on
days the player has already played, and on the report when a weak spot is named.

**Why it's worth doing.** Two gaps close at once. First, the only session the game
currently offers is a **full run** — twenty-one years, ten-plus minutes. There is
nothing to do in a spare two minutes, which is most of a teenager's sessions.
Second, `lib/weakSpots.ts` already knows what the player keeps blowing, and its own
header calls out the limitation honestly: it's local-only, so *"your weak spots do
not follow you to another device."* Mastery is already in Supabase; the miss-counter
is the half that never made it. Drills give that record somewhere to pay off.

**How.**

- `lib/drill.ts` (new, pure) — pick concepts via `topWeakSpots`, select events with
  the existing `eventTeachesAny` (`lib/eventConcepts.ts`), roll outcomes with a
  drill-salted seed so a drill is reproducible and shareable. No engine changes: a
  drill is `applyLifeChoice` against a synthetic `EventContext`.
- Reuse `components/run/LifeEventCard.tsx` and `ConsequenceBeat.tsx` wholesale — the
  cards and the reveal beat already exist and already look right.
- Cloud: extend the `mastery` table with `attempts` / `misses` (additive migration,
  same RLS shape as the existing policies) and sync `weakSpots` through it, so the
  documented limitation goes away for signed-in players and guests keep working
  exactly as they do now.
- `components/learn/MasteryMap.tsx` gets a "drill this" entry point per concept.

**Difficulty: Medium.** The migration is trivial and additive; the content is free
(104 events, already tagged). The care is in not letting a drill feel like a quiz —
it has to keep the consequence beat, which is why reusing the run's card components
matters.

---

## 4 — Installable: manifest, offline shell, home-screen daily

**What it is.** Ship a web app manifest and a narrow service worker so LifePatch
installs to a phone home screen and the app shell plays offline.

**Why it's worth doing.** There is no `app/manifest.ts`, no service worker, and no
maskable icons — just `app/icon.svg`. For a daily game aimed at phones, the home
screen icon *is* the retention mechanism; a bookmark in a tab strip is not. And the
game is unusually well-suited to it: with no Supabase configured it already runs
entirely on `localStorage`, and the engine is pure with no server calls in the play
loop. An offline daily on a bus is a feature the architecture already earned.

**How.**

- `app/manifest.ts` (Next's metadata route) + maskable 192/512 icons in the LEDGER
  palette. `display: "standalone"`, `background_color`/`theme_color` = `#131110`.
- A hand-written service worker (no Workbox): precache the shell, cache-first for
  `/public/film/*`, `/public/board3d/*` and fonts, **network-only for anything
  Supabase** — a cached `results` or `saves` response would be a correctness bug, and
  an auth response would be worse.
- Version the cache on build id and take over on activate; a stale shell against a
  bumped `RUN_VERSION` is the failure mode to design against.
- An install prompt in the daily docket, offered once, dismissible, remembered.
- Guard: `NEXT_PUBLIC_*` values are inlined at **build** time (README §Optional),
  so a cached shell pins yesterday's config — the cache key has to move with the
  build, not with a date.

**Difficulty: Medium.** The manifest is an afternoon. The service worker is the
week, and it's mostly discipline about what must never be cached.

---

## 5 — The Week: async friend leagues over seven dailies

**What it is.** A seven-day league. Friends' daily results roll up into one standing
that sits for a week, with a Sunday finish and a one-line result to paste. No lobby,
no live clock, no one has to be online at the same time as anyone else.

**Why it's worth doing.** Multiplayer today is a **live room** (`hooks/useMatch.tsx`,
2,134 lines of clock, host migration and resync) — very good, and it requires
everyone in the same ten minutes, which is the hard part of playing with friends.
Everything an async league needs already shipped for other reasons: the `friends`
table and the sheet that adds by code, `topResults({ scope: "friends" })`,
`metrics.daily` on every posted result, and a daily world that is identical for
everyone by construction. This is the highest-value use of the multiplayer surface
per line of new code in the list — and it makes the friends graph, which currently
only feeds one leaderboard tab, worth building.

**How.**

- `lib/league.ts` (new, pure) — an ISO-week id, the seven dates it covers, and a
  scoring rule over `ResultRow[]`. Prefer **placement points per day** over summed
  net worth: one absurd Infinite-style run shouldn't decide a week, and placement
  rewards showing up, which is the behaviour the league exists to buy.
- Query: `topResults({ scope: "friends", daily: date })` for each of the seven days,
  or one widened RPC. The `top_results` function already exists
  (`supabase/migrations/2026-09-02_10_top_results.sql`) and is the right place.
- **No new table.** Standings are derived from `results` + `friends`, so there is
  nothing new to secure — the posture the rest of the cloud work has held.
- `components/social/LeagueBoard.tsx` + a tab beside the existing scopes;
  `lib/dailyShare.ts` gains a week block in the same spoiler-safe glyph vocabulary
  (shape, not colour — the existing rule).
- Optional: the `results_daily_idx` expression index the README already documents,
  once seven-day scans are the common query.

**Difficulty: Medium.** Easy if the first cut is a read-only standings view;
the Medium is the week-boundary handling (UTC daily dates vs. local streak dates —
`lib/daily.ts` already documents exactly why these two disagree at the edges, and a
league must key on the UTC daily date).

---

## Recommendation

If one lands this week: **#2 Rewind**. It's the strongest differentiator, it's the
best answer to "what did I learn", and the deterministic replay driver it needs is
already written and already tested.

If two: **#1 Daily Archive** alongside it. Easy, it fills the emptiest screen in the
product with content that already exists, and streak repair is the cheapest churn
saved on the list.

**#4** is infrastructure that quietly multiplies #1 and #5, and should be scheduled
before a marketing push rather than after one.

### Also considered, not written up

- **Rat Race ↔ Story crossover** — the board game already feeds the shared concept
  taxonomy (`conceptsForText` in `CashflowGame.tsx`), but nothing in one mode ever
  references the other. One Money Brain, two teachers, zero acknowledgement.
- **A spectate/replay view on `/r/[id]`** — `verifyResult` can already prove a
  posted score, so a share page could *play back* the life rather than print it.
- **Seeded challenge ladders** — `?vs=` exists and works; a chain of five
  progressively harder worlds is mostly copy.
- **Adaptive score cues per era** — nine stems and a documented 16-bar cycle
  (`src/audio/score.ts`) with no crash stinger keyed to `macroEvent`.
