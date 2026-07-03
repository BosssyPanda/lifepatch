"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useMemo, useRef } from "react";
import { FIRST_YEAR, LAST_YEAR, macroEvent, sp500Return } from "@/lib/markets";
import { NumberTicker } from "./NumberTicker";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { DUR, EASE } from "@/src/motion/tokens";

/**
 * Landing set piece 003 — "THE HOUSE KEEPS SCORE" (spectacle Phase K2).
 * The full 1957–2025 S&P history from lib/markets drawn as one scroll-revealed
 * ledger line (log scale — the honest scale for 69 years of compounding), with
 * the real macro events pinned to their years via dotted leaders. The line is
 * an SVG pathLength reveal (compositor); reduced motion shows it fully drawn.
 */

const W = 960;
const H = 420;
const PAD = { top: 30, right: 78, bottom: 34, left: 14 };
const START_STAKE = 100;

// The annotated subset — every year here has a real EVENTS entry in lib/markets.
const CALLOUT_YEARS = [1962, 1974, 1987, 2000, 2008, 2020, 2022];

type Pt = { year: number; value: number; x: number; y: number };

function buildSeries(): { pts: Pt[]; final: number } {
  let value = START_STAKE;
  const raw: { year: number; value: number }[] = [{ year: FIRST_YEAR - 1, value }];
  for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) {
    value *= 1 + sp500Return(y) / 100;
    raw.push({ year: y, value });
  }
  const logMin = Math.log10(START_STAKE * 0.5);
  const logMax = Math.log10(value * 1.35);
  const pts = raw.map((r) => ({
    ...r,
    x: PAD.left + ((r.year - (FIRST_YEAR - 1)) / (LAST_YEAR - (FIRST_YEAR - 1))) * (W - PAD.left - PAD.right),
    y: PAD.top + (1 - (Math.log10(r.value) - logMin) / (logMax - logMin)) * (H - PAD.top - PAD.bottom),
  }));
  return { pts, final: value };
}

export function MarketSection() {
  const { reduced } = useMotionCtx();
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  // Track the chart box itself and finish the draw while it is still fully on
  // screen (by the time its center passes ~55% of the viewport), so the line
  // never exits half-drawn.
  const { scrollYProgress } = useScroll({ target: chartRef, offset: ["start 0.92", "center 0.55"] });
  const pathLength = useTransform(scrollYProgress, [0, 1], [0, 1]);

  const { pts, final } = useMemo(buildSeries, []);
  const d = useMemo(
    () => pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "),
    [pts],
  );
  const byYear = useMemo(() => new Map(pts.map((p) => [p.year, p])), [pts]);
  const last = pts[pts.length - 1];

  return (
    <section ref={ref} className="border-t border-hairline px-5 py-20 sm:px-10 lg:px-16" aria-labelledby="market-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-secondary">003 — The House Ledger</p>
          <h2 id="market-heading" className="display-caps mt-3 text-3xl text-ink sm:text-5xl">
            69 years. Every crash. Still up.
          </h2>
        </div>
        <p className="max-w-sm font-body text-sm leading-relaxed text-ink-dim">
          The same S&P 500 history that runs every LifePatch market year, drawn as one line.
          Log scale, because compounding is not polite.
        </p>
      </div>

      <div ref={chartRef} className="mt-10 border border-hairline bg-bg2 p-3 sm:p-5">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
          aria-label={`$${START_STAKE} invested in the S&P 500 in ${FIRST_YEAR} grows to about $${Math.round(final).toLocaleString("en-US")} by ${LAST_YEAR}, log scale, with major crashes annotated`}>
          {/* horizontal ruled lines */}
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={PAD.left} x2={W - PAD.right} y1={PAD.top + f * (H - PAD.top - PAD.bottom)} y2={PAD.top + f * (H - PAD.top - PAD.bottom)}
              stroke="var(--color-hairline)" strokeWidth="1" strokeDasharray="1 5" />
          ))}

          {/* the line itself — scroll-drawn */}
          <motion.path
            d={d}
            fill="none"
            stroke="var(--color-ink)"
            strokeWidth="1.8"
            style={reduced ? { pathLength: 1 } : { pathLength }}
          />

          {/* event callouts */}
          {CALLOUT_YEARS.map((year, i) => {
            const p = byYear.get(year);
            const ev = macroEvent(year);
            if (!p || !ev) return null;
            const pct = sp500Return(year);
            const up = pct >= 0;
            const above = i % 2 === 0;
            const ly = above ? Math.max(14, p.y - 64) : Math.min(H - 40, p.y + 34);
            return (
              <motion.g
                key={year}
                initial={reduced ? false : { opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: DUR.slow, ease: EASE, delay: reduced ? 0 : i * 0.08 }}
              >
                <line x1={p.x} y1={p.y} x2={p.x} y2={above ? ly + 26 : ly - 4}
                  stroke="var(--color-dotted)" strokeWidth="1" strokeDasharray="1 4" />
                <circle cx={p.x} cy={p.y} r="3" fill={up ? "var(--color-gain)" : "var(--color-loss)"} />
                <text x={p.x} y={ly} textAnchor="middle" className="num"
                  fill="var(--color-secondary)" fontSize="10" style={{ letterSpacing: "0.16em" }}>
                  {year}
                </text>
                <text x={p.x} y={ly + 13} textAnchor="middle"
                  fill="var(--color-ink)" fontSize="11" fontFamily="var(--font-mono)">
                  {ev.title.toUpperCase()}
                </text>
                <text x={p.x} y={ly + 26} textAnchor="middle" className="num"
                  fill={up ? "var(--color-gain)" : "var(--color-loss)"} fontSize="10">
                  {up ? "+" : "−"}{Math.abs(pct).toFixed(1)}%
                </text>
              </motion.g>
            );
          })}

          {/* terminal value tag */}
          <motion.g
            initial={reduced ? false : { opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: DUR.slow, ease: EASE, delay: reduced ? 0 : 0.5 }}
          >
            <circle cx={last.x} cy={last.y} r="3.5" fill="var(--color-ink)" />
            <text x={last.x + 8} y={last.y + 4} fill="var(--color-ink)" fontSize="12" fontFamily="var(--font-mono)">
              {LAST_YEAR}
            </text>
          </motion.g>
        </svg>
      </div>

      {/* the money shot */}
      <div className="mt-8 grid gap-px border border-hairline bg-hairline sm:grid-cols-3">
        <div className="bg-bg p-5 sm:p-6">
          <p className="eyebrow text-secondary">Stake · {FIRST_YEAR}</p>
          <p className="font-anton mt-2 text-4xl text-ink sm:text-5xl">${START_STAKE}</p>
        </div>
        <div className="bg-bg p-5 sm:p-6">
          <p className="eyebrow text-secondary">Crashes survived</p>
          <p className="font-anton mt-2 text-4xl text-loss sm:text-5xl">
            <NumberTicker value={CALLOUT_YEARS.length} />
          </p>
        </div>
        <div className="bg-bg p-5 sm:p-6">
          <p className="eyebrow text-secondary">Worth · {LAST_YEAR}</p>
          <p className="font-anton mt-2 text-4xl text-gain sm:text-5xl">
            <NumberTicker value={Math.round(final)} prefix="$" durationMs={1600} />
          </p>
        </div>
      </div>

      <p className="mt-4 font-body text-xs italic text-ink-dim">
        S&P 500 annual total returns {FIRST_YEAR}–{LAST_YEAR} as curated in the game&apos;s Almanac — approximate,
        dividends reinvested, no fees, no taxes, no panic-selling. The last one is the hard part.
      </p>
    </section>
  );
}
