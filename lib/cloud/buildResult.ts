import { ticketFor, verifyResult } from "../replay";
import { netWorth, RUN_VERSION, type RunState } from "../runEngine";
import { CASHFLOW_VERDICTS, deriveVerdict } from "../verdict";
import {
  hasEscaped,
  netWorth as cashflowNetWorth,
  passiveIncome,
  payday as cashflowPayday,
  totalExpenses,
} from "../cashflow/selectors";
import { getDream } from "../cashflow/dreams";
import type { CashflowState } from "../cashflow/types";
import { ensureProfile } from "./profiles";
import { alreadySubmitted, markSubmitted, submitResult, unmarkSubmitted } from "./results";
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
      /**
       * Was this run's card deal tilted toward the player's weak spots?
       *
       * A solo run passes `weakSpots` into `initRun`, which doubles the draw
       * weight of every card teaching a concept that player keeps missing
       * (`WEAK_SPOT_WEIGHT`). It is a per-player bias, and it is the reason a
       * seed alone does not reproduce a world — the daily and a match both pass
       * `undefined` for exactly that reason, and so does a challenge run.
       *
       * Written as 0 or 1 rather than omitted-when-false, deliberately. `verified`
       * can be absent because an absent proof claims nothing; this one has to
       * distinguish THREE states, because a row written before this line existed
       * genuinely cannot be judged. Present-and-0 means provably even; absent
       * means unknown. `components/screens/LifeReport.tsx` says which.
       */
      coached: run.weakSpots?.length ? 1 : 0,
    },
  };
}

/**
 * Rat Race scoring, v3.
 *
 *     score = netWorth + dream (if bought) + 12 × (payday + fastTrackCashflow)
 *
 * V2 GOT THE RAT RACE RIGHT AND FORGOT THE SECOND HALF OF THE GAME. Ranking by
 * passive income alone was blind to debt and expenses, so maximum leverage was
 * the optimal ranked strategy — the opposite of what the mode teaches. Net worth
 * counts every dollar borrowed against you and `payday` (income − ALL expenses,
 * bank interest included) counts the cost of carrying it, so you climb by buying
 * cash-flowing assets and cannot climb by drowning. That part stands.
 *
 * But both halves read the RAT RACE balance sheet only, and the Fast Track is
 * scored with the same two numbers:
 *
 *   · A Fast Track deal takes its price out of `cash` and adds its cash flow to
 *     `fastTrackCashflow` — a field with no asset line and no expense line, which
 *     neither `netWorth` nor `payday` has ever read. So every deal up there was a
 *     straight subtraction of its own price. Measured: $200,000 for +$20,000/mo
 *     scored −$200,000, and the $240,000 a year it bought counted as zero.
 *
 *   · BUYING THE DREAM IS THE WIN CONDITION, and it cost between $400,000 and
 *     $750,000 of score. Standing on the square with $425,000: decline and score
 *     388,000; buy it, win the game, and score −12,000. The mode's own ending
 *     was its single largest ranked penalty.
 *
 * So the Fast Track's cash flow is counted on the same yardstick payday already
 * gets — a year of it — and the dream is credited at cost. Crediting it is
 * deliberate and is not "counting money you spent": the alternative is a
 * leaderboard where winning is a demotion. It scales with the dream the player
 * chose because a $750,000 dream took $750,000 to reach, which is exactly the
 * work being ranked. A deal is still judged on its merits — $200,000 for
 * $20,000/mo now scores +$40,000, and $200,000 for $5,000/mo scores −$140,000.
 *
 * v1, v2 and v3 rows are not comparable, so the version rides in `metrics`.
 */
export const CASHFLOW_SCORE_VERSION = 3;

export function cashflowScore(s: CashflowState): number {
  const dream = s.dreamPurchased ? getDream(s.dreamId).cost : 0;
  return Math.round(
    cashflowNetWorth(s) + dream + 12 * (cashflowPayday(s) + s.fastTrackCashflow),
  );
}

export function resultFromCashflow(s: CashflowState): NewResult {
  const passive = passiveIncome(s);
  const escaped = hasEscaped(s);
  return {
    mode: "cashflow",
    score: cashflowScore(s),
    verdict: s.status === "lost"
      ? CASHFLOW_VERDICTS.buried
      : escaped
        ? CASHFLOW_VERDICTS.escaped
        : CASHFLOW_VERDICTS.racing,
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
      // The second half of the game, so a row can be read back and the score
      // recomputed. Both are zero/absent for a run that never left the Rat Race.
      fastTrackCashflow: s.fastTrackCashflow,
      ...(s.dreamPurchased ? { dream: getDream(s.dreamId).cost } : {}),
      won: s.status === "won" ? 1 : 0,
    },
  };
}

/**
 * Post a finished run exactly once and bump the daily streak. `runKey` must be
 * stable+unique per run (e.g. the run seed). Durable across reloads, so this is
 * the single submit path for every mode — no per-mount ref needed.
 *
 * Resolves to whether this run is recorded in the cloud. `false` for an anonymous
 * player (nothing to post to) and for a post that failed; `true` for one that
 * landed, now or on an earlier visit.
 *
 * THE TWO HALVES ARE NOT THE SAME COMMITMENT, and the ordering below is the whole
 * point of the function:
 *
 *   · The RESULT is what the dedupe key protects. Its mark is written first so a
 *     re-fire inside one mount cannot post twice, and taken back if the write does
 *     not land — otherwise one refusal retires a finished run permanently on that
 *     device. See `unmarkSubmitted`.
 *
 *   · The STREAK is not. Once the result row exists, the run IS posted, and
 *     rolling the mark back over a failed streak bump would re-post the result on
 *     the next visit — a duplicate row bought to retry a counter. A streak that
 *     misses a day is the smaller loss, so `bumpStreak` throwing (which it now
 *     does, rather than reporting success on a refusal) is caught here and stops
 *     at the streak.
 */
export async function submitRunOnce(
  runKey: string,
  playerId: string | null,
  result: NewResult,
): Promise<boolean> {
  if (!playerId) return false;
  if (alreadySubmitted(runKey)) return true;

  markSubmitted(runKey); // optimistic: synchronous, so re-fires within a mount no-op
  try {
    await ensureProfile(playerId);
    await submitResult(playerId, result);
  } catch {
    unmarkSubmitted(runKey);
    return false;
  }

  try {
    await bumpStreak(playerId);
  } catch {}
  return true;
}
