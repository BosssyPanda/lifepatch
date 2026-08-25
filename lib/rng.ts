/**
 * The house PRNG. One home, on purpose.
 *
 * `mulberry32` existed twice — `lib/runEngine.ts` and `lib/cashflow/rng.ts` — with
 * identical bodies and no shared import, and `hash01` was a third private copy of the
 * same idea inside `lib/markets.ts`. That was survivable while nothing replayed a run.
 * It is not survivable now: a replay that re-derives a run's draws has to spend the
 * SAME random numbers the live run spent, so an edit to one copy and not the other
 * would silently fork verified results from played ones. Nothing here may be changed
 * without invalidating every recorded run, which is exactly why it lives in one file.
 *
 * Two disciplines live here, and they are not interchangeable:
 *
 *   - `mulberry32` is a STREAM. Seed it, then draw in order; the order is the state.
 *     Used where a sequence is drawn at one point in time (a year's cards).
 *   - `hash01` is COORDINATE-ADDRESSED. `f(year, salt, seed)` with no state at all,
 *     so year 2007 can be computed without simulating 1990–2006. Used by the market
 *     model, and the reason a ghost line is cheap.
 */

/**
 * Mulberry32. 32-bit state, one multiply-xorshift round per draw.
 * Returns a generator; each call yields the next uniform in [0, 1).
 */
export function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A 32-bit hash of a string, for salting one stream apart from another by name
 * (`strHash("no-shared-card")`). Not a checksum — it only has to be stable.
 */
export function strHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}

/**
 * Deterministic uniform in [0,1) from (year, salt, seed). Same inputs → same draw,
 * with no cursor and no ordering: this is what lets the market model be a pure
 * function of the coordinate rather than a replay of everything before it.
 */
export function hash01(year: number, salt: number, seed: number): number {
  let h = Math.imul(year | 0, 0x27d4eb2d) ^ Math.imul(salt | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
