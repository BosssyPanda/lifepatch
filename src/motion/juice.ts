/**
 * Impact tiering — one function decides how big a money event *feels*.
 *
 * Shake amplitude, particle count, pop scale, and audio pitch all have to agree, or the
 * ceremony reads as noise: a small loss that shakes hard but drops three bills is incoherent.
 * So they come from a single tier derived from the swing's size relative to net worth, and
 * every consumer reads the same struct instead of re-inventing thresholds.
 *
 * Tiers: 0 = a nick (<5% of net worth), 1 = a real hit (5–15%), 2 = it changes the run (>15%).
 *
 * Consumers: `ConsequenceBeat` (shake amplitude, one-shot bill/ash count, the DEBIT/CREDIT
 * stamp's entry scale, the count-up tick's brightness) and `YearHud`'s FlashValue (the
 * number pop). Tier 1 reproduces the values those surfaces used to hardcode, so a mid-sized
 * hit still feels exactly like it did — the tiers add range around it, they don't move it.
 */

export type JuiceTier = {
  tier: 0 | 1 | 2;
  /** Screen-shake amplitude in px (peak displacement). */
  shakePx: number;
  /** One-shot bill/ash particle count. */
  bills: number;
  /** Peak scale for the number pop. */
  popScale: number;
  /** Entry scale for a stamp landing (it settles to 1). */
  stampScale: number;
  /** Semitones to transpose the impact accent by. */
  pitch: number;
};

const TIERS: readonly [JuiceTier, JuiceTier, JuiceTier] = [
  { tier: 0, shakePx: 3, bills: 12, popScale: 1.03, stampScale: 1.18, pitch: 0 },
  { tier: 1, shakePx: 6, bills: 18, popScale: 1.06, stampScale: 1.3, pitch: 2 },
  { tier: 2, shakePx: 10, bills: 24, popScale: 1.1, stampScale: 1.44, pitch: 4 },
];

/**
 * @param magnitudePct |Δ| as a percentage of net worth (5 means "a twentieth of everything").
 */
export function juiceTier(magnitudePct: number): JuiceTier {
  const m = Number.isFinite(magnitudePct) ? Math.abs(magnitudePct) : 0;
  if (m > 15) return TIERS[2];
  if (m >= 5) return TIERS[1];
  return TIERS[0];
}
