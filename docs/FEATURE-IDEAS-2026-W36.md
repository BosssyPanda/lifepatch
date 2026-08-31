# Feature ideas — week of 2026-08-31

A read of the current codebase (engine, cloud layer, multiplayer, daily, learning
loop) against what the product is trying to be: a financial life simulator that is
*sticky* and *teaches*. Five candidates, ordered by value-per-unit-of-work.

## Where the codebase actually is

Worth stating, because it decides which ideas are cheap:

- **The engine is pure and deterministic, and it now records what the player did.**
  `lib/runEngine.ts` seeds markets off `(year, seed)`, and `RunState.journal` logs
  every action. `lib/replay.ts` turns those two halves into exact re-simulation
  (`verifyResult`) and counterfactuals (the ghost line). This is a large, mostly
  unspent asset.
- **The cloud layer is broad but unevenly surfaced.** `results`, `profiles`,
  `streaks`, `friends` and `mastery` tables all exist with tightened RLS, and
  every submitted run already carries `seed`, `backgroundId`, `verified` and a
  per-year `history` series in `metrics` (`lib/cloud/buildResult.ts`). Some of
  that has no UI at all.
- **Multiplayer is real but Story-only** (`lib/mp/`, `docs/MULTIPLAYER.md`): a
  shared seed, a year clock, peer status rows, ghost-play for disconnects. No
  game server, no rooms table.
- **Two things are explicitly local-only and say so in their own comments**: the
  daily save (`lib/dailySave.ts`) and weak spots (`lib/weakSpots.ts`).
- **The last three weeks were almost entirely defect and security work** — RLS
  holes, NaN scores, guest results, room lifecycle. The foundation got hardened;
  very little new player-facing surface shipped.

---

## 1. Same World, Different Life — head-to-head on a seed

**What it is.** Every share page (`/r/[id]`) becomes an invitation instead of a
receipt. A **Play this world** button starts a fresh run on that row's exact
`seed` + `backgroundId`, and when the challenger finishes, the two lives are drawn
on one chart: same markets, same opening, two decision sets. The Daily Ledger's
spoiler-safe glyph grid (`lib/dailyShare.ts`) gets a second row — theirs against
yours, year by year.

**Why it adds value.** Right now a share link is a dead end: a stranger sees a
number and a chart, and the only call to action is BEGIN into an unrelated random
world. A seed challenge closes the loop — the link *is* the game, the comparison
is the hook, and "I got $340k on your world" is the message people actually send.
It is also the most honest form of competition the engine can offer, because a
shared seed removes luck from the comparison in a way an all-time leaderboard
never can.

**Implementation sketch.**
- `initRun(mode, backgroundId, name, seed)` already takes a seed; wire the share
  page's `metrics.seed` / `metrics.backgroundId` into a run-start deep link
  (`/?w={seed}&bg={id}`), consumed in `AppShell`.
- Rival lookup is one PostgREST filter on `metrics->>'seed'` — the index for it
  is already documented in the README (`results_seed_idx`) and not yet needed.
- Overlay drawing is an extension of `components/share/AnnotatedLifeChart.tsx`,
  which already renders one `history` array; take two and label them.
- Grid comparison reuses `indexGrid` from `lib/replay.ts` — no new data, no new
  table, no migration.

**Difficulty: Medium.** Mostly UI plus one query. Zero schema change. The only
real design question is what a challenge run is worth on the general leaderboard
(recommendation: it scores normally — the seed is public, but so is everyone's).

---

## 2. Ship the friends layer that is already written

**What it is.** `components/social/Leaderboard.tsx` carries a comment titled *"NO
FRIENDS TAB UNTIL THERE IS A WAY TO ADD ONE."* It is accurate: `topResults`
filters by friend ids, `listFriendIds` reads the edges, the RLS makes friendship
mutual by construction — and `addByCode`, `accept` and `listIncoming` have **no
callers anywhere in the app**. Nothing renders the player's friend code. This
idea is the missing quarter: a profile sheet that shows your code (with a QR —
`qrcode` is already a dependency and already used by the share card), an add-by-
code field, an incoming-requests inbox, and the one-line restoration of the
`friends` scope tab.

**Why it adds value.** A private board of eight people you know beats a global
board of strangers for retention, and it is the natural landing spot for someone
who just played a room together. It also makes the *existing* With Friends rooms
repeatable — today a room is a one-off; after it, the players have no relationship
in the app.

**Implementation sketch.**
- New `components/social/FriendsSheet.tsx`: own code + copy + QR, add-by-code
  field calling `getByFriendCode` → `addByCode`, pending list calling
  `listIncoming` / `accept`.
- `Profile` (with `friendCode`) is only ever your own — `getProfile` returns it
  already; `PublicProfile` deliberately does not, and must stay that way.
- Re-add `{ id: "friends", label: "Friends" }` to `SCOPE_TABS`; the query, the
  empty state and the copy are already correct.
- Guest posture: a friend edge needs a real account. The sheet should prompt
  sign-in rather than render a broken code.

**Difficulty: Easy.** Almost entirely new UI over finished, tested plumbing.

---

## 3. The Rat Race, with friends

**What it is.** Multiplayer for the board mode. Four players in one room, one
board, taking turns — the mode that is *inherently* social is the only one that is
single-player today.

**Why it adds value.** The Rat Race is the mode people already know how to invite
a friend into, because its physical ancestor is a party game. It is also the mode
with the longest natural session, and the one where a second player fixes the
weakest part of the experience: waiting through someone's dice roll is fine when
it is a person and dull when it is nobody.

**Implementation sketch.** The hard parts exist:
- `lib/mp/transport.ts` + `roomCodes.ts` + presence/host-migration are mode-
  agnostic enough to reuse; `protocol.ts` needs a second message family.
- The clock model has to change, and this is the real work. Story broadcasts a
  *year tick* to clients simulating in parallel; a board game is **sequential** —
  the acting player's roll must be authoritative, or two clients diverge on the
  first branch. Simplest safe design: the acting host owns a turn cursor, each
  roll is `(roomSeed, turnIndex, playerIndex)` through `lib/cashflow/rng.ts` so
  every client derives the same die from the same cursor, and a turn advances on
  an explicit `endTurn` rather than a timer (with a generous idle auto-pass reusing
  the `autoResolve` idea from `lib/mp/autoResolve.ts`).
- A shared board state snapshot per player, same shape as the Story `snapshot`
  message, so rejoin and ghost-play work the same way.

**Difficulty: Hard.** The turn model is genuinely different from the year clock,
and the failure mode (two clients disagreeing about a die) is exactly the class of
bug the last three weeks were spent killing. Worth doing, worth not rushing —
recommend a design note before code, and reuse `scripts/qa/mp-room.mjs` +
`mp-transport.mjs` as the gate.

---

## 4. The Coach — weak spots that follow you, and know what to say

**What it is.** `lib/weakSpots.ts` tracks per-concept hit/miss tallies and the
report names the two things you keep getting wrong; `initRun` snapshots them and
the deck leans into them. Three things are missing:

1. It is **local-only** and the module says so plainly — your weak spots do not
   follow you to another device, while `mastery` (the other half of the same
   picture) does.
2. Nothing is said **before** a run. The insight lands in the report, after the
   decisions it would have improved.
3. `lib/almanac.ts` is a good body of authored teaching content that is not
   connected to any player's actual record.

The feature is one loop: sync the tallies, open a run with a two-line brief
("Last three lives, you sold in every crash — watch the market cards"), and link
each named weak spot to its Almanac entry.

**Why it adds value.** This is the product's stated point of difference — it is
supposed to build financial intuition, not just a score. Right now the teaching is
retrospective and device-bound. A pre-run brief is what turns a report into a
lesson, and the Almanac stops being a wiki nobody opens.

**Implementation sketch.**
- Either a `weak_spots` table (`user_id, concept_id, hit, miss`) with the same
  RLS shape as `mastery`, or two extra columns on `mastery` — the second avoids a
  migration of policies but muddies a table whose semantics are "only goes up".
  Recommend the separate table.
- Mirror `lib/cloud/mastery.ts` exactly, including its guest→account merge on
  sign-in, so a guest's record is not lost at the moment they finally sign up.
- Brief UI on `Setup` / `ModeSelect`; `conceptsForText` and `CONCEPTS` already give
  the titles, and `MasteryMap` / `ConceptToast` establish the visual grammar.

**Difficulty: Medium.** One small table, one mirrored module, one new screen block.

---

## 5. The Daily archive, and a streak that means what it says

**What it is.** The Daily Ledger is the habit engine and it is currently thinner
than it should be:

- `lib/dailySave.ts` is local, so the day's run does not follow you across
  devices, and "one attempt" is a courtesy rather than a record.
- There is no way to play a **past** puzzle. `dailyFor(date)` is a pure function of
  the date — every puzzle back to `DAILY_EPOCH` (2026-01-01) already exists and is
  fully reconstructible; nothing surfaces them.
- The streak keys on the **local** calendar date (`lib/cloud/streaks.ts`) while the
  daily keys on **UTC** (`lib/daily.ts`). Both are individually right and the
  modules document the disagreement — but it means the streak counts "played
  something today", not "played today's puzzle", which is not what the chip
  implies.

Ship: a daily archive strip (a month grid — played / missed / today), past puzzles
playable and marked unranked, and a streak read from the daily attempt record.

**Why it adds value.** Streak-and-archive is the single most reliable retention
pattern in this genre, and this codebase is one screen away from it. The archive
also rescues a lapsed player: today, breaking a streak means there is nothing to
come back for; with an archive there are 40 puzzles waiting.

**Implementation sketch.**
- Attempts are already recorded — `metrics.daily` carries the puzzle's date on
  every submitted row. A single `results` query for `user_id` with `metrics->>'daily'`
  present gives the whole calendar (the `results_daily_idx` expression index in
  the README covers the board side; a user-scoped variant covers this).
- `bumpStreak` gains a daily-aware caller that passes the puzzle's UTC date rather
  than `todayStr()`; keep `nextStreak` pure and unchanged.
- Archive grid extends `components/screens/DailyStrip.tsx` (109 lines today) and
  reuses `DailyShare`'s glyph vocabulary so the grid reads consistently.
- Past puzzles must not score on the daily board — filter on the puzzle date
  matching today, which the board's query already does.

**Difficulty: Medium.** No new table. The care is all in the date semantics.

---

## Recommendation for this week

**#2 (friends UI)** first — it is the smallest piece of work on the list and it
un-strands three finished modules and one whole leaderboard scope. **#1 (seed
challenge)** second, as the highest-leverage new surface: it makes every existing
share link do work it currently does not. **#5** is the right follow-on if
retention is the quarter's metric; **#4** if teaching is. **#3** deserves a design
note this week and code next.
