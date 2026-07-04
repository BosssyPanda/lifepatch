"use client";

import { GEOPOLITICS, MYTH_FACTS, TERMS, WEALTH_METHODS } from "@/lib/almanac";
import { RAT_SIZE } from "@/lib/cashflow/board";
import { DREAMS } from "@/lib/cashflow/dreams";
import { PROFESSIONS } from "@/lib/cashflow/professions";
import { DECISIONS } from "@/lib/decisions";
import { FIRST_YEAR, LAST_YEAR } from "@/lib/markets";
import { VERDICTS } from "@/lib/verdict";
import { NumberTicker } from "./NumberTicker";

/**
 * Landing set piece 006b — the counting band (spectacle Phase K4b).
 * Every figure is derived (a `.length` or a year span) from the live game
 * data — the honest version of the marketing stat strip.
 */

const CHOICES = DECISIONS.reduce((s, d) => s + d.options.length, 0);

const STATS: { value: number; label: string }[] = [
  { value: LAST_YEAR - FIRST_YEAR + 1, label: "Years of market history" },
  { value: CHOICES, label: "Scripted choices" },
  { value: RAT_SIZE, label: "Board tiles" },
  { value: PROFESSIONS.length, label: "Professions" },
  { value: DREAMS.length, label: "Dreams" },
  { value: WEALTH_METHODS.length + MYTH_FACTS.length + GEOPOLITICS.length + TERMS.length, label: "Almanac entries" },
  { value: Object.keys(VERDICTS).length, label: "Verdicts" },
];

export function StatBand() {
  return (
    <section className="border-t border-hairline" aria-label="Game contents by the numbers">
      <div className="grid grid-cols-2 gap-px bg-hairline sm:grid-cols-4 lg:grid-cols-7">
        {STATS.map((s) => (
          <div key={s.label} className="flex flex-col items-start gap-1 bg-bg px-4 py-6 sm:px-5">
            <span className="font-anton text-3xl leading-none text-ink sm:text-4xl">
              <NumberTicker value={s.value} durationMs={900} />
            </span>
            <span className="eyebrow text-secondary" style={{ fontSize: "0.55rem" }}>{s.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
