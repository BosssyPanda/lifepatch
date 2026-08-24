// Cursor-threaded RNG for the board game: the cursor lives in CashflowState and
// advances on every draw, so a run replays from (seed, cursor).
//
// The generator itself comes from `lib/rng` — it used to be a second copy of
// `mulberry32`, identical by hand rather than by import, which is the kind of
// duplication that forks a replay from the run it claims to reproduce.
//
// NOTE this is a DIFFERENT discipline from the life sim's: `runEngine` addresses its
// draws by coordinate `(seed, year, salt)`, so a year can be computed without the ones
// before it. Here the cursor is state, and a purchase advances it — which is why two
// boards on one seed diverge as soon as their purchase counts differ.

import { mulberry32 } from "../rng";

export { mulberry32 };

/** A single 0..1 draw for (seed, cursor). Same inputs → same output. */
export function rngAt(seed: number, cursor: number): number {
  return mulberry32((seed + Math.imul(cursor, 2654435761)) | 0)();
}

/** Roll `count` six-sided dice from the cursor. Pure. */
export function rollDice(seed: number, cursor: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(1 + Math.floor(rngAt(seed, cursor + i) * 6));
  }
  return out;
}

/** Pick an index into an array of length `len`. */
export function pickIndex(seed: number, cursor: number, len: number): number {
  return Math.floor(rngAt(seed, cursor) * len) % Math.max(1, len);
}
