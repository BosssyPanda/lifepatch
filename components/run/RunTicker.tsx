"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useMatchCtx } from "@/hooks/useMatch";
import { currency } from "@/lib/format";
import { macroEvent, sp500Return } from "@/lib/markets";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import type { RunState } from "@/lib/runEngine";

/**
 * Ambient in-run ticker (Addendum A §8.1) — a thin, hairline-bounded mono strip
 * under the HUD. Spoiler-safe: it only shows YEARS ALREADY LIVED (run.history) —
 * never the in-progress year, whose market hasn't been revealed. A young run is
 * seeded with real pre-start history from lib/markets. Quiet by design (§1.2):
 * slower + dimmer than the title ticker. One translateX loop (compositor only),
 * paused while off-screen (IntersectionObserver); static under reduced motion.
 */

type Tick = { label: string; value?: string; up?: boolean };

const PRESEED_YEARS = 8;

/**
 * How a year is named on the strip.
 *
 * A match run may not print calendar years (`lib/modes.ts`: the real start/end
 * years are the end report's reveal, and in a room they would also hand one
 * player the shape of the world before another gets there). The same figures are
 * labelled by the run's OWN clock instead — `Y07`, and `−3Y` for the seeded years
 * that came before it. Solo keeps its calendar dates exactly as they were.
 */
function yearLabel(year: number, startYear: number, relative: boolean): string {
  if (!relative) return String(year);
  const rel = year - startYear + 1;
  return rel > 0 ? `Y${String(rel).padStart(2, "0")}` : `−${startYear - year}Y`;
}

function buildTicks(run: RunState, relative: boolean): Tick[] {
  const ticks: Tick[] = [];
  const label = (y: number) => yearLabel(y, run.startYear, relative);
  if (run.history.length === 0) {
    // Year 1: real context from the years just before the run started.
    for (let y = run.startYear - PRESEED_YEARS; y < run.startYear; y++) {
      const pct = sp500Return(y);
      ticks.push({ label: `S&P ${label(y)}`, value: `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`, up: pct >= 0 });
      const ev = macroEvent(y);
      if (ev) ticks.push({ label: `${label(y)} · ${ev.title.toUpperCase()}` });
    }
    return ticks;
  }
  for (const h of run.history) {
    ticks.push({ label: `S&P ${label(h.year)}`, value: `${h.indexReturn >= 0 ? "+" : "−"}${Math.abs(h.indexReturn).toFixed(1)}%`, up: h.indexReturn >= 0 });
    if (h.portfolioDelta !== 0) {
      ticks.push({ label: `YOUR BOOK ${label(h.year)}`, value: `${h.portfolioDelta >= 0 ? "+" : "−"}${currency(Math.abs(h.portfolioDelta))}`, up: h.portfolioDelta >= 0 });
    }
    const ev = macroEvent(h.year);
    if (ev) ticks.push({ label: `${label(h.year)} · ${ev.title.toUpperCase()}` });
  }
  return ticks;
}

function Row({ ticks }: { ticks: Tick[] }) {
  return (
    <div className="flex shrink-0 items-center gap-7 pr-7" aria-hidden>
      {ticks.map((t, i) => (
        <span key={`${t.label}-${i}`} className="flex items-baseline gap-1.5 whitespace-nowrap">
          <span className="eyebrow text-tertiary" style={{ fontSize: "0.54rem", letterSpacing: "0.16em" }}>{t.label}</span>
          {t.value && (
            <span className="num" style={{ fontSize: "0.6rem", color: t.up ? "var(--color-gain)" : "var(--color-loss)", opacity: 0.8 }}>
              {t.value}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

export function RunTicker({ run }: { run: RunState }) {
  const { reduced: reduce } = useMotionCtx();
  // null for a solo run, which is what keeps the solo strip byte-identical.
  const match = useMatchCtx();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(true);
  const ticks = buildTicks(run, match !== null);

  // pause the loop whenever the strip is scrolled out of view (§8.5: trivial ambient CPU)
  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (ticks.length === 0) return null;

  return (
    <div
      ref={hostRef}
      className="relative flex w-full items-center overflow-hidden border-b border-hairline bg-bg py-1.5"
      // A bare aria-label on a generic div is ignored by ARIA (and flagged by axe). The row
      // is one glanceable object whose text is duplicated to make the marquee loop, so it
      // gets the same role="img" + label treatment as SplitFlap: announced once, not walked.
      role="img"
      aria-label="Market history ticker"
    >
      {reduce ? (
        <div className="flex items-center gap-7 overflow-hidden px-3"><Row ticks={ticks} /></div>
      ) : (
        <motion.div
          className="flex w-max items-center"
          animate={visible ? { x: ["0%", "-50%"] } : undefined}
          transition={{ duration: 64, repeat: Infinity, ease: "linear" }}
        >
          <Row ticks={ticks} />
          <Row ticks={ticks} />
        </motion.div>
      )}
    </div>
  );
}
