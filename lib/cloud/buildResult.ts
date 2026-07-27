import { netWorth, type RunState } from "../runEngine";
import { deriveVerdict } from "../verdict";
import {
  hasEscaped,
  netWorth as cashflowNetWorth,
  passiveIncome,
  totalExpenses,
} from "../cashflow/selectors";
import type { CashflowState } from "../cashflow/types";
import { ensureProfile } from "./profiles";
import {
  alreadySubmitted,
  markSubmitted,
  pendingResults,
  queuePendingResult,
  removePendingResult,
  submitResult,
} from "./results";
import { bumpStreak } from "./streaks";
import type { GameMode, NewResult } from "./types";

/**
 * Build a leaderboard result row from a finished run. One score per mode so the
 * boards are comparable: net worth for the life sim, passive income for the Rat
 * Race. Extra context rides in `metrics` for the result card + row subtitle.
 */

/** Story/Infinite: ranked by final net worth. */
export function resultFromRun(run: RunState): NewResult {
  const nw = netWorth(run);
  const verdict = deriveVerdict(run);
  const hist = run.history.slice(-100); // cap the stored series for very long infinite runs
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
    },
  };
}

/** Rat Race: ranked by passive income; tracks escape speed (turns). */
export function resultFromCashflow(s: CashflowState): NewResult {
  const passive = passiveIncome(s);
  return {
    mode: "cashflow",
    score: passive,
    verdict: hasEscaped(s) ? "Escaped the Rat Race" : "Still Racing",
    metrics: {
      passiveIncome: passive,
      netWorth: cashflowNetWorth(s),
      expenses: totalExpenses(s),
      turns: s.turn,
      escaped: hasEscaped(s) ? 1 : 0,
    },
  };
}

/**
 * Post a finished run exactly once and bump the daily streak. `runKey` must be
 * stable+unique per run (e.g. the run seed). Durable across reloads, so this is
 * the single submit path for every mode — no per-mount ref needed.
 *
 * A run is only marked submitted AFTER the post lands (the old optimistic mark
 * permanently swallowed any run whose first post failed — the board then looked
 * "local only"). Runs that can't post yet — anonymous player in a cloud build,
 * or a network failure — are parked in a durable outbox and re-posted by
 * flushPendingResults() once a player id / connectivity exists.
 */
const inFlight = new Set<string>(); // re-fires within a mount no-op synchronously

export async function submitRunOnce(
  runKey: string,
  playerId: string | null,
  result: NewResult,
): Promise<void> {
  if (alreadySubmitted(runKey) || inFlight.has(runKey)) return;
  if (!playerId) {
    // anon in cloud: park it — it posts (to the account they sign in with) later
    queuePendingResult(runKey, result);
    return;
  }
  inFlight.add(runKey);
  try {
    await ensureProfile(playerId);
    await submitResult(playerId, result);
    markSubmitted(runKey);
    removePendingResult(runKey);
    await bumpStreak(playerId).catch(() => {}); // streak is best-effort, never re-posts the run
  } catch {
    queuePendingResult(runKey, result); // net blip / RLS refusal — retried on next flush
  } finally {
    inFlight.delete(runKey);
  }
}

/** Re-post every parked run. Call on load, sign-in, and reconnect. */
export async function flushPendingResults(playerId: string | null): Promise<void> {
  if (!playerId) return;
  for (const row of pendingResults()) {
    if (alreadySubmitted(row.runKey)) {
      removePendingResult(row.runKey);
      continue;
    }
    await submitRunOnce(row.runKey, playerId, row.result);
  }
}
