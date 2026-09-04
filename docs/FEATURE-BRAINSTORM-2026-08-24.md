# LifePatch — feature brainstorm, week of 2026-08-24

Five candidates, ranked by impact-per-week. Each one was chosen because the
machinery it needs **already exists** in the codebase — none of these is a
green-field system, and the technical plans below name the actual files.

**Where the product is today.** Three modes (Story 1990→2010, Infinite
1957→now, Rat Race board game), a deterministic seeded engine
(`lib/runEngine.ts`, `lib/cashflow/`), a cinematic report + share card, an
optional Supabase layer carrying profiles / results / streaks / friends /
mastery, and live "With Friends" rooms for Story
(`lib/mp/`, `hooks/useMatch.tsx`). The last ~30 commits were a QA, rebalance
and redesign pass — the engines are correct and the screens are art-directed.
The gaps left are not polish gaps. They are **loop** gaps: nothing brings a
player back tomorrow, the education is incidental rather than deliberate, and
the competitive layer is neither comparable nor trustworthy.

---

## 1. The Daily Ledger — one world, everyone, once a day

**What it is.** A single shared run generated from the UTC date: same seed,
same background, same twenty years, one attempt per player per day. A "today"
leaderboard, and a spoiler-free share grid you can paste into a group chat —
one block per year, up/down/flat, no numbers, no verdict.

**Why it adds value.** Three problems, one feature:

- *Nothing brings anyone back tomorrow.* There is a `streaks` table with a
  loss-aversion habit loop designed into it, and the only thing that bumps it
  is finishing a run whenever you happen to play. A daily gives the streak
  something to be a streak *of*.
- *The leaderboard doesn't compare like with like.* Story runs share the
  historical returns but not the synthetic ones — `yearReturns(year, seed)` is
  seeded per run. Two players on the board did not live in the same world. A
  daily is the only board where the ranking is purely about decisions.
- *There is no growth loop.* The share card unfurls a beautiful link to your
  own statement — but a link to *your* result is a brag, not an invitation. A
  compact spoiler-free grid is the thing people actually paste, and it carries
  "here is today's world, go beat me" for free.

**Implementation plan.**

1. `lib/daily.ts` — `dailySeed(iso: string)` (string hash of `YYYY-MM-DD`) and
   `dailyConfig(iso)` returning `{ seed, backgroundId, mode: "story" }`. Pure,
   testable, no clock inside it (pass the date in).
2. Route `app/daily/page.tsx` mounts the existing Story flow with
   `initRun("story", cfg.backgroundId, name, cfg.seed)`. Zero engine changes —
   `initRun` already takes an optional seed for exactly this reason.
3. One attempt: `results` gains a `daily_date date` column plus
   `unique (user_id, daily_date)`. The DB enforces it; a localStorage key gives
   the fast local answer. `submitRunOnce` already dedupes on a caller-supplied
   `runKey` — pass `daily:${iso}`.
4. Board: add `"daily"` to `LeaderboardScope` in `lib/cloud/results.ts` and a
   `where daily_date = $today` branch alongside the existing `week` filter.
   `components/social/Leaderboard.tsx` gets one more tab.
5. Share grid: derive from `run.history[].netWorth` deltas — a string of block
   glyphs plus the day number and the share URL. New small module next to
   `components/share/drawShareCard.ts`; no canvas work needed.

**Watch out for.** Pick UTC and print it in the UI, or every timezone argues
about when "today" starts. Ship the run and the streak first; the board can
follow a day later without a schema rewrite.

**Difficulty: Medium.** (Easy without the leaderboard scope.)

---

## 2. The Ghost Line — what boring would have done

**What it is.** On the end-of-run report, a second dashed line on the
net-worth chart: the same person, the same salary, the same life events, the
same markets — but every spare dollar went into the index and nothing was ever
traded. Plus one headline number: the gap.

**Why it adds value.** The whole thesis of this game is that boring, correct
choices compound and clever ones usually don't. Right now the report *asserts*
that in copy (`lib/verdict.ts`, the Almanac). The ghost **proves it against
the player's own run**, in their own numbers, on the world they just lived.

It also fixes the worst emotional moment in the product. A bad run currently
ends in a verdict that reads as a scolding ("The math caught up"). With a ghost
line it ends in a diagnosis you can act on — *this specific decision cost you
this much* — which is the difference between a player who quits and a player
who hits "run it back".

**Implementation plan.**

1. `lib/ghost.ts` — `simulateGhost(run: RunState): number[]`. Everything it
   needs is already persisted: `run.marketLog` holds the realised per-asset
   returns for every year lived, and `run.history[].cashFlow` holds the money
   that was actually available each year.
2. Hold one variable. The ghost lives the **same life** — same job, same kids,
   same crash, same medical bill — and only allocates differently: replay each
   year taking `cashFlow` from `history` and compounding it at that year's
   index return from `marketLog`. Because it reads the log rather than
   re-rolling, the ghost can never accidentally live in a different world, and
   the comparison stays one-variable and defensible.
3. Render: a dashed line in `components/share/AnnotatedLifeChart.tsx`. Per
   `DESIGN.md` this must be **ink**, not a new hue — orange is identity, green
   and red are money, and the ghost is neither. A dashed ink line at the
   secondary tier is the right vocabulary and needs no palette amendment.
4. Report plate in `components/screens/LifeReport.tsx`, next to the existing
   best/worst market year cards.
5. Store `ghostFinal` in the result `metrics` so `/r/[id]` and the OG image
   (`app/api/og/[id]/route.tsx`) can show the gap on the shared statement too —
   that single number is a far better unfurl than a bare net worth.

**Cost.** 20–60 loop iterations of pure arithmetic at report mount. No I/O, no
new dependency, no engine change.

**Difficulty: Medium.**

---

## 3. Rat Race with Friends

**What it is.** Extend the existing live rooms from Story to the board game:
same room codes, same lobby, same podium — a shared board, a turn baton, and a
per-turn timer.

**Why it adds value.** The Rat Race is a *table* game. Playing it against
nobody is the weakest social surface in the product, and it's also the mode
that teaches the most (the freedom meter, deal analysis, the payday loop).
Watching a friend take a deal you passed on is the lesson; alone, there's no
one to compare against.

**Implementation plan.**

1. `MatchConfig` (`lib/mp/types.ts`) gains `mode: "story" | "cashflow"`; bump
   the protocol version in `lib/mp/protocol.ts` so older clients drop rather
   than coerce.
2. Swap the year clock for a **turn baton**. The acting host broadcasts
   `turn { playerIndex, cursor }`; each client rolls locally from
   `rngAt(seed, cursor)`. This is the piece that makes the whole feature
   tractable: `lib/cashflow/rng.ts` is *already* pure and cursor-threaded, and
   `CashflowState` already carries `seed` + `rngCursor`. Dice and card draws
   are therefore identical on every client with no state sync at all — the same
   trick the Story rooms use for markets.
3. Deck order derives from the same seed, so everyone's DEAL pile is the same
   pile in the same order.
4. `PeerStatus` gains `passiveIncome` / `escaped`; `MatchRail` and
   `MatchPodium` read `lib/cashflow/selectors.ts` instead of `netWorth`.
5. AFK handling: generalise `lib/mp/autoResolve.ts` to "roll, decline every
   deal, pass" so one person leaving their phone doesn't freeze the table.

**Risks (the reason this is the Hard one).** Turn-based means one slow player
blocks four others — the per-turn timer is not optional, it's the feature.
Cashflow state is much larger than a Story year tick, so the snapshot/rejoin
path in `hooks/useMatch.tsx` needs generalising rather than reusing. And that
hook is already 1,586 lines; this should land as a mode adapter, not as more
branches inside it.

**Difficulty: Hard.**

---

## 4. Weak Spots — the Money Brain finally spends what it records

**What it is.** Two changes that close an open loop. (a) The report names the
two concepts you're weakest on, each linking straight into the matching
Almanac entry. (b) The next run's event draw gently favours those concepts.

**Why it adds value.** There is a full financial-literacy taxonomy in
`lib/concepts.ts`, mastery levels recorded per concept in the cloud, a mastery
map and a Money Brain meter — and **nothing reads any of it back**. Mastery is
currently a scoreboard for a lesson nobody is assigned.

Naming a weakness and pointing at the fix converts incidental education into
deliberate education, which is the actual product claim. And the draw bias is
the cheapest replayability in the codebase: run N+1 differs from run N without
a single new piece of content being written.

**Implementation plan.**

1. `weakestConcepts(mastery, touchedThisRun, n)` in `lib/cloud/mastery.ts`.
2. A card in `LifeReport` beside `MoneyBrainMeter`. Chartreuse is already
   sanctioned for mastery ticks (`DESIGN.md` § Palette), so this needs no
   design amendment.
3. Deep-link the Almanac: `?concept=<id>` handled in
   `components/screens/Almanac.tsx`, plus a concept-id → entry map in
   `lib/almanac.ts` (most concepts already have a matching term or method).
4. Draw bias — **and here is the constraint that defines the design**:
   `drawEvents` must stay a pure function of `(seed, year, life state)`, or two
   players in a match room stop sharing a world. So the weights are computed
   **once at `initRun`** and passed in as run state; they can never be read
   live from the cloud mid-run. Match runs pass no weights at all.

**Difficulty: Medium.** The report card on its own is Easy and worth shipping
first — the bias can follow once the weights plumbing is proven.

---

## 5. Results you can trust — verified replays and comparable boards

**What it is.** Submit a compact replay alongside every score, verify it by
re-simulating server-side, and normalise the boards so the ranking measures
skill rather than duration or engine vintage.

**Why it adds value.** Two problems that only get worse with an audience:

- *Any score can be forged.* The `results` insert policy is
  `with check (auth.uid() = user_id)` — a signed-in player can post any number
  they like straight from the browser console. A forgeable leaderboard is worse
  than no leaderboard, because it silently converts the top of the board into
  noise and every honest player learns that at the same moment.
- *Scores aren't comparable.* Infinite ranks by final net worth, so a sixty-year
  run beats a thirty-year one on longevity alone. And `cashflowScore` already
  carries a `scoreVersion` in `metrics` precisely because v1 and v2 rows aren't
  comparable — with no way to filter on it, so they're mixed anyway.

**Implementation plan.**

1. Persist the replay: `(seed, backgroundId, mode, yearChoices)` — the engine
   is deterministic, so those four fields *are* the run. `RunState.yearChoices`
   already stores `eventId → choiceId|outcomeIdx`.
2. Verify by re-simulating. Because the engine is pure TypeScript with no DOM
   or I/O, the exact same module runs in a Supabase Edge Function or a Next
   route handler. Recompute the score; accept it or reject it.
3. `results` gains `replay jsonb`, `engine_version int`, `verified boolean`.
   Tighten the insert policy so only the verifying endpoint (service role) can
   write, and have the boards read `verified` rows.
4. Normalise: rank Infinite by net worth per year lived (or CAGR), and filter
   every board by `engine_version` so a rebalance never silently mixes eras.

This is also the prerequisite for anything competitive on top of it —
including the daily board in idea #1, tournaments, and classroom leaderboards.

**Difficulty: Hard.** Ships in two halves: schema + normalisation first (a
day), verification endpoint second.

---

## Also considered

- **PWA install + offline play.** The game already runs fully client-side with
  a localStorage fallback and no configuration, so "add to home screen, play on
  the bus" is close to free — a manifest, an icon set, and a cache-first worker.
  Held back only because the payload is heavy (three.js, video beats, Tone.js)
  and would want an audit first.
- **Engine tests in CI.** `docs/QA-REPORT.md` cites 9,600 simulated games and
  ~1.5M state transitions, but those sweeps live in ad-hoc scripts — the repo
  has no unit test runner, only browser smoke journeys. A property test that
  asserts `assets − liabilities === netWorth` after every mutation would have
  caught the double-counted mortgage that produced the "$1.2M in debt" bug, and
  it's an afternoon's work. Not a feature, but it protects all five above.
- **Recorded foley.** Every SFX is synthesised today and `SfxBank` is already
  written as the drop-in for real audio files — blocked on an authorised
  provider, not on code.

## Suggested order

**#2 (Ghost Line)** first — highest value per day of work, no schema change, no
new surface, and it strengthens the report, the share page and the OG card at
once. Then **#1 (Daily Ledger)** for the retention loop, with **#4's report
card** riding along in the same pass since both land in `LifeReport`. **#5**
before the daily board gets real traffic. **#3** when there's a week to spend.
