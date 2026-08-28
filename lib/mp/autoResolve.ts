import { DEBT_RATE } from "@/lib/economy";
import { availableChoices, getEvent, type LifeChoice } from "@/lib/lifeEvents";
import {
  advanceYear,
  allEventsResolved,
  annualExpenses,
  applyLifeChoice,
  debtMinimum,
  eventContext,
  mortgageService,
  trade,
  yearIndex,
  type RunState,
} from "@/lib/runEngine";

/**
 * Deterministic auto-play: what a life does when nobody is at the wheel.
 *
 * Three callers depend on this and they must all agree to the dollar:
 *   1. the timer expiring on a player who didn't choose in time,
 *   2. the acting host ghost-playing a DISCONNECTED player's run forward,
 *   3. that same player's own client, catching up after a rejoin.
 *
 * (2) and (3) run on different machines from the same starting snapshot and must
 * land on byte-identical state — otherwise the leaderboard row the room watched
 * belongs to a different life than the one the player comes back to. So every
 * function here is PURE and reads only (state, event definition): no clocks, no
 * randomness of its own (the engine's rolls are already seeded and
 * order-independent), no clock-dependent state.
 *
 * One thing here DOES move money — `autoAllocate` — and it is deliberately fenced
 * into `fastForward`, i.e. into (2) and (3) only. See its own note.
 */

/**
 * How many years of a salary change an auto-decision weighs against the cash it
 * costs. A fixed constant, never a clock or a roll, so the score stays pure and
 * identical on every machine. Six is well short of the ~21 years a story run has:
 * enough that a permanent raise outranks a one-off fee, not so much that the
 * scorer starts gambling for one.
 */
const SALARY_WEIGHT = 6;

/**
 * The safest choice on the table, measured as worst-case immediate damage:
 * for each choice take the WORST outcome by `cash − debt` plus what that outcome
 * does to the salary, then take the choice whose worst is least bad. Ties go to
 * the first-listed choice, which is stable because `LIFE_EVENTS` is a literal.
 *
 * Still myopic — it does not weigh health or happiness, and it never trades. But
 * salary is not a nicety: it is the only permanent number on the sheet, and
 * ignoring it made the auto-decision actively wrong rather than merely cautious.
 * It refused to move for a job paying 28% more to dodge a one-off $6,000, and
 * skipped a course that raises pay 70% of the time, every year, for the rest of a
 * 21-year life. Folded into the WORST case per outcome, so the guarantee that
 * matters is untouched: a gamble whose bad branch zeroes the salary still scores
 * as the ruin it is, and is still refused.
 *
 * This is not only the absent player's policy — it is also what answers for a
 * player who is still here when the year's clock runs out.
 */
export function autoChoiceFor(s: RunState, eventId: string): LifeChoice | null {
  const ev = getEvent(eventId);
  if (!ev || ev.choices.length === 0) return null;
  // Only what is actually on the table — the engine refuses a closed choice, so
  // picking one would leave the card unanswered and hold the room's year open.
  const choices = availableChoices(ev, eventContext(s));
  let best: LifeChoice | null = null;
  let bestWorst = -Infinity;
  for (const choice of choices) {
    let worst = Infinity;
    for (const o of choice.outcomes) {
      // `salaryTo` is an absolute figure and `salaryPct` a multiplier (lib/lifeEvents).
      // Only the ORDER of the scores matters here, so the engine's inflator — a
      // common positive factor — is deliberately not reproduced.
      const salaryDelta =
        o.effect.salaryTo !== undefined
          ? o.effect.salaryTo - s.salary
          : (s.salary * (o.effect.salaryPct ?? 0)) / 100;
      const swing = (o.effect.cash ?? 0) - (o.effect.debt ?? 0) + salaryDelta * SALARY_WEIGHT;
      if (swing < worst) worst = swing;
    }
    if (worst === Infinity) worst = 0; // a choice with no outcomes costs nothing
    if (worst > bestWorst) {
      bestWorst = worst;
      best = choice;
    }
  }
  return best;
}

/** Answer every still-unanswered pending event with `autoChoiceFor`. */
export function resolveAllPending(s: RunState): RunState {
  let cur = s;
  for (const id of s.pendingEvents) {
    if (cur.yearChoices[id]) continue;
    const choice = autoChoiceFor(cur, id);
    // An event this build no longer knows would block the year forever, so it is
    // skipped rather than retried — `advanceYear` clears the pending list anyway.
    if (!choice) continue;
    cur = applyLifeChoice(cur, id, choice);
  }
  return cur;
}

/**
 * Where an absent player's spare cash goes while they are away.
 *
 * WHY THIS EXISTS. Left in cash, an auto-played life doesn't merely play safe —
 * it loses. Measured over 800 seeds against a table of five plausible human
 * policies (a cautious saver, a balanced investor, a sharp one, a crypto punt and
 * a hoarder), a ghost that never invests finished LAST 74% of the time, mean
 * placing 5.3 of 6. It was last by construction, and the podium ranked it against
 * people who were present. Keeping one year of expenses back and putting the rest
 * to work moves that to 6% and 4.0 of 6 — a little below the middle of the table,
 * which is what being away should cost: something, but not the game.
 *
 * WHAT THAT DOES NOT CLAIM. "Below the middle" is measured against a table of
 * STRANGERS. The other question — is a given player richer for having walked away? —
 * is separate, and was measured separately: same seed, same player, same policy up
 * to the year they left, then auto-played to the end. For six of seven plausible
 * policies, leaving beat staying on 27-52% of seeds: neutral, or mildly costly. For
 * one it was 93% — a player who BOTH hoards a large cash buffer AND commits only a
 * third of what is left is playing worse than this default, and any default that is
 * not itself last-by-construction will beat them. Split those two traits apart and
 * it falls to 36% and 41%, so it takes both together.
 *
 * That is not tunable away. The only rule neutral for every player is one that plays
 * worse than the worst of them, which is the bug this replaced. Continuing the
 * player's OWN revealed allocation was tried and is worse than it sounds: a fresh run
 * holds nothing, so the ghost never starts, and placing collapses back to 5.1 of 6
 * with 72% last places.
 *
 * WHY IT IS NOT IN `resolveAllPending`. That is also the path for a player who is
 * RIGHT HERE and simply let the year's clock run out (`components/run/YearLoop`).
 * Answering an event for them is the timer's job; buying them an index position is
 * not. Nobody's money moves without them unless they are genuinely gone.
 *
 * WHY IT IS SAFE. Pure: the buffer is built from the same pure functions the
 * engine charges the year with, the rest is
 * arithmetic, and `trade` is a transfer that already floors both sides at zero. So
 * the acting host and the returning player still land on byte-identical state.
 * It only ever BUYS — a ghost never sells, so it can't crystallise a loss for
 * someone who isn't there to want that.
 */
export function autoAllocate(s: RunState): RunState {
  if (s.status !== "playing") return s;
  /**
   * Every outflow the coming year makes, kept liquid — because an auto-player
   * that invests into an overdraft hands an absent person a debt to come back to,
   * which is the one thing this is not allowed to do.
   *
   * It used to hold back `annualExpenses` alone, and that is only part of the
   * bill: `advanceYear` also takes the mortgage payment out of cash, and then the
   * debt minimum on top, neither of which `annualExpenses` counts. The gap only
   * closes for a renter with no debt. Elsewhere the ghost could invest cash the
   * year was about to need, the shortfall rolled into unsecured debt at 7%, and
   * the minimum then forced a pro-rata sale of the position it had just bought —
   * a debt and a liquidation conjured out of a solvent year, with `interestPaid`
   * and `insolventStreak` carrying it for the rest of the run.
   *
   * Measured over 800 seeds it fired on 0.3% of runs: rare, but it is the exact
   * failure the paragraph above promises cannot happen, and closing it is free.
   * The take-home pay that funds most of this bill is deliberately NOT counted.
   * Counting it is defensible on solvency grounds — the salary lands in the same
   * `advanceYear`, before the minimum is taken — but it enlarges the surplus, and
   * over the same 800 seeds it moved the ghost from 2.60 to 2.39 of 6 and cut its
   * last places from 27.8% to 24.1%. That is a better deal for being absent, and
   * this default is tuned the other way (see the placing note above). Holding back
   * outflows only is strictly more cautious than what shipped, so it can invest
   * less but never more: the same 800 seeds place it at 2.60 and 27.8%, unmoved,
   * with the debt-creating years gone.
   *
   * `annualExpenses`, `mortgageService` and `debtMinimum` are the same pure
   * functions `advanceYear` charges a moment later, so the acting host and the
   * returning player still land on byte-identical state.
   */
  const spare =
    s.cash - annualExpenses(s) - mortgageService(s).payment - debtMinimum(s.debt + s.debt * DEBT_RATE);
  if (spare <= 0) return s;
  // Four fifths of the surplus, in the plainest asset on the board. Not a strategy
  // — a default, chosen to be unremarkable rather than clever.
  const amount = Math.floor(spare * 0.8);
  return amount > 0 ? trade(s, "index", amount) : s;
}

/**
 * Play a run forward to `toYearIndex` with auto-decisions only.
 *
 * The load-bearing guarantee of the whole multiplayer layer: same input, same
 * output, on any machine, any number of times. Stops early the moment the run
 * ends (story-complete, insolvent, died) — a finished life is never advanced past
 * its ending.
 */
export function fastForward(s: RunState, toYearIndex: number): RunState {
  let cur = s;
  // The engine always advances the year, so the loop cannot stall; the guard is
  // there only so a corrupt `toYearIndex` can never spin a browser tab.
  let guard = 0;
  while (cur.status === "playing" && yearIndex(cur) < toYearIndex && guard < 500) {
    guard++;
    cur = advanceYear(autoAllocate(resolveAllPending(cur)));
  }
  return cur;
}

/** True when the year can be locked in — the "Lock in the year" button's gate. */
export function canLockIn(s: RunState): boolean {
  return s.status === "playing" && allEventsResolved(s);
}
