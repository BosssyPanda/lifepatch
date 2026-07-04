"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";
import { currency } from "@/lib/format";
import { macroEvent, sp500Return } from "@/lib/markets";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { EASE } from "@/src/motion/tokens";

/**
 * Phase M3 — the annotated net-worth line for a finished run (antimetal's
 * annotated-chart language, MarketSection's SVG grammar). LINEAR scale with a
 * dashed zero baseline (net worth can go negative). Every annotation is
 * derived from recorded data only: BEST/WORST year from the series' own
 * deltas, plus up to 3 real macro events (lib/markets) for calendar years the
 * run actually lived through — never a guessed event→year pairing.
 */

const W = 960;
const H = 380;
const PAD = { top: 64, right: 26, bottom: 40, left: 26 };
const MAX_MACRO = 3;

export type LifePoint = { year: number; netWorth: number };

type Plotted = LifePoint & { x: number; y: number };

function plot(points: LifePoint[]): { pts: Plotted[]; zeroY: number | null } {
  const values = points.map((p) => p.netWorth);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const span = max - min || 1;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x0 = points[0].year;
  const x1 = points[points.length - 1].year || x0 + 1;
  const pts = points.map((p) => ({
    ...p,
    x: PAD.left + ((p.year - x0) / Math.max(1, x1 - x0)) * innerW,
    y: PAD.top + (1 - (p.netWorth - min) / span) * innerH,
  }));
  const zeroY = min < 0 ? PAD.top + (1 - (0 - min) / span) * innerH : null;
  return { pts, zeroY };
}

type ChartModel = {
  pts: Plotted[];
  zeroY: number | null;
  d: string;
  best: Plotted | null;
  worst: Plotted | null;
  bestDelta: number;
  worstDelta: number;
  macro: Plotted[];
} | null;

export function AnnotatedLifeChart({ points, className = "" }: { points: LifePoint[]; className?: string }) {
  const { reduced } = useMotionCtx();

  const model = useMemo((): ChartModel => {
    if (points.length < 2) return null;
    const { pts, zeroY } = plot(points);

    // deltas between recorded years — the run's own best/worst swings
    let best: Plotted | null = null;
    let worst: Plotted | null = null;
    let bestDelta = 0;
    let worstDelta = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = pts[i].netWorth - pts[i - 1].netWorth;
      if (d > bestDelta) { bestDelta = d; best = pts[i]; }
      if (d < worstDelta) { worstDelta = d; worst = pts[i]; }
    }

    // real macro events crossed by this run, strongest market moves first
    const taken = new Set([best?.year, worst?.year]);
    const macro = pts
      .filter((p) => !taken.has(p.year) && macroEvent(p.year))
      .sort((a, b) => Math.abs(sp500Return(b.year)) - Math.abs(sp500Return(a.year)))
      .slice(0, MAX_MACRO)
      .sort((a, b) => a.x - b.x);

    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    return { pts, zeroY, d, best, worst, bestDelta, worstDelta, macro };
  }, [points]);

  if (!model) return null;
  const { pts, zeroY, d, best, worst, bestDelta, worstDelta, macro } = model;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const up = last.netWorth >= 0;
  const clampX = (x: number) => Math.min(W - 70, Math.max(70, x));
  const clampY = (y: number) => Math.min(H - 10, Math.max(14, y));

  const anno = { initial: reduced ? false : { opacity: 0 }, whileInView: { opacity: 1 }, viewport: { once: true, amount: 0.4 } } as const;

  return (
    <div className={`border border-hairline bg-bg2 p-3 sm:p-4 ${className}`}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Net worth by year, with the run's best year, worst year, and the real market events it lived through.">
        {/* frame + zero baseline */}
        <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} stroke="var(--color-hairline)" />
        {zeroY !== null && (
          <>
            <line x1={PAD.left} y1={zeroY} x2={W - PAD.right} y2={zeroY} stroke="var(--color-ink-dim)" strokeDasharray="2 5" opacity="0.6" />
            <text x={W - PAD.right} y={zeroY - 6} textAnchor="end" className="num" fontSize="11" fill="var(--color-tertiary)">$0</text>
          </>
        )}

        {/* the life line */}
        <motion.path
          d={d}
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth="2"
          strokeLinejoin="round"
          initial={reduced ? false : { pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: reduced ? 0 : 1.5, ease: EASE }}
          style={reduced ? { pathLength: 1 } : undefined}
        />

        {/* macro events actually crossed — dotted leaders to the top band */}
        {macro.map((p, i) => {
          const e = macroEvent(p.year)!;
          const tone = e.tone === "bad" ? "var(--color-loss)" : e.tone === "good" ? "var(--color-gain)" : "var(--color-ink-dim)";
          const labelY = 18 + (i % 2) * 17;
          return (
            <motion.g key={p.year} {...anno} transition={{ delay: reduced ? 0 : 0.7 + i * 0.15 }}>
              <line x1={p.x} y1={labelY + 6} x2={p.x} y2={p.y - 5} stroke={tone} strokeDasharray="1 4" opacity="0.8" />
              <circle cx={p.x} cy={p.y} r="3.5" fill={tone} />
              <text x={clampX(p.x)} y={labelY} textAnchor="middle" className="num" fontSize="12" fill={tone} letterSpacing="0.08em">
                {p.year} — {e.title.toUpperCase()} · {sp500Return(p.year) > 0 ? "+" : "−"}{Math.abs(sp500Return(p.year)).toFixed(0)}%
              </text>
            </motion.g>
          );
        })}

        {/* best / worst swings, from the run's own deltas (skip when they sit on
            the final point — the final plate already owns that spot) */}
        {best && bestDelta > 0 && best.year !== last.year && (
          <motion.g {...anno} transition={{ delay: reduced ? 0 : 1.0 }}>
            <circle cx={best.x} cy={best.y} r="4" fill="var(--color-gain)" />
            <text x={clampX(best.x)} y={clampY(best.y - 12)} textAnchor="middle" className="num" fontSize="12" fill="var(--color-gain)" letterSpacing="0.08em">
              BEST {best.year} +{currency(bestDelta)}
            </text>
          </motion.g>
        )}
        {worst && worstDelta < 0 && worst.year !== last.year && (
          <motion.g {...anno} transition={{ delay: reduced ? 0 : 1.1 }}>
            <circle cx={worst.x} cy={worst.y} r="4" fill="var(--color-loss)" />
            <text x={clampX(worst.x)} y={clampY(worst.y + 20)} textAnchor="middle" className="num" fontSize="12" fill="var(--color-loss)" letterSpacing="0.08em">
              WORST {worst.year} −{currency(Math.abs(worstDelta))}
            </text>
          </motion.g>
        )}

        {/* start / final plates */}
        <motion.g {...anno} transition={{ delay: reduced ? 0 : 1.2 }}>
          <text x={first.x} y={H - PAD.bottom + 24} textAnchor="start" className="num" fontSize="12" fill="var(--color-tertiary)" letterSpacing="0.08em">
            {first.year}
          </text>
          <circle cx={last.x} cy={last.y} r="4.5" fill={up ? "var(--color-gain)" : "var(--color-loss)"} />
          <text x={W - PAD.right} y={H - PAD.bottom + 24} textAnchor="end" className="num" fontSize="12" fill="var(--color-tertiary)" letterSpacing="0.08em">
            {last.year}
          </text>
          <text x={clampX(last.x)} y={Math.max(30, last.y - 14)} textAnchor="middle" className="num" fontSize="14" fontWeight="700" fill={up ? "var(--color-gain)" : "var(--color-loss)"}>
            {last.netWorth < 0 ? "−" : ""}{currency(Math.abs(last.netWorth))}
          </text>
        </motion.g>
      </svg>
    </div>
  );
}
