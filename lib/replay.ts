/**
 * Replaying a life.
 *
 * The engine has always been deterministic — markets are a coordinate hash, the
 * year's cards come off a stream re-seeded from `(seed, year)`, and an outcome roll
 * is salted by `(seed, year, eventId, choiceId)` and reads nothing else. What it
 * never recorded was the other half of the input: what the player DID. `RunState.journal`
 * records that, and this module is what the two halves are worth together.
 *
 * Two things are built on the same driver, and the difference between them is one
 * function:
 *
 *   • `replayRun(ticket)` re-simulates the run exactly. Feed it back its own actions
 *     and it must land on the same number — that is `verifyResult`.
 *   • `replayRun(ticket, { allocate })` re-simulates the same LIFE with different
 *     money. Same cards, same choices, same outcomes; only the allocation changes.
 *     That is the ghost line.
 *
 * The second only works because the deal is FORCED. `drawEvents` builds its pool
 * from `eligibleEvents(eventContext(s))`, and that context carries cash, debt and
 * salary — so a life that invested differently is dealt a different hand from the
 * same seed. A counterfactual that redraws is not a counterfactual, it is a
 * different life wearing the same seed. Replacing `pendingEvents` from the journal
 * is the whole mechanism.
 *
 * Pure: no clock, no `Math.random`, no storage, no DOM.
 */

import { TAKE_HOME } from "./economy";
import { getEvent } from "./lifeEvents";
import type { ModeId } from "./modes";
import {
  advanceYear,
  annualExpenses,
  applyLifeChoice,
  debtMinimum,
  hasFullJournal,
  initRun,
  mortgageService,
  netWorth,
  payDebt,
  quitRun,
  retire,
  trade,
  type RunState,
  type YearJournal,
} from "./runEngine";

/** Everything a re-simulation needs. `seed` is required: it is the one thing
 *  `initRun` will otherwise roll for itself. */
export type ReplayTicket = {
  mode: ModeId;
  backgroundId: string;
  name: string;
  seed: number;
  sharedEvents?: boolean;
  weakSpots?: string[];
  /**
   * The last journal entry is a year still IN PROGRESS — its acts count, but it was
   * never turned.
   *
   * Only the final entry can be ambiguous, and only between two readings: a run
   * still being played, and a run that ended on the year it just resolved. Every
   * earlier entry is unambiguous because a later one exists, and a year the run
   * ended inside carries `end`. So one flag on the ticket settles it, and the
   * journal itself stays free of a per-year marker it would pay for in every save.
   */
  open?: boolean;
  journal: YearJournal[];
};

/** A counterfactual's money policy: one decision per year, after every card is
 *  answered and before the year turns. */
export type Allocator = (s: RunState) => RunState;

export type ReplayOpts = { allocate?: Allocator };

/** A point on either line. Structurally what `AnnotatedLifeChart` plots. */
export type LifePoint = { year: number; netWorth: number };

/**
 * The ticket for a run, or null when this run cannot be replayed — a save from
 * before journaling, or one that came back from a room through the wire parser,
 * which rebuilds `RunState` field by field and drops it.
 */
export function ticketFor(s: RunState): ReplayTicket | null {
  if (!hasFullJournal(s)) return null;
  return {
    mode: s.mode,
    backgroundId: s.backgroundId,
    name: s.name,
    seed: s.seed,
    sharedEvents: s.sharedEvents,
    weakSpots: s.weakSpots,
    open: s.status === "playing" || undefined,
    journal: s.journal,
  };
}

/**
 * Re-simulate a life from its ticket.
 *
 * Returns null rather than a best effort at every point where the journal and the
 * engine disagree. A replay that patches over a mismatch is worse than no replay:
 * it produces a plausible number that nothing generated.
 */
export function replayRun(t: ReplayTicket, opts: ReplayOpts = {}): RunState | null {
  let s = initRun(t.mode, t.backgroundId, t.name, t.seed, t.sharedEvents, {
    weakSpots: t.weakSpots,
  });
  // A counterfactual's own journal would describe the COUNTERFACTUAL's draws, which
  // are not this life's — so it is dropped and `record` no-ops for the whole run.
  // A verification replay KEEPS it: it has to come out identical, which makes the
  // rebuilt journal a free second check on the first one.
  if (opts.allocate) s = { ...s, journal: undefined };

  for (let i = 0; i < t.journal.length; i++) {
    const entry = t.journal[i];
    if (s.status !== "playing") {
      // A verification replay must track the recorded life exactly: a journal that
      // outlives it is a desync, and there is nothing honest to return.
      //
      // A COUNTERFACTUAL is different, and this distinction was missing. The ghost
      // is subject to the same rules as the life it shadows — including the forced
      // pro-rata liquidation and the insolvency ending — so a different allocation
      // can genuinely end it sooner. That is a result, not a disagreement. Hand back
      // the shorter life; `ghostFor` marks it `truncated` and the report says the
      // other version ran out of road first.
      return opts.allocate ? s : null;
    }
    if (s.year !== entry.y) return null; // desync — refuse, never interpolate

    // The forced deal. See this file's note.
    s = { ...s, pendingEvents: [...entry.deal] };

    for (const act of entry.acts) {
      if (act[0] === "c") {
        const choice = getEvent(act[1])?.choices.find((c) => c.id === act[2]);
        if (!choice) return null; // the content changed under the journal
        const before = s;
        s = applyLifeChoice(s, act[1], choice);
        if (s === before) return null; // the engine refused it
        // The roll has to land where it landed. `rollOutcome` is salted by
        // (seed, year, eventId, choiceId) and reads nothing else, so on the same
        // seed and year it CANNOT differ — which is exactly why a different
        // allocation replays to the same outcomes. Asserted anyway: if that salt
        // ever gains a state term, this must fail loudly rather than draw a
        // plausible lie.
        if (s.yearChoices[act[1]] !== `${act[2]}|${act[3]}`) return null;
      } else if (act[0] === "t") {
        if (opts.allocate) continue; // the counterfactual buys its own way
        s = trade(s, act[1], act[2]);
      } else {
        // Debt payments replay VERBATIM, even for a counterfactual, and that is the
        // difference between a comparison and a muddle. The ghost exists to answer
        // one question — what if the money you invested had gone into the index —
        // so exactly one variable may move. Let it skip the player's payments too
        // and it becomes a different debt strategy as well, carrying 7% interest
        // the player had cleared, and the gap stops meaning anything.
        //
        // `spareCash` is built to match: it subtracts the lender's MINIMUM, which is
        // not optional, and leaves voluntary payments to arrive here as recorded acts.
        s = payDebt(s, act[1]);
      }
    }

    if (opts.allocate) s = opts.allocate(s);

    // A year the run ended inside: its acts counted, and then the life stopped.
    if (entry.end) return entry.end === "retire" ? retire(s) : quitRun(s);
    // The year in progress. Turning it would play a year the player has not
    // finished — and, worse, would do it from a plausible-looking replay.
    if (t.open && i === t.journal.length - 1) return s;
    s = advanceYear(s);
  }
  return s;
}

/**
 * Does this run re-simulate to the number it claims?
 *
 * A self-check, not an attestation. It proves the recorded actions produce the
 * recorded score on this engine — which catches a corrupted save, a mis-migrated
 * one, and a score typed in by hand. It cannot prove anything about a client that
 * was modified to write both halves, and nothing in the UI says otherwise.
 */
export function verifyResult(t: ReplayTicket, claimedScore: number): boolean {
  const r = replayRun(t);
  return !!r && r.status === "ended" && Math.round(netWorth(r)) === Math.round(claimedScore);
}

// ── the ghost ───────────────────────────────────────────────────────────────

/**
 * Months of costs the ghost keeps liquid. Not a fudge factor: it is the
 * `emergencyFund` concept the game itself teaches — "3–6 months of expenses that
 * turn a crisis into an inconvenience".
 */
export const GHOST_BUFFER_MONTHS = 6;

/**
 * Cash this year does not need.
 *
 * Derived from `advanceYear`'s own order of operations rather than a rule of thumb:
 * take-home lands first, then the cost of living, then the mortgage payment, then
 * the lender's minimum — which is not optional and will force a pro-rata sale of
 * holdings if cash cannot cover it. Whatever that sequence can't cover has to come
 * out of cash today, and only what is left over on top of the buffer is spare.
 *
 * Deliberately NOT `autoResolve.autoAllocate`'s formula. That one holds a full year
 * back and invests 0.8 of the rest — an admittedly unremarkable default that also
 * ignores the mortgage and the minimum, so a ghost following it would manufacture
 * 7% debt and then be force-sold in exactly the years this feature exists to
 * explain. `autoAllocate` is not changed either: it is load-bearing for match
 * lockstep and for every standing already on a podium.
 */
export function spareCash(s: RunState): number {
  const takeHome = Math.round(s.salary * TAKE_HOME);
  const needed = annualExpenses(s) + mortgageService(s).payment + debtMinimum(s.debt);
  const fromCash = Math.max(0, needed - takeHome);
  const buffer = Math.round((annualExpenses(s) * GHOST_BUFFER_MONTHS) / 12);
  return Math.max(0, Math.floor(s.cash - fromCash - buffer));
}

/** The ghost's one rule: every spare dollar into the index, every year. It never
 *  sells, never holds anything else, and never times anything. */
export function indexEverything(s: RunState): RunState {
  if (s.status !== "playing") return s;
  const spare = spareCash(s);
  return spare > 0 ? trade(s, "index", spare) : s;
}

export type GhostLine = {
  points: LifePoint[];
  final: number;
  /** The player's number minus the ghost's. Positive means the player won. */
  gap: number;
  /** The ghost's life ended before the player's — there is nothing to compare after. */
  truncated: boolean;
};

/** The counterfactual line for a finished run, or null when it can't be drawn. */
export function ghostFor(s: RunState): GhostLine | null {
  const t = ticketFor(s);
  if (!t) return null;
  const g = replayRun(t, { allocate: indexEverything });
  if (!g) return null;
  const points = g.history.map((h) => ({ year: h.year, netWorth: h.netWorth }));
  if (points.length < 2) return null;
  const final = Math.round(netWorth(g));
  return {
    points,
    final,
    gap: Math.round(netWorth(s)) - final,
    truncated: g.history.length < s.history.length,
  };
}

// ── the daily's share grid ──────────────────────────────────────────────────

export type GridCell = "ahead" | "level" | "behind";

/**
 * Within this much of the ghost, a year reads `level` rather than picking a side.
 * Without a band, a $12 difference on a $400,000 position would print as a win.
 */
export const GRID_LEVEL_BAND = 0.02;

/**
 * One cell per year: were you ahead of, level with, or behind the index at the end
 * of it.
 *
 * This is the spoiler-safe encoding, and that is the point of choosing it. It says
 * nothing about what the market did — a crash year in which you fell just as far
 * reads `level`, not red — so a grid posted publicly cannot tell anyone still
 * playing today's puzzle which years to brace for. It carries no calendar years
 * either, which the house rule on spoilers requires.
 */
export function indexGrid(run: RunState, ghost: GhostLine): GridCell[] {
  const out: GridCell[] = [];
  for (let i = 0; i < run.history.length; i++) {
    const mine = run.history[i].netWorth;
    const theirs = ghost.points[i]?.netWorth;
    if (theirs === undefined) break; // the ghost stopped first — see `truncated`
    const scale = Math.max(Math.abs(mine), Math.abs(theirs), 1);
    const diff = mine - theirs;
    out.push(Math.abs(diff) <= scale * GRID_LEVEL_BAND ? "level" : diff > 0 ? "ahead" : "behind");
  }
  return out;
}
