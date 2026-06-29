// Deterministic, cursor-threaded RNG (mirrors lib/runEngine's mulberry32) so a
// run is fully replayable from its seed and easy to debug.

export function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
