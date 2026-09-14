# LifePatch — feature brainstorm, week of 2026-09-14

Five candidate features, drawn from a read of the current tree (`app/`, `components/`,
`lib/`, `src/audio/`, `supabase/schema.sql`), `README.md`, `DESIGN.md`, `docs/QA-REPORT.md`
and the last ~25 commits.

## Where the product actually is

- **Three modes.** Story (finite, 1990→2010), Infinite (1957→today, autosaves), Rat Race
  (`cashflow`, board game). Plus the **Daily Ledger**, which is not a fourth mode — it is one
  seeded Story run per UTC day (`lib/daily.ts`), surfaced as a docket above the mode cards.
- **The engine is deterministic and replayable.** `lib/replay.ts` can re-simulate a life from
  its journal (`verifyResult`) or re-simulate the *same* life with different money
  (`ghostFor`) — the counterfactual line on the report.
- **A real learning layer.** 26 concepts (`lib/concepts.ts`), a mastery level that only rises
  (`lib/cloud/mastery.ts`), and a miss-tally that answers what mastery can't
  (`lib/weakSpots.ts`) — which already re-weights the card draw (`coached: 1` in the result row).
- **A cloud layer that is done carefully.** Profiles behind a `profiles_public` view, results
  with verdict/score/size constraints, streaks, friends-by-code, mastery. Everything degrades
  to guest + `localStorage` with no configuration.
- **Audio is further along than most games ship with.** One 108 BPM score, nine stems, phase
  mixes and intensity ramps, driven from Story (`YearLoop`) *and* Rat Race
  (`useCashflowTurn.ts:175`). This is not where the gaps are.

The recent commit history is almost entirely defect work — correctness, RLS, guest paths,
challenge links. The engine and the cloud layer are solid; **the gaps are at the edges: the
debrief, mode parity, the social loop around the daily, and the phone.**

---

## 1. The What-If Lab — an interactive rewind on the report

**Difficulty: Medium**

Today the report prints exactly one counterfactual: *"every spare dollar in the index"*, a
single number and a ghost line. `replayRun(ticket, { allocate })` can already answer any
allocation question about the life you just played — same cards, same choices, same outcome
rolls, different money. We expose about 5% of what we built.

Make it a panel the player operates: pick an allocation (the existing `PortfolioPresets` —
all-index, 60/40, all-crypto, your-actual-mix-but-double-the-savings-rate), and the ghost line
redraws against your own life, with the delta stated in money. Second half of the feature:
**rewind to year N** — replay your run unchanged up to a year, then hand control back so the
player re-plays the branch they regret.

**Why it adds value.** The QA report's own design research (§9, Crookall 2010) says the
learning consolidates in the debrief. "You'd have finished $180k richer" is an assertion;
"drag this and watch it happen to *your* life" is a demonstration. It also converts the
report — currently a dead end with a share button — into a replay driver.

**Implementation sketch.**
- `lib/replay.ts`: expose the allocation parameter as a named set of strategies rather than
  the hardcoded index ghost; add `replayFrom(ticket, yearIndex)` returning a resumable
  `RunState` (the journal already carries everything needed; `hasFullJournal` is the gate).
- `components/screens/LifeReport.tsx`: a new section under the existing ghost rows.
  `AnnotatedLifeChart` already accepts `ghost` / `ghostLabel` / `ghostKind` — no chart work.
- Memoize per strategy; a 21-year Story replay is cheap, an Infinite run is not — cap and
  show the cost honestly, as the truncated-ghost copy already does.
- Rewind runs must post as a distinct thing, not as a fresh score: add `rewound: 1` to
  `metrics` (free-form jsonb, no migration) and keep them off the leaderboard, or the board
  becomes a save-scumming contest.

**Risk.** The ghost is only honest because the deal is forced (see the module header). A
rewind *does* re-deal from the branch point, so the two must not be presented as the same
thing.

---

## 2. Rat Race cross-device saves

**Difficulty: Easy–Medium**

`lib/cashflow/persist.ts` writes one `localStorage` key. The `saves` table's check constraint
is `mode in ('story', 'infinite')`. So a signed-in player who starts a Rat Race game on their
phone cannot continue it on a laptop — while that same game *does* post to the leaderboard
(`results` accepts `'cashflow'`) and *does* bump their streak. The mode is a first-class
citizen everywhere except the one place a player notices.

The Fast Track tail makes this worse than it sounds: QA §7 measured a **median 45 turns** for
a player chasing the dream without investments. That is not a single-sitting game on a phone.

**Why it adds value.** Removes the one place where signing in buys less than it promises, and
it is the cheapest retention fix on this list — a 45-turn game you can't resume elsewhere is a
45-turn game a lot of players abandon.

**Implementation sketch.**
- Migration widening the `saves` mode check to include `'cashflow'` (keep
  `saves_state_small`; a Rat Race state is small, but the ceiling is the point).
- Generalize `lib/saves.ts` off `ModeId`-typed `RunState` — either a second typed adapter or a
  discriminated `state` union. Guest → local, signed-in → cloud, exactly as today.
- Version handling already exists on both sides (`STATE_VERSION`, `migrateV1`, and
  `isCompatibleSave`'s "outdated, not broken" wording). Reuse the `OUTDATED_SAVE_MESSAGE` path
  rather than inventing a second vocabulary for a stale save.
- Conflict rule: last-write-wins per `(user_id, mode)` is what Story does, so match it.

---

## 3. Daily Ledger: how the world played today

**Difficulty: Medium**

The daily currently gives a private grid of you against your own index ghost, plus a
leaderboard that can filter to today. What it doesn't give is the thing that makes a daily
puzzle social: **where you landed among everyone who played the same world**, and **what
everyone else did on the card you agonised over**.

Ship two things on the post-run daily screen:
1. A percentile band — "you finished ahead of 68% of today's ledger" — plus a spoiler-free
   distribution histogram.
2. Per-decision choice rates on the run's three or four biggest cards: "81% took the
   severance. You didn't."

**Why it adds value.** The streak mechanic (`lib/cloud/streaks.ts`) and the shared-world
design are already built for a habit loop; what's missing is the social proof that makes
people come back and share. Choice-rate reveals are the highest-shareability artifact this
game can produce, and they cost no new content.

**Implementation sketch.**
- `metrics` is free-form jsonb under an 8 KiB cap — a per-year choice-id array for a 21-year
  Story run fits comfortably. **No migration for the data.**
- Do *not* aggregate client-side: pulling every row for today to compute a percentile is a
  bandwidth amplifier on a public read (the same reasoning behind `results_metrics_history_bounded`).
  Add a `security definer` RPC returning bucketed counts + choice tallies for one `daily` date,
  and the expression index `results_daily_idx` the README already documents.
- Guests read it fine (public select); the feature must not become a sign-in wall.
- **Spoiler rule is load-bearing:** the aggregate must never leak calendar years
  (`DESIGN.md` § Data honesty). Bucket by score and by relative year index only.

---

## 4. Drills — two-minute practice on what you keep getting wrong

**Difficulty: Medium (Hard if content is authored fresh)**

`lib/weakSpots.ts` knows precisely which concepts a player keeps blowing, and it already tilts
the next run's deal toward them. But the player only meets that knowledge as one sentence on
the report, and the tallies are **local-only, keyed to the progress id** — they don't follow
you to another device, which the module header admits.

Add a **Drill**: a 5-card, ~2-minute scenario run generated from your two weakest concepts,
with the outcome and the matching Almanac entry attached to each card. Reachable from the
report, from the Mastery Map, and from the mode select when a weak spot exists.

**Why it adds value.** Closes the learn loop the product already half-built: the game notices
your gap, tells you about it, and then offers nothing to do about it but play another 21-year
run. It's also the only short-session format in a game whose shortest mode is a full life —
which is the format that fits a phone on a bus.

**Implementation sketch.**
- Content: filter `lib/lifeEvents.ts` (104 events) by concept tag — `conceptsForText` already
  derives them — into a drill pool. No new writing required for v1; authored drill-specific
  cards are the upgrade path.
- Engine: reuse `initRun` with a short mode config and a forced card pool; drills do **not**
  post to `results` and do **not** bump streaks. They *should* feed `weakSpots` tallies and
  mastery, which is the whole point.
- Sync: fold miss-counts into the existing `mastery` table (add `attempts` / `misses` columns)
  rather than a new table — one migration, and weak spots start following the player.
- UI: `MasteryMap` is the natural home; a drill entry per weak concept, chartreuse tick when
  the tally turns around (the one sanctioned use of that hue).

---

## 5. Install to home screen + offline daily (PWA)

**Difficulty: Easy–Medium**

There is no `manifest.json`, no icons beyond `app/icon.svg`, and no service worker. For a game
that is mostly played on a phone, by teenagers, on a daily habit loop, the install prompt and
the offline start are free retention we aren't taking.

The architecture is already suited to it: the engine is pure, audio is **synthesized** (no
sampled assets — `SfxBank` is deliberately unwired), guest saves are `localStorage`, and the
daily puzzle is a pure function of the date, so **today's world can be computed with no
network at all**.

**Why it adds value.** An icon on the home screen is the difference between a site someone
visited once and a game they play daily — and the daily is the mechanic built for exactly
that. Offline also removes the cold-start latency on a bad connection, which is where a lot of
first sessions die.

**Implementation sketch.**
- `app/manifest.ts` (Next's metadata route) + maskable icons in the LEDGER palette;
  `themeColor` already resolves from `PALETTE.bg` in `app/layout.tsx`.
- A narrow service worker: precache the app shell and the fonts, network-first for `/r/[id]`
  and the leaderboard, cache-first for `/film` and `/board3d` media (they're already lazy).
- **Queue cloud writes while offline.** `submitRunOnce` is idempotent per key
  (`alreadySubmitted` / `markSubmitted` / `unmarkSubmitted`) — that is most of a durable
  outbox already. Replay on reconnect.
- An honest offline badge: leaderboards, friends and rooms are unavailable, and the UI should
  say which, not fail silently.
- **Cache-busting is the real risk.** A stale service worker pinning an old engine build
  against a live leaderboard is worse than no offline: version the cache on the build id and
  make save-compatibility (`isCompatibleSave`) the backstop it already is.

---

## Also considered, not shortlisted

| Idea | Why it's parked |
|---|---|
| Mobile Rat Race board polish (~268px² toast overlap, QA §7) | Real, but a defect with a documented "every alternative was worse" — needs design, not a feature slot |
| `/r/[id]` fallback without Supabase configured (QA §7) | One-afternoon fix; belongs in a bug sweep, not a feature week |
| Friend leagues / weekly seasons | Attractive, but leans on the daily-aggregate work in #3 — revisit after it lands |
| Classroom / cohort mode | Genuinely high-value for an educational product and the largest scope on the page; it needs a product decision about accounts and minors before an engineering one |
| Adaptive-audio work | Checked first, given the project's music mandate: phases, intensity, ambience and warmth swells are wired in both Story and Rat Race. Not a gap today |

## If you only pick one

**#2 (Rat Race saves)** is the smallest and fixes a promise we're currently breaking.
**#1 (What-If Lab)** has the highest value-per-line-of-code, because the hard part — a
deterministic, replayable engine with a full action journal — is already built and shipped.
