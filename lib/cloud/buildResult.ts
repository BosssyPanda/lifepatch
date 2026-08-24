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
import { alreadySubmitted, markSubmitted, submitResult } from "./results";
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
