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
 * Keyed by `LifeEvent.id`. Flagship events earn the full-screen ceremony; the
 * ~others resolve inline (§1.2 bookends — mid-run spectacle stays rare). Only
 * events with a large, correctly-signed money swing are tagged; events whose bad
 * outcome carries positive `cash` (layoff severance, credit-card spend, payday
 * advance) are deliberately excluded so the DEBIT/CREDIT stamp never misreads.
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
  // — big, correctly-signed lump-sum moments (headline framing; no ×N story) —
  // inheritance → +$25k (invest) / +$7k (splurge); the windfall lesson lands hard.
  inheritance: { headline: "Inheritance" },
  // medical → −$6k out of pocket (or a debt hit on the ignore path); emergency-fund beat.
  medical: { headline: "Hospital bill" },
  // marriage → −$30k (big) / −$3k (courthouse); status-spending vs the actual asset.
  marriage: { headline: "Wedding day" },
  // carBreaks → −$2.5k repair; the textbook "this is what an emergency fund is for".
  carBreaks: { headline: "Car repair" },
};

export function beatFor(eventId: string): ConsequenceBeatConfig | undefined {
  return CONSEQUENCE_BEATS[eventId];
}
