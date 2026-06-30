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
import { alreadySubmitted, markSubmitted, submitResult } from "./results";
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
  return {
    mode: run.mode as GameMode,
    score: nw,
    verdict: verdict.title,
    metrics: {
      netWorth: nw,
      happiness: run.life.happiness,
      age: run.age,
      good: verdict.good ? 1 : 0,
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
 * the single submit path for every mode — no per-mount ref needed. Best-effort:
 * if the player id is unresolved (anon in cloud) nothing posts.
 */
export async function submitRunOnce(
  runKey: string,
  playerId: string | null,
  result: NewResult,
): Promise<void> {
  if (!playerId || alreadySubmitted(runKey)) return;
  markSubmitted(runKey); // optimistic: synchronous, so re-fires within a mount no-op
  try {
    await ensureProfile(playerId);
    await submitResult(playerId, result);
    await bumpStreak(playerId);
  } catch {}
}
