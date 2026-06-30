"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { AssetDef } from "@/lib/assets";
import { currency } from "@/lib/format";
import type { AssetId } from "@/lib/markets";

const EASE = [0.2, 0.65, 0.3, 0.9] as const;

type Mix = Partial<Record<AssetId, number>>;

type Preset = {
  id: "safe" | "balanced" | "bold";
  label: string;
  tagline: string;
  /** Target mix as % of free cash. Must sum to 100 (before crypto fold). */
  mix: Mix;
  hex: string;
  risk: string;
};

// A deliberate risk ladder, left to right. This ordering IS the lesson.
const PRESETS: Preset[] = [
  {
    id: "safe",
    label: "Safe",
    tagline: "Sleep at night. Barely keep up with inflation.",
    mix: { savings: 50, bonds: 30, index: 20 },
    hex: "#7f8b52",
    risk: "low risk",
  },
  {
    id: "balanced",
    label: "Balanced",
    tagline: "Spread the bets. Grow without the heart attacks.",
    mix: { index: 40, realEstate: 20, bonds: 20, gold: 10, savings: 10 },
    hex: "#c8861e",
    risk: "medium risk",
  },
  {
    id: "bold",
    label: "Bold",
    tagline: "Swing for growth. Stomach the drawdowns.",
    mix: { index: 45, realEstate: 20, crypto: 20, gold: 15 },
    hex: "#a33218",
    risk: "high risk",
  },
];

/**
 * Resolve a preset's mix against the assets actually available this year.
 * If an asset (e.g. crypto) is unavailable, its weight folds into Index so the
 * mix still sums to 100 and stays fully invested.
 */
function resolveMix(mix: Mix, availableIds: Set<AssetId>): Array<[AssetId, number]> {
  const folded: Mix = {};
  let orphaned = 0;
  for (const [id, pct] of Object.entries(mix) as Array<[AssetId, number]>) {
    if (availableIds.has(id)) folded[id] = (folded[id] ?? 0) + pct;
    else orphaned += pct;
  }
  if (orphaned > 0) folded.index = (folded.index ?? 0) + orphaned;
  return (Object.entries(folded) as Array<[AssetId, number]>).filter(([, p]) => p > 0);
}

/**
 * Turn a resolved mix into concrete buy orders that never exceed `cash`.
 * Each bucket gets floor(cash * pct/100); the rounding remainder lands on the
 * largest bucket, and the running total is hard-clamped to `cash`.
 */
function allocate(entries: Array<[AssetId, number]>, cash: number): Array<[AssetId, number]> {
  if (cash <= 0 || entries.length === 0) return [];
  const orders: Array<[AssetId, number]> = entries.map(([id, pct]) => [id, Math.floor((cash * pct) / 100)]);
  let spent = orders.reduce((sum, [, amt]) => sum + amt, 0);
  let remainder = cash - spent;
  if (remainder > 0) {
    let biggest = 0;
    for (let i = 1; i < orders.length; i++) if (orders[i][1] > orders[biggest][1]) biggest = i;
    orders[biggest][1] += remainder;
    spent = cash;
  }
  // hard safety clamp — never let the sum exceed cash under any rounding path
  const out: Array<[AssetId, number]> = [];
  let budget = cash;
  for (const [id, amt] of orders) {
    const safe = Math.min(amt, budget);
    if (safe > 0) {
      out.push([id, safe]);
      budget -= safe;
    }
  }
  return out;
}

export function PortfolioPresets({
  availableAssets,
  cash,
  onApply,
}: {
  availableAssets: AssetDef[];
  cash: number;
  onApply: (orders: Array<[AssetId, number]>) => void;
}) {
  const reduce = useReducedMotion();
  const availableIds = new Set(availableAssets.map((a) => a.id));
  const canInvest = cash > 0;

  const apply = (preset: Preset) => {
    if (!canInvest) return;
    const orders = allocate(resolveMix(preset.mix, availableIds), cash);
    if (orders.length > 0) onApply(orders);
  };

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="eyebrow text-ink-dim">Start with a mix</p>
        <p className="eyebrow text-ink-dim/70">low → high risk</p>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {PRESETS.map((preset, i) => (
          <motion.button
            key={preset.id}
            type="button"
            disabled={!canInvest}
            onClick={() => apply(preset)}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE, delay: reduce ? 0 : i * 0.05 }}
            whileHover={reduce || !canInvest ? undefined : { y: -2 }}
            whileTap={reduce || !canInvest ? undefined : { y: 0, scale: 0.99 }}
            className="group relative overflow-hidden rounded-[5px] border bg-bg2 px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{ borderColor: `${preset.hex}40` }}
          >
            {/* risk wash that warms on hover */}
            <span
              aria-hidden
              className="absolute inset-x-0 top-0 h-[3px]"
              style={{ background: preset.hex }}
            />
            <span className="flex items-baseline justify-between">
              <span className="display-caps text-base" style={{ color: preset.hex }}>
                {preset.label}
              </span>
              <span className="eyebrow" style={{ color: `${preset.hex}cc`, fontSize: "0.5rem" }}>
                {preset.risk}
              </span>
            </span>
            <span className="mt-1 block font-serif text-[0.8rem] italic leading-snug text-ink-dim">
              {preset.tagline}
            </span>
          </motion.button>
        ))}
      </div>
      <p className="mt-2 font-serif text-xs italic text-ink-dim/80">
        {canInvest
          ? <>One tap splits your {currency(cash)} across a starter mix. Fine-tune below.</>
          : "Invested. Sell something below to free up cash, or advance the year."}
      </p>
    </div>
  );
}
