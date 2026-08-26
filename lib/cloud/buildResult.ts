import type { ReplayTicket } from "../replay";
import { ensureProfile } from "./profiles";
import {
  alreadySubmitted,
  clearSubmitting,
  countPendingAttempt,
  dropPending,
  markSubmitted,
  markSubmitting,
  queuePending,
  readPending,
  resultAlreadyPosted,
  submitResult,
  wasInterrupted,
} from "./results";
import { bumpStreak } from "./streaks";
import type { NewResult } from "./types";

/**
 * Posting a finished run: exactly once, durably, and — for the life sim — through
 * the server, which derives the score by replaying the run rather than believing it.
 *
 * The row-BUILDING half of this module moved to `./resultRow`, which is pure and
 * therefore importable from `app/api/submit-result`. It is re-exported here so no
 * call site had to move with it.
 */
export { cashflowScore, resultFromCashflow, resultFromRun } from "./resultRow";

/** What became of a submit. `"failed"` is the only one that leaves work to do,
 *  and `flushPendingResults` is what does it. */
export type SubmitOutcome = "posted" | "skipped" | "failed";

/**
 * Runs currently being posted, in THIS tab.
 *
 * The durable key used to be written before the insert was awaited, and the note
 * called that "optimistic" — but it was doing two jobs. One was legitimate: it is
 * synchronous, so a second call in the same mount (a re-render, the report and the
 * podium both firing) short-circuits before it can duplicate the row. The other
 * was not: it also declared the run posted before anyone knew whether it had been.
 *
 * The two jobs are now separate. This set covers the same-tick race; the durable
 * key covers reloads and is written only once the insert has actually landed.
 */
const inFlight = new Set<string>();

/**
 * Post a finished run exactly once and bump the daily streak. `runKey` must be
 * stable+unique per run (e.g. the run seed). Durable across reloads, so this is
 * the single submit path for every mode. If the player id is unresolved (anon in
 * cloud) nothing posts.
 *
 * A failure is no longer silent OR permanent: the row is parked in the retry queue
 * and `flushPendingResults` picks it up on the next load.
 */
export async function submitRunOnce(
  runKey: string,
  playerId: string | null,
  result: NewResult,
  ticket?: ReplayTicket | null,
): Promise<SubmitOutcome> {
  if (!playerId || alreadySubmitted(runKey) || inFlight.has(runKey)) return "skipped";
  inFlight.add(runKey);
  // Did a previous attempt begin and never report back? Then the row may already
  // be on the board and this call would duplicate it. Only that case pays for the
  // extra lookup; a first attempt stays one round-trip.
  const interrupted = wasInterrupted(runKey);
  markSubmitting(runKey);
  try {
    await ensureProfile(playerId);
    if (interrupted && (await resultAlreadyPosted(playerId, result))) {
      markSubmitted(runKey);
      dropPending(runKey);
      return "posted";
    }
    await submitResult(playerId, result, ticket);
    markSubmitted(runKey);
    dropPending(runKey);
    // The score is on the board. A streak that fails to bump is a smaller loss
    // than a run that fails to post, and must not roll the whole submit back into
    // the retry queue — that would re-insert the row on the next load.
    try {
      await bumpStreak(playerId);
    } catch (err) {
      console.error("submitRunOnce: the result posted but the streak did not", err);
    }
    return "posted";
  } catch (err) {
    console.error("submitRunOnce: could not post the finished run — queued for retry", err);
    queuePending(runKey, playerId, result, ticket);
    return "failed";
  } finally {
    clearSubmitting(runKey);
    inFlight.delete(runKey);
  }
}

/**
 * Re-try every run that finished while the network was not listening.
 *
 * Called once per app load. Sequential rather than parallel on purpose: if the
 * cloud is still down, this should cost one failed request and stop, not one per
 * queued run. Returns how many rows made it onto the board.
 */
export async function flushPendingResults(playerId: string | null): Promise<number> {
  if (!playerId) return 0;
  const queued = readPending();
  if (queued.length === 0) return 0;
  let posted = 0;
  for (const p of queued) {
    // Ownership can change between sessions, and two accounts can share a device.
    // A row queued by someone else is not this player's to post — but it is also
    // not this player's to DESTROY, which is what dropping it would do to the other
    // player's unposted run. Leave it; the queue is bounded either way.
    if (p.playerId !== playerId) continue;
    if (alreadySubmitted(p.runKey)) {
      dropPending(p.runKey);
      continue;
    }
    // Spend a retry before making the request, so a run that fails on six separate
    // loads is eventually let go instead of being retried forever.
    if (!countPendingAttempt(p.runKey)) continue;
    try {
      // The response to the original insert may have been lost AFTER the server
      // committed it. Re-posting blind would duplicate the row.
      if (await resultAlreadyPosted(playerId, p.result)) {
        markSubmitted(p.runKey);
        dropPending(p.runKey);
        continue;
      }
    } catch (err) {
      // The check itself failed, so the cloud is still unreachable. Stop.
      console.error("flushPendingResults: could not check for an existing row", err);
      break;
    }
    const outcome = await submitRunOnce(p.runKey, playerId, p.result, p.ticket);
    if (outcome === "posted") posted++;
    else if (outcome === "failed") break; // still down — stop, keep the rest queued
  }
  return posted;
}
