/**
 * Consequence-beat config (presentation layer, Phase 2).
 *
 * The rebrand brief's core legibility fix: an event that reads "+$300/month"
 * should not resolve to a bare "−$3,600" with the ×12 hidden. But `lib/` is
 * frozen and numbers must never be invented — so the derivation lives here as
 * an *exact decomposition of data that already exists* in the event:
 *   - the monthly figure is the one printed in the event prompt,
 *   - monthly × months must reconcile to the outcome's own `effect.cash`.
 *
 * `ConsequenceBeat` verifies that reconciliation at render time and silently
 * omits the derivation rows if they ever drift, so the ledger can never show
 * math that disagrees with the engine.
 *
 * Keyed by `LifeEvent.id`. Only the two Phase-2 flagship events are covered.
 */

export type BeatDerivation = {
  /** Row label for the recurring unit, e.g. "Rent increase". */
  unitLabel: string;
  /** Per-period amount, taken from the event prompt (unsigned magnitude). */
  monthly: number;
  /** Number of periods, e.g. 12 months in a year. */
  months: number;
  /** Plural period noun, e.g. "months". */
  periodLabel: string;
  /** Label for the reconciled total, e.g. "Annual impact". */
  totalLabel: string;
};

export type ConsequenceBeatConfig = {
  /** Multi-row ×N breakdown. Rendered only if monthly × months === |effect.cash|. */
  derivation?: BeatDerivation;
  /** Short factual framing for lump sums (existing tag-level language). */
  headline?: string;
};

export const CONSEQUENCE_BEATS: Record<string, ConsequenceBeatConfig> = {
  // "Landlord email … +$300/month" → effect.cash −3600.  300 × 12 = 3600. ✓
  rentHike: {
    derivation: {
      unitLabel: "Rent increase",
      monthly: 300,
      months: 12,
      periodLabel: "months",
      totalLabel: "Annual impact",
    },
  },
  // "Surprise year-end bonus" → a lump sum; no ×N story, just the magnitude land.
  bonus: {
    headline: "Year-end bonus",
  },
};

export function beatFor(eventId: string): ConsequenceBeatConfig | undefined {
  return CONSEQUENCE_BEATS[eventId];
}
