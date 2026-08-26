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
import { CASHFLOW_SCORE_VERSION } from "./comparability";
import type { GameMode, NewResult } from "./types";

/**
 * A finished run → the row that represents it. Nothing else.
 *
 * This is a LEAF, and it is a leaf on purpose. `buildResult` — which used to own
 * these two functions — is the submit orchestrator: it reaches localStorage for
 * the dedupe keys and the retry queue, and it imports the Supabase client through
 * `./results`. None of that can run inside `app/api/submit-result`, which is the
 * one place a score is now derived from a replay rather than taken on trust, and
 * which must therefore compute the row the SAME way the client does or the two
 * would silently diverge.
 *
 * So the pure half moved here and the orchestration stayed. `buildResult`
 * re-exports both names, so every existing call site is untouched.
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
      // What this run was, so two rows can be told apart and compared honestly.
      // `seed` also gives the share lookup a key that cannot collide (two runs of
      // one mode landing on the same net worth used to fight over one URL).
      seed: run.seed,
      backgroundId: run.backgroundId,
      // NOT unconditionally RUN_VERSION. A save carried forward by `migrateSave`
      // played most of its years under the older economy and only its last few
      // under this one, so stamping it with today's version would slip it past the
      // comparability filter in `topResults` — the filter added in the same change
      // as the migration, to keep exactly those runs off this board. It keeps its
      // share page either way; it just ranks with the engine it was mostly played on.
      //
      // This is the CLIENT path, and it is the only one where `migratedFrom`
      // survives to be read: the server builds its row from `replayRun`'s output,
      // which starts at `initRun` and therefore never carries the field. That is
      // not a hole — the route refuses to write a row at all when the replay lands
      // somewhere other than the score the player was shown, which is what a run
      // carried across an engine bump does. A migrated run that DOES reproduce
      // exactly under today's engine is a run today's engine produces, and belongs
      // on today's board.
      engine: run.migratedFrom ?? RUN_VERSION,
      // The Daily Ledger stays `mode: "story"` — its board is a filter on this
      // field, not a fourth mode, so the table's own check constraint, its policies
      // and its index are all untouched. The SERVER re-derives this from the seed
      // (see `app/api/submit-result`), because `lib/daily.ts` is a pure client
      // function and a browser could otherwise play any past day at leisure and
      // file it under today. What is written here is the claim, not the record.
      ...(run.daily ? { daily: run.daily } : {}),
      // `verified` is deliberately NOT written here any more.
      //
      // It used to be: the client replayed its own journal, matched its own score,
      // and wrote its own flag. Every step of that is under the control of whoever
      // is claiming the score, so the badge attested to nothing — a modified client
      // writes both halves and the row is indistinguishable from an honest one.
      // The row-level policy now REFUSES a client insert that carries the key at
      // all, so the flag exists only where it can mean something: written by
      // `app/api/submit-result` with the service role, after the server itself
      // replayed the recorded actions and derived this score from them.
      //
      // An absent flag still makes no claim either way — which is the correct
      // reading for a Rat Race run (no action log to replay), a run resumed from a
      // save that predates journaling, and any row posted while the route is not
      // deployed.
    },
  };
}

/**
 * Rat Race scoring, v3.
 *
 * v1 ranked by passive income alone, which was blind to debt and expenses, so
 * maximum leverage was the optimal ranked strategy — the exact opposite of what
 * the mode teaches. v2 replaced it with a balance-sheet measure plus a year of
 * realized cash flow:
 *
 *     score = netWorth + 12 × payday
 *
 * That fixed the leverage exploit and introduced a bigger one in the same place it
 * had just closed, because the starting balance sheets are not level and nothing
 * subtracted them. Every profession begins in the hole — a personal home mortgage
 * is a liability with no matching asset on this board — and the holes are not
 * remotely the same size: the Janitor opens at −$43,350 and the Doctor at
 * −$512,600. That is a $469,250 head start handed out at the character-select
 * screen, against a mode whose whole run is worth a fraction of it. The board was
 * ranking profession choice, not play, and the winning move was to pick the
 * Janitor and stop thinking.
 *
 * v3 measures the distance travelled instead:
 *
 *     score = (netWorth + 12 × payday) − startingNetWorth
 *
 * The Doctor's debt still costs the Doctor every turn — it is in `payday` as
 * interest and in `netWorth` as principal — but it is no longer scored as a
 * mistake they made. `startingNetWorth` is already on the state (`initCashflow`
 * records it, and `persist` backfills it for older saves), so nothing new has to
 * be tracked to say it.
 *
 * v1 and v2 rows are not comparable to v3 rows, so the version rides in `metrics`
 * — and, as of this change, `topResults` actually filters on it. It lives in
 * `./comparability` because both the writer here and the reader there need it, and
 * that module importing this one would close a cycle.
 */

export function cashflowScore(s: CashflowState): number {
  return Math.round(cashflowNetWorth(s) + 12 * cashflowPayday(s) - s.startingNetWorth);
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
