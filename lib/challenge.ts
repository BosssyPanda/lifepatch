import type { ResultRow } from "./cloud/types";
import { finiteNumber, wholeSeries } from "./metrics";
import type { ModeId } from "./modes";
import type { RunState } from "./runEngine";
import { BACKGROUNDS } from "./backgrounds";

/**
 * The run you were challenged to beat.
 *
 * A share link used to be a dead end: a stranger read a number, a chart and a
 * BEGIN button that dropped them on the title screen and dealt them an unrelated
 * random world. `?vs=<resultId>` closes the loop — it opens the game on the exact
 * world that statement was played on — and this module is what carries the other
 * player from the link, through the run, to the report where the comparison
 * finally means something.
 *
 * ── Why this is not in `RunState` ───────────────────────────────────────────
 * A rival is not part of the simulation. Nothing in the engine reads it, no
 * outcome depends on it, and putting it in the run would mean a save-format
 * version bump (`RUN_VERSION`) for a field the engine would never touch. It is
 * also not per-run state in the React sense: the run is persisted by
 * `lib/saves.ts` and survives a reload, so a rival held only in a component
 * would be lost on refresh and the report would quietly forget who you were
 * playing against.
 *
 * ── Why it is matched rather than trusted ───────────────────────────────────
 * One slot, and `challengeFor` hands it back only for a run standing on the same
 * world. A stored challenge that outlived its run — abandoned, or followed by a
 * fresh Story run from the mode select — must never attach itself to a life it
 * has nothing to do with and print a comparison between two different worlds.
 */

/**
 * No `"use client"` directive, deliberately — the same reason `lib/deepLink.ts`
 * carries none. `challengeableWorld` is a pure predicate and `app/r/[id]/page.tsx`,
 * a SERVER component, is one of its two callers; marking this module client-only
 * would make that import a client reference and the call a build error. The
 * storage helpers below are browser-only and guard for it themselves.
 */

const KEY = "lifepatch.challenge";

/** The world a statement was played on, or null if it is not one that can be handed over. */
export type ChallengeableWorld = {
  seed: number;
  backgroundId: string;
  mode: ModeId;
  startYear: number;
  history: number[];
  coached: 0 | 1 | null;
};

/**
 * Can this statement be offered as a world to play, and what world is it?
 *
 * ONE owner for the rules, because there are two callers and they must never
 * disagree: `app/r/[id]/page.tsx` decides whether to draw the button, and
 * `components/AppShell.tsx` decides whether to honour the link it points at.
 * They were written in the same commit and stated the same six rules twice —
 * agreement by coincidence, and a silent failure in either direction the moment
 * one of them changed. A row that fails here simply is not offered.
 *
 * The rules, and why each one is a rule:
 *
 *   • CASHFLOW rows record neither a seed nor a background: the Rat Race is a
 *     board game with its own RNG and no world to hand over.
 *   • A seed and a KNOWN background are what fix a world. Rows written before the
 *     seed was recorded have nothing to give.
 *   • A ROOM's run (`shared`) was dealt from the table's shared running order
 *     rather than its own pool, so a challenger starting from that seed takes the
 *     solo branch of `drawEvents` and lives somewhere else entirely.
 *   • A DAILY is not a practice range. Offering today's puzzle here would hand
 *     anyone a private rehearsal of it — same seed, same background, and the
 *     daily is dealt unbiased too — before they file the real attempt.
 *
 * `shared` is required to be PRESENT, not merely unequal to 1, and that is the
 * whole point of it. It is written on every new row as 0 or 1 (see
 * `lib/cloud/buildResult.ts`), so absent does not mean "solo" — it means the row
 * predates the marker and nobody can now tell which it was. Reading absent as
 * solo would offer every room run already in the table as a challengeable world
 * and print a confident year-by-year comparison between two different lives,
 * which is the exact failure the marker exists to prevent. The cost is stated
 * plainly: statements recorded before this shipped cannot be challenged, and
 * that is the honest answer rather than a guess.
 */
export function challengeableWorld(row: ResultRow): ChallengeableWorld | null {
  if (row.mode === "cashflow") return null;

  const m = row.metrics as Record<string, unknown> | undefined;
  const seed = m?.seed;
  const backgroundId = m?.backgroundId;
  if (!finiteNumber(seed)) return null;
  if (typeof backgroundId !== "string" || !BACKGROUNDS.some((b) => b.id === backgroundId)) return null;
  if (m?.shared !== 0) return null;
  if (m?.daily !== undefined) return null;

  // `wholeSeries` refuses a series it had to cut — see `lib/metrics.ts`. The money
  // comparison still stands on `score`, which is their whole run.
  const history = wholeSeries(m?.history) ?? [];
  const startYear = m?.startYear;

  return {
    // FLOORED, because `initRun` floors (`lib/runEngine.ts`) and it is the
    // authority on what a seed means. `metrics` is unconstrained jsonb with no
    // CHECK behind it, so a hand-crafted or older row can carry `12345.6`, and
    // storing that verbatim guaranteed a miss downstream: the run starts at
    // `12345`, and `challengeFor`'s `c.seed === run.seed` is then false forever.
    // The rival was dropped SILENTLY, and the cost is not just a missing chart —
    // with no challenge to key against, `AppShell` falls back to a submission key
    // of `mode-seed` without the attempt nonce, which collides with a key already
    // marked submitted. Its own comment names the outcome: "the run is neither
    // saved nor posted, and a whole life goes nowhere."
    //
    // This is canonicalisation, not a guess. The rival's run was itself dealt at
    // `floor(seed)`, so flooring here names the world they actually played.
    seed: Math.floor(seed),
    backgroundId,
    mode: row.mode,
    // Same reasoning, one field over: a year is an integer everywhere it is read.
    startYear: finiteNumber(startYear) ? Math.floor(startYear) : 0,
    history,
    // Three states, and the row tells us which: `1` their deal was tilted, `0`
    // provably even, and unknown for a row that predates the flag. Matched
    // EXACTLY rather than coerced: `Number(null)` is 0, so the generous read
    // manufactured a confident "provably even" out of a malformed field — and 0
    // is the one of the three endings `dealNote` states as a fact. Anything that
    // is not literally 0 or 1 is something nobody can vouch for.
    coached: m?.coached === 1 ? 1 : m?.coached === 0 ? 0 : null,
  };
}

export type Challenge = {
  /** The row this came from — the identity of the world being answered. */
  resultId: string;
  /**
   * This ATTEMPT at it, minted fresh every time a challenge link is opened.
   *
   * `submitRunOnce` dedupes durably on a key built from the run's seed, which is
   * unique per run only while seeds are random per run. A challenge borrows the
   * rival's seed by design, so answering your own statement — or simply taking a
   * second run at someone else's — would hash to a key already marked submitted
   * and post nothing. This is what makes the key per-run again.
   */
  attempt: string;
  /** The three things that fix a world. All must match for a comparison to mean anything. */
  seed: number;
  backgroundId: string;
  mode: ModeId;

  /** Who to name in the report. */
  name: string;
  score: number;

  /** Their per-year net worth, and the calendar year the series opens on. */
  history: number[];
  startYear: number;

  /**
   * Was their deal tilted?
   *
   * A solo run biases its card draw toward the concepts that player keeps getting
   * wrong (`WEAK_SPOT_WEIGHT` in `lib/runEngine.ts`), and that bias is per-player.
   * A challenge run is dealt WITHOUT it — the same posture the daily and a match
   * take, for the same reason: everyone's world has to be identical.
   *
   * That buys identical markets, an identical opening and one shared deck. It does
   * NOT buy an identical hand, and nothing here should claim it does: `drawEvents`
   * builds each year from `eligibleEvents(eventContext(s))`, so what a year can
   * deal you is a function of the life you have built by then. Two players drift
   * apart as their decisions do, which is the contest rather than a defect in it.
   *
   * `1` coached, `0` provably not, `null` for a row written before the flag
   * existed — where the honest answer is that we do not know. The report says
   * which of the three it is rather than guessing.
   */
  coached: 0 | 1 | null;
};

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Returns whether the rival was actually kept.
 *
 * It used to return void and swallow the failure, which made one specific bad
 * outcome unreachable to the caller: a private window or a full quota throws on
 * `setItem`, the run then starts on the rival's world anyway, and the player
 * reaches a report with no comparison on it at all — having played a whole life
 * against someone the game quietly forgot. The caller can now decline to start a
 * run it cannot finish honestly.
 */
export function writeChallenge(c: Challenge): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(KEY, JSON.stringify(c));
    return true;
  } catch {
    return false;
  }
}

export function readChallenge(): Challenge | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<Challenge>;
    // Shape-guard rather than a cast: this is player-writable storage, and a
    // half-written record must not reach the report as a row of `undefined`s.
    if (
      typeof c.resultId !== "string" ||
      // INTEGER, not merely a number. Every other field here is guarded against
      // the fact that this is player-writable storage; the seed was the one that
      // was not, and a fractional one fails `challengeFor`'s equality silently
      // rather than loudly. `challengeableWorld` floors on the way in, so an
      // integer is exactly what a record this code wrote will contain.
      !Number.isInteger(c.seed) ||
      typeof c.backgroundId !== "string" ||
      typeof c.mode !== "string" ||
      typeof c.name !== "string" ||
      typeof c.attempt !== "string" ||
      typeof c.score !== "number" ||
      // The ELEMENTS, not merely the array. This is player-writable storage, and
      // `history: ["a", null]` reaches `plot` as NaN, whose `<path d>` is
      // `MNaN,NaN L…` — an empty chart still wearing the rival's legend and grid.
      !Array.isArray(c.history) ||
      !c.history.every(finiteNumber) ||
      typeof c.startYear !== "number" ||
      // `coached` has three legal values and `dealNote` branches on all three.
      // An unvalidated one falls past `=== 1` and `=== null` to the definitive
      // "Neither deal was tilted toward anyone's weak spots" — the single ending
      // of the three that must never be reached by guessing.
      !(c.coached === 0 || c.coached === 1 || c.coached === null)
    ) {
      return null;
    }
    return c as Challenge;
  } catch {
    return null;
  }
}

export function clearChallenge(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(KEY);
  } catch {}
}

/**
 * The challenge this run is actually answering, or null.
 *
 * Seed, background AND mode, because any one of them differing means a different
 * world and therefore a meaningless comparison. A rematch on the same world
 * matches on purpose — it is the same contest, played again.
 */
export function challengeFor(run: RunState): Challenge | null {
  const c = readChallenge();
  if (!c) return null;
  return c.seed === run.seed && c.backgroundId === run.backgroundId && c.mode === run.mode ? c : null;
}
