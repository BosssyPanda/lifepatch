import { ticketFor, verifyResult } from "../replay";
import { netWorth, RUN_VERSION, type RunState } from "../runEngine";
import { deriveVerdict } from "../verdict";
import {
  hasEscaped,
  netWorth as cashflowNetWorth,
  passiveIncome,
  payday as cashflowPayday,
  totalExpenses,
} from "../cashflow/selectors";
import type { CashflowState } from "../cashflow/types";
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
import type { GameMode, NewResult } from "./types";

/**
 * Build a leaderboard result row from a finished run. One score per mode so the
 * boards are comparable: net worth for the life sim, net worth plus a year of cash
 * flow for the Rat Race (see `cashflowScore`, and `lib/scoreLabel.ts` for the words
 * every surface says about it). Extra context rides in `metrics` for the result
 * card + row subtitle.
 */

/** Story/Infinite: ranked by final net worth. */
export function resultFromRun(run: RunState): NewResult {
  const nw = netWorth(run);
  const verdict = deriveVerdict(run);
  const hist = run.history.slice(-100); // cap the stored series for very long infinite runs
  const ticket = ticketFor(run);
  return {
    mode: run.mode as GameMode,
    score: nw,
    verdict: verdict.title,
    metrics: {
      netWorth: nw,
      happiness: run.life.happiness,
      age: run.age,
      good: verdict.good ? 1 : 0,
      // Phase M3: per-year net-worth series + its first calendar year, so the
      // /r/[id] share page can draw the annotated life chart.
      history: hist.map((h) => Math.round(h.netWorth)),
      startYear: hist[0]?.year ?? run.startYear,
      // What this run was, so two rows can be told apart and compared honestly.
      // `seed` also gives the share lookup a key that cannot collide (two runs of
      // one mode landing on the same net worth used to fight over one URL).
      seed: run.seed,
      backgroundId: run.backgroundId,
      engine: RUN_VERSION,
      // The Daily Ledger stays `mode: "story"` — its board is a filter on this
      // field, not a fourth mode, so the table's own check constraint, its policies
      // and its index are all untouched.
      ...(run.daily ? { daily: run.daily } : {}),
      // Replayed: the run re-simulated, on this device, from its own action log,
      // and landed on the score it is claiming. Written only when that succeeded —
      // an absent flag makes no claim either way, which is the honest reading for
      // a run resumed from a save that predates the log.
      ...(ticket && verifyResult(ticket, nw) ? { verified: 1 } : {}),
    },
  };
}

/**
 * Rat Race scoring, v2. Ranking by passive income alone was blind to debt and
 * expenses, so maximum leverage was the optimal ranked strategy — the exact
 * opposite of what the mode teaches. The score is now a balance-sheet measure
 * plus a year of realized cash flow:
 *
 *     score = netWorth + 12 × payday
 *
 * Net worth counts every dollar borrowed against you; `payday` (income − ALL
 * expenses, bank interest included) counts the cost of carrying that debt. You
 * still climb by buying cash-flowing assets — you just can't climb by drowning.
 *
 * v1 rows are not comparable to v2 rows, so the version rides in `metrics`.
 */
export const CASHFLOW_SCORE_VERSION = 2;

export function cashflowScore(s: CashflowState): number {
  return Math.round(cashflowNetWorth(s) + 12 * cashflowPayday(s));
}

export function resultFromCashflow(s: CashflowState): NewResult {
  const passive = passiveIncome(s);
  const escaped = hasEscaped(s);
  return {
    mode: "cashflow",
    score: cashflowScore(s),
    verdict: s.status === "lost" ? "Buried in Debt" : escaped ? "Escaped the Rat Race" : "Still Racing",
    metrics: {
      scoreVersion: CASHFLOW_SCORE_VERSION,
      // The run's seed, for the same reason the life sim records one: it is the only
      // field unique to a run, and `resultAlreadyPosted` keys the retry dedupe on it.
      // Without it every Rat Race retry was a blind re-insert.
      seed: s.seed,
      passiveIncome: passive,
      netWorth: cashflowNetWorth(s),
      payday: cashflowPayday(s),
      expenses: totalExpenses(s),
      bankLoan: s.liabilities.bankLoan,
      interestPaid: Math.round(s.interestPaid),
      turns: s.turn,
      escaped: escaped ? 1 : 0,
      lost: s.status === "lost" ? 1 : 0,
    },
  };
}

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
    await submitResult(playerId, result);
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
    queuePending(runKey, playerId, result);
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
    const outcome = await submitRunOnce(p.runKey, playerId, p.result);
    if (outcome === "posted") posted++;
    else if (outcome === "failed") break; // still down — stop, keep the rest queued
  }
  return posted;
}
