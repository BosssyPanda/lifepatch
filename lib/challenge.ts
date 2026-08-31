"use client";

import type { ModeId } from "./modes";
import type { RunState } from "./runEngine";

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

const KEY = "lifepatch.challenge";

export type Challenge = {
  /** The row this came from, so the report can point back at the statement. */
  resultId: string;
  /** The three things that fix a world. All must match for a comparison to mean anything. */
  seed: number;
  backgroundId: string;
  mode: ModeId;

  /** Who to name in the report. */
  name: string;
  score: number;
  verdict: string;

  /** Their per-year net worth, and the calendar year the series opens on. */
  history: number[];
  startYear: number;

  /**
   * Was their deal tilted?
   *
   * A solo run biases its card draw toward the concepts that player keeps getting
   * wrong (`WEAK_SPOT_WEIGHT` in `lib/runEngine.ts`), and that bias is per-player.
   * A challenge run is dealt WITHOUT it — the same posture the daily and a match
   * take, for the same reason: everyone's world has to be identical. So the two
   * lives share their markets and their opening exactly, and share their cards
   * exactly when the original was not coached either.
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

export function writeChallenge(c: Challenge): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(c));
  } catch {}
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
      typeof c.seed !== "number" ||
      typeof c.backgroundId !== "string" ||
      typeof c.mode !== "string" ||
      typeof c.name !== "string" ||
      typeof c.score !== "number" ||
      !Array.isArray(c.history) ||
      typeof c.startYear !== "number"
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
