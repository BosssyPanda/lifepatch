"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { currency } from "@/lib/format";
import type { YearRecord } from "@/lib/runEngine";
import { YEARS_FLIP_MS, YEARS_HOLD_MS } from "@/lib/cinematic";
import { MS_PER_BEAT } from "@/src/audio/tempo";
import { YearFlap } from "../film/YearFlap";

/** The digit cadence's grid unit — one 16th of the score's beat. */
const SIXTEENTH_MS = MS_PER_BEAT / 4;

/** Scene 2 — the giant year counter: flips every lived year, holds on milestones. */
export function YearsScene({ hist, milestones, totalMs }: { hist: YearRecord[]; milestones: Map<number, string>; totalMs: number }) {
  const [idx, setIdx] = useState(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const holds = hist.map((h) => (milestones.has(h.year) ? YEARS_HOLD_MS + YEARS_FLIP_MS : YEARS_FLIP_MS));
    const raw = holds.reduce((a, b) => a + b, 0) || 1;
    const scale = totalMs / raw;
    // The atoms are already 16ths (1 per year, 4 on a milestone), so an
    // unscaled replay is on the grid for free. When the scene has to stretch or
    // squeeze to fit its slot, snap the CUMULATIVE offset — never the step — so
    // rounding can't accumulate into drift. Below one 16th per year the replay
    // is a blur and quantizing it would only cost years their own frame, so
    // that path keeps the plain scaled ladder.
    const onGrid = YEARS_FLIP_MS * scale >= SIXTEENTH_MS;
    let acc = 0;
    let prev = 0;
    hist.forEach((_, i) => {
      if (i === 0) return;
      acc += holds[i - 1] * scale;
      const t = onGrid ? Math.round(acc / SIXTEENTH_MS) * SIXTEENTH_MS : acc;
      prev = Math.max(prev + 1, t);
      const idx = i;
      timers.current.push(window.setTimeout(() => setIdx(idx), prev));
    });
    return () => { timers.current.forEach(clearTimeout); timers.current = []; };
    // one-shot replay
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const h = hist[idx];
  const caption = milestones.get(h.year);
  const delta = h.portfolioDelta;

  return (
    <div className="flex flex-col items-center text-center">
      <YearFlap value={h.year} reduced={false} className="text-[15vw] sm:text-[8rem]" />
      <span
        key={h.year}
        className="num mt-5 text-lg sm:text-2xl"
        style={{ color: delta >= 0 ? "var(--color-gain)" : "var(--color-loss)" }}
      >
        {delta >= 0 ? "+" : "−"}{currency(Math.abs(delta))}
      </span>
      <div className="mt-3 flex min-h-[1.4rem] items-center justify-center">
        <AnimatePresence mode="wait">
          {caption && (
            <motion.p
              key={caption}
              initial={{ opacity: 0, scale: 1.2 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="eyebrow text-ink"
              style={{ fontSize: "0.62rem", letterSpacing: "0.22em" }}
            >
              {caption}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      <span className="num absolute right-6 top-8 text-[0.7rem] text-secondary" style={{ letterSpacing: "0.18em" }}>
        AGE {h.age}
      </span>
    </div>
  );
}
