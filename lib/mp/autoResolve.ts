import { getEvent, type LifeChoice } from "@/lib/lifeEvents";
import { advanceYear, allEventsResolved, applyLifeChoice, yearIndex, type RunState } from "@/lib/runEngine";

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
 * order-independent), no trades, no debt payments.
 */

/**
 * The safest choice on the table, measured as worst-case immediate damage:
 * for each choice take the WORST outcome by `cash − debt`, then take the choice
 * whose worst is least bad. Ties go to the first-listed choice, which is stable
 * because `LIFE_EVENTS` is a literal.
 *
 * Deliberately myopic — it does not weigh salary, health or happiness. An
 * auto-decision is not meant to play well, only to play the same way everywhere
 * and never to hand an absent player a ruinous year.
 */
export function autoChoiceFor(s: RunState, eventId: string): LifeChoice | null {
  const ev = getEvent(eventId);
  if (!ev || ev.choices.length === 0) return null;
  let best: LifeChoice | null = null;
  let bestWorst = -Infinity;
  for (const choice of ev.choices) {
    let worst = Infinity;
    for (const o of choice.outcomes) {
      const swing = (o.effect.cash ?? 0) - (o.effect.debt ?? 0);
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
    cur = advanceYear(resolveAllPending(cur));
  }
  return cur;
}

/** True when the year can be locked in — the "Lock in the year" button's gate. */
export function canLockIn(s: RunState): boolean {
  return s.status === "playing" && allEventsResolved(s);
}
