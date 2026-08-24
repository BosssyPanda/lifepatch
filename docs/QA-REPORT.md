# LifePatch — QA, rebalance and redesign pass

15 commits · 108 files · +5,774 / −2,871

This documents what was found, what changed, and why. Every number here was
measured — by simulating the compiled engines, by driving the real app in a
browser, or by computing contrast against the actual tokens. Where a claim
could not be verified it says so.

---

## 1. The bugs that were reported

### "I'm $1.2M in debt and the Freedom meter says 20–30%"

Three separate faults stacked into one symptom.

**Net worth subtracted property debt twice.** `realEstateEquity` and
`businessEquity` already returned `price − mortgage`; `totalLiabilities` then
subtracted the same principal again. A $520,000 building with a $450,000
mortgage contributed **−$380,000** instead of **+$70,000**. That alone
manufactured most of the "$1.2M in debt".

The statement now reports gross assets and gross liabilities and derives net
worth as the difference — the correct arithmetic, and the identity the screen
can show its work for. Buying that same building with $70,000 down now moves
net worth by **exactly $0**, because that is what happens when cash becomes
equity.

*Verified:* `assets − liabilities === netWorth` held after every mutation
across 9,600 simulated games (~1.5M state transitions).

**The meter had no solvency term.** A holding's cash flow is already net of its
mortgage, so property debt has no expense line — meaning leverage could only
ever push the meter *up*. Freedom is still passive income ÷ expenses, now
multiplied by a drag measured in **value destroyed since turn zero** rather
than raw net worth. That distinction is load-bearing: every profession starts
underwater by design (School Janitor −$43,350 … Doctor −$512,600), so judging
against zero would peg everyone at 0% forever and make the meter useless.

| Value destroyed | Solvency | Freedom shown |
|---|---|---|
| $0 – $25k | 1.00 | 50% (the true cash-flow ratio) |
| $80k | 0.81 | 41% |
| $160k | 0.32 | 16% |
| $400k | 0.00 | **0%** |

Good leverage moves the drag by nothing. Doodads, bank interest and bad sales
move it by what they cost.

**Nothing could end a run.** Cash shortfalls became bank debt without limit at
10% a month, compounding into a spiral the player could neither repay nor lose
to, while the `"lost"` status sat unassigned in the type. Borrowing now stops
at a ceiling, a shortfall past it ends the run, and the bank panel finally
wires up the borrow/repay functions that had been dead since they were
written. Starting liabilities can be paid off — the other lever that moves the
meter.

*Verified:* freedom never left 0–100 across the full sweep; no profession can
be bankrupted before roughly turn 6 under worst-case play.

### "The allocate slider's sound cuts off when I drag slowly"

Real, and slow dragging was the worst case rather than the mildest. The slider
had 100 detents, so a *slow* drag hit all of them while a fast flick skipped
most — firing up to ~100 trades and ~100 sounds, each allocating four fresh
synth voices. Every burst was cut off by the attack of the next.

Values are now staged locally during the gesture and committed once on
release.

| Gesture | Before | After |
|---|---|---|
| Slow 24-step drag | 24 trades / 24 sounds | **1 / 1** |
| Slow 48-step drag | 47 / 47 | **1 / 1** |
| 5 × ArrowRight | 5 / 5 | **1 / 1** |

The control also lied about what it measured: each slider's 100% meant "this
asset plus every shared dollar", so it moved when you touched a different row,
all rows pinned to 100% once cash hit zero, and one row could read `100%`
beside `40% of port` while its screen-reader label called the same number a
third thing. It is dollar-denominated now, its ceiling frozen for the duration
of the gesture, with one definition of share used in the label and the
announcement alike.

### "Remove the 3D board" and "remove the rotating background board"

Both gone. The landing's "003 — The Arena" keeps its section and now previews
the **real** board — the same component the game renders, so it can never
drift from it. The Rat Race backdrop turned out to be a looping video at 22%
opacity; removing it dropped ~1.5MB of decode. `three.js` stays in the
dependency list because the intro film and the dice physics still use it.

### "The 2D board is too plain"

See §3.

---

## 2. What playing the game found

A scripted playthrough covered every screen at two viewports plus reduced
motion: the landing and every CTA, the intro film, mode select, a full Story
run, 10+ years of Infinite including a crash year and a debt spiral, three
separate Rat Race runs (escape → Fast Track → win, a deliberate bankruptcy,
and a coverage run touching every square type), the Almanac, Money Brain,
leaderboard and share card.

### The two that mattered

**Nothing a player learned was ever recorded.** `useAuth` was a plain hook, so
every caller held its own copy of the signed-in user. The concept recorder
wraps the app shell, so its copy mounted *before* the sign-in gate and stayed
anonymous for the whole session — filing every concept under a device id,
while the report and the mastery map (which mount *after* the gate) resolved
the real id and read a key nobody had written to.

The result: finish a run, be told *"this run sharpened Compounding, Windfalls,
Negotiation"*, open the Money Brain, and see **0%, twenty-three concepts
locked**, forever. The progression system — the thing that makes a learning
game feel like it is going somewhere — never moved.

Auth is one shared context now, mounted above the recorder. Progress earned
before signing in is carried onto the account rather than stranded.
*Verified by playing:* mastery now writes to the signed-in key and the meter
reads 6% where it read 0%.

**Buying lottery tickets was the correct play.** One in a hundred paid
$250,000 against a $200 ticket — **expected value +$2,302 per play** — with no
once-per-run limit, so it redrew every year. Directly beneath it, its own
losing outcome read *"Expected value of the lottery is deeply negative."*

| | Before | After |
|---|---|---|
| Jackpot odds | 1 in 100 | 1 in 2,000 |
| EV per play | **+$2,302** | **−$74.90** |
| 20 years of buying | strongly positive | ≈ **−$1,498** |
| Chance of ever hitting | 18% | 1% |

It stays repeatable deliberately. Playing every year and watching it bleed you
*is* the lesson, delivered by the mechanic instead of contradicted by it.

### Screens that contradicted themselves when a run went badly

Each of these only appeared once a player was losing — exactly when a screen
needs to be trustworthy.

- The portfolio meter printed **"0% OF TOTAL — 100% INVESTED"** whenever cash
  was zero and nothing was held, which is the most common state of a
  struggling run.
- The final report told a player who never bought an asset that their best
  year *lost* money — **"BEST YEAR −$0"** in loss red, beside **"WORST YEAR
  +$0 — You never had a down year"**.
- The statement printed liabilities as bare positives in the same ink as
  assets, so a mortgage read as something you owned and the column didn't add
  up to the net worth beneath it.
- A preset hint told players to *"sell something below to free up cash"* on a
  grid where every row read `MAX $0`.
- The landing's stat band rendered a solid grey rectangle at every width below
  the large breakpoint (seven figures in a four-column grid whose gap is the
  background showing through).

### Everything else that was fixed

| Finding | Fix |
|---|---|
| Two of three modes locked behind an email | Guest play on the device id the Rat Race already used; adding an email later carries the run across |
| Fast Track was a formality — median **6 turns**, 10th percentile **1** | Rebalanced; median **16**, and runs that reached it and never won went **17 → 0** |
| Story/Infinite had no insolvency end — ~25 dead years with the verdict fixed | Ends after 7 consecutive unrecoverable years, with 3 years of warning |
| Music with no control on 6 screens | One sound cell, reading the existing mute/volume |
| Concept toast covered up to **68%** of the primary button on mobile | Re-anchored; measured **zero** overlap on controls |
| "▶ INTRO" chip overlapped content at **every** scroll offset probed | Moved into the hero rail where it cannot |
| Almanac badge said "CALLED 3/8" meaning 3 *correct*, not 3 answered | Counts answered; score shown separately |
| "Invest it" promised *"straight to the portfolio, the compounding starts tonight"* then parked the money in cash, which earns nothing | Copy matches the mechanic and names the step the player still has to take |
| Report chart: labels drawn over the plotted line, colliding macro labels, and two different "best year" figures 200px apart measuring different things | Annotations placed by a solver; the two figures relabelled so they can't read as contradicting |

---

## 3. The redesign

### Palette — Risograph Print

The old palette was 13 near-monochrome tokens. The new one keeps the printed
-document identity and gives it a press: warm near-black paper, safety orange
as the signature, acid chartreuse as a rare reward, print red and green for
money.

| Token | Value | On paper |
|---|---|---|
| `bg` / `bg2` / `bg3` | `#131110` / `#1A1714` / `#211D19` | — |
| `ink` | `#F4F0E6` | 16.54:1 |
| `accent` | `#FF5A1F` | 6.04:1 |
| `highlight` | `#D8E04B` | 13.17:1 |
| `gain` | `#2FCC71` | 8.96:1 |
| `loss` | `#FE4030` | 5.37:1 |

Every pairing was solved for rather than picked, and the audit script
(`scripts/qa/palette-audit.mjs`) re-runs it: **57 of 57 pass**.

That script is new. This report and `DESIGN.md` both cited `scratchpad/palette-audit.js`,
which was never committed and is not in the tree — so the gate behind "a pairing that has
not been measured does not ship" could not be run. Every figure below was re-derived from
`app/globals.css` and `lib/palette.ts` and reproduces exactly, so the original audit was
real; what was missing was any way to repeat it. The rebuilt gate also checks the two files
against each other, which nothing ever had.

Two results worth recording. The red originally proposed, `#E23B2E`, measured
**4.39:1** — just under the 4.5 minimum — so it was replaced with the most
saturated print red that clears every surface *and* works as a knockout fill.
And ink on orange measures **2.74:1**, so anything knocked out of an accent
fill is painted in paper, never ink.

**Where the accent is spent:** the primary path and what is live — the primary
CTA, section numerals, the focus ring, the selected card, the live turn, the
roll. Nothing else. Measured in painted pixels it lands *under* the intended
10–15% band, which is the correct side to miss on: an accent that marks
everything marks nothing. Orange never grades an outcome — one card was
styling a *profitable* sale in orange, which is the judgement red and green
already carry.

### The board

Flat grey squares reading `DEAL / PAY / $$$ / MKT / GIVE / FIRED` became a
printed board: a 2px keyline, a halftone screen over the fill, and the
category plate offset 1.5px off-register the way a second colour pass lands on
a real riso print. Squares carry a plate number, the token springs one hop per
square, the square it lands on throws a pulse, and money events stamp a delta
sized by how much moved.

**Labels became plain words** — `EXPENSE`, `PAYDAY`, `MARKET`, `CHARITY`,
`LAID OFF` — with the full name on hover. Unexplained jargon is where
educational games lose first-timers, and those codes were the first thing a
new player read. The coach cards follow the same vocabulary; "Doodad" survives
in the glossary, where the board-game original belongs.

### The year screen

The run screen got the same design language at a calmer dial: numbered plates
and category rules, but **no halftone**. The board is an object you look at;
the life-event card carries prose you must read to decide, and decoration
behind body text costs comprehension. Orange marks the *selected* choice — the
live decision — and the outcome rail below stays the only thing that reads
gain or loss.

---

## 4. The economy

The market model had two exploits and no downside.

- **Post-2025 crypto returned +10% to +70% every year, forever.** $10,000
  compounded to **$3.4 billion** over 40 years without a single losing year.
- **Index funds returned exactly +8.0% every year** — worst year identical to
  best.
- Every player got **byte-identical market history**; only life events used
  the run seed.

Rewritten as seeded regimes with real downside. Measured over 40 years ×
3,000 seeds:

| Asset | Compounded | σ | Worst year | Losing years |
|---|---|---|---|---|
| savings | 3.6% | 1.9 | +0.3% | 0% |
| bonds | 3.7% | 3.3 | −8.0% | 12.8% |
| index | 6.9% | 18.5 | −39.9% | 27.3% |
| real estate | 6.1% | 8.9 | −24.9% | 22.6% |
| gold | 1.7% | 16.1 | −49.2% | 43.0% |
| **crypto** | **3.9%** | 80.4 | **−80.0%** | 45.9% |

Crypto's +26% arithmetic mean against a 3.9% compounded return *is* the
volatility-drag lesson, priced in. Real history stays truthful across every
seed (2008 = −37%, 2022 crypto = −64%); only the synthetic jitter varies.

Also corrected: expenses never inflated while salary compounded; owning a home
was $1,000/yr *cheaper* than renting with no mortgage modelled; debt compounded
at 7% with no minimum payment (median ending debt for a player who ignored it:
**$156,043 → $26,999**); **Story-mode retirement was mathematically
unreachable** — 0.0% of runs, every strategy, now 0.8–14.3%. A laid-off player
had a 17.5% chance of never working again because the "new job" event was
weighted too low; now 5.2%.

The net effect is an economy that is *kinder at both tails* than before while
being honest about inflation and debt, with no single asset dominating a
diversified mix.

---

## 5. What the adversarial review found

A final independent pass compiled the engines and drove them over **9,600 Rat
Race runs and 9,000 life-sim runs** with per-mutation assertions. It confirmed
the balance sheet, the solvency drag, both save migrations and the run-engine
invariants are sound — and found three real bugs at boundaries the rewrite
itself introduced.

1. **Entering the Fast Track paid out per click.** It was the only resolution
   handler committed with a functional updater, and the escape ceremony stays
   clickable through its exit animation. Four clicks turned a $150,000 stake
   into **$600,000** and cleared every dream the rebalance had just put out of
   reach. Now idempotent.
2. **26.6% of bankruptcies fired while the bank still advertised credit.** The
   bank lends in whole thousands against an arbitrary ceiling, so the loan
   parked at the largest multiple below it and the last $1–$999 could never be
   drawn — the panel read *"$320 left to borrow"* and the next $50 bill ended
   the run. The ceiling is quantised to the unit the bank actually lends in.
3. **An all-in stock buy could mint a $1,000 loan from nothing.** Share count
   came from a float division and the debit from a float multiplication, so
   the cost could exceed cash by ~1e-13 — and any negative cash reads as a
   shortfall. Both sides settle in whole cents now.

Three more, each a case of the game punishing the move it recommends:

- Paying off a liability removed its expense line, which **shrank the credit
  ceiling below the drawn balance** — the game's own advice left a player
  retroactively over their limit.
- A guest in a cloud deployment recorded **zero** mastery: progress was routed
  through an id resolver that correctly withholds guest ids from cloud writes,
  which would have reproduced the exact bug the auth refactor was written to
  kill. Progress now resolves its own id and stays on-device for guests.
- The guest-save adoption latch was written even when every adoption threw, so
  one transient failure would permanently strand the run on the device.

Two comments were corrected rather than left flattering: the insolvency
threshold note claimed no ejected run ever recovered (a wider replay puts it
at ~1.7%), and a migration comment claimed a book is never revalued, which is
true only until someone edits a deck price.

---

## 6. Save compatibility

- **Story / Infinite** — `RUN_VERSION` is now 6. Saves from the previously
  deployed build are intentionally invalidated; players get a plain notice
  explaining the game changed under them, not a silent reset or a corrupt
  load.
- **Rat Race** — `STATE_VERSION` 1 → 2 **migrates** rather than resets. A v1
  save was built with the old engine and loaded through the migration: no
  missing keys, no stale keys, identity reconciles, and it played 40 more
  moves without incident.
- The Fast Track economy changed *without* a version bump, deliberately — the
  state shape did not change, so in-flight board saves stay valid. Bumping
  would have discarded every mid-run game to close one generous edge.
- Leaderboard scores carry a version tag; the Rat Race score changed from raw
  passive income (which made maximum leverage optimal — the opposite of the
  lesson) to a balance-sheet measure, so old rows are not comparable.

---

## 7. Known and not fixed

- **Mobile Rat Race board**: ~268px² of toast overlap remains on a read-only
  figure. Every alternative anchor tested was worse; a floating toast cannot be
  zero-overlap against arbitrary scrolled content in a 390px column.
- **Fast Track tail**: a player who chases the dream and refuses to buy any
  investment takes a median 45 turns. The panel now says so explicitly, but it
  is a real tail worth revisiting after playtesting.
- **`/r/[id]` share links** resolve to "statement not on file" in a
  deployment without Supabase configured.
- **`[ SHARE ]`** falls back to a file download where the Web Share API is
  absent, so the label is optimistic on desktop.
- **Arena preview** instructs "hover a square to read it" on touch devices,
  where hover does not exist.
- Minor: `portfolioDelta` excludes home appreciation; `listSaves` is not
  version-filtered (no call sites).

---

## 8. Verification

Every gate in this pass required: `npm run typecheck`, `npm run lint`,
`npx next build` in an isolated copy, `node scripts/qa/palette-audit.mjs`,
`node scripts/qa/engine-props.mjs`, and a scripted smoke pass at 1440×900,
390×844 and reduced motion.

Final state: typecheck clean · lint clean but for one pre-existing
`<img>` warning · production build succeeds · palette **57/57** ·
engine properties **23/23** · all five browser journeys **0 high, 0 console
errors** at both viewports.

Two gates in that list are new, and both existed only on paper before:

- **The palette audit** was cited by `DESIGN.md` and by this report as
  `scratchpad/palette-audit.js`, a file that was never committed. It is now
  `scripts/qa/palette-audit.mjs`, it checks `app/globals.css` and `lib/palette.ts`
  against each other as well as measuring every pairing, and it fails on a single
  drifted hex digit — verified by drifting one.
- **The engine property suite** had two ways of passing without meaning it, both
  found by deliberately breaking the code under test and watching it pass anyway.
  It reported after its first section rather than its last, so eighteen of its
  checks could print `FAIL` and still exit 0. And it — along with all four browser
  journeys — imported the compiled engine's output directory without building it,
  so a script run on its own drove whatever tsc had last left in `/tmp`; the engine
  under test was three hours older than the tree. Both fixed, both re-verified by
  repeating the sabotage. A gate that cannot fail, or that tests a stale copy, is
  worse than no gate — because it is trusted.

Beyond that: ~1.5M engine state transitions asserted, 3,000-seed market
distributions, a 58,388-run-year replay behind the insolvency threshold, and a
360-run-per-strategy Fast Track simulation.

One process note worth keeping: a production build break reached a commit
because the isolated build was skipped on that gate — a hook that throws
outside its provider broke a route that the dev server never renders. The
adversarial pass caught it. Run the isolated build every time.

---

## 9. Design research applied

The gameplay changes follow a literature pass on educational game design.
Concepts arrive at the decision that needs them rather than in a tutorial
(upfront financial education decays to near-zero effect — Fernandes, Lynch &
Netemeyer 2014); the live financial statement *is* the board; consequences
bite mid-run rather than on the end screen; the end-of-run recap names the
concepts used, because the learning consolidates in the debrief (Crookall
2010); money events carry feedback scaled to their magnitude; and readability
is preferred over decoration on any surface carrying prose.

The two headline fixes are the clearest cases: a progression system that never
moved, and a gambling mechanic that paid. Both taught the opposite of what
they claimed.
