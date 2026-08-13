"use client";

import { motion } from "framer-motion";
import { useState } from "react";

/**
 * Money-fall on a good verdict (Addendum A §13 extra #5). At most 20 flat
 * ink-colored bill rectangles fall once (≤1.5s) as the verdict lands — a dry,
 * printed-money flourish, NOT a particle field: fixed count, one shot, no loop,
 * transform/opacity only. Suppressed under reduced motion (parent gates it).
 *
 * `count` lets an impact size its own shower (`juiceTier().bills`) — it is read
 * once, at mount, and never re-read: the one-shot contract above is the point of
 * this component, and a count that could change mid-fall would break it.
 */

const BILL_COUNT = 18;
const FALL_S = 1.4;

type Bill = { left: number; delay: number; drift: number; spin: number; w: number };

function makeBills(n: number): Bill[] {
  return Array.from({ length: n }, (_, i) => ({
    left: (i * 100) / n + (Math.random() * 4 - 2),
    delay: Math.random() * 0.45,
    drift: Math.random() * 40 - 20,
    spin: Math.random() * 240 - 120,
    w: 22 + Math.random() * 14,
  }));
}

export function MoneyFall({ count = BILL_COUNT }: { count?: number }) {
  // positions fixed once per mount — a single deterministic shower, then done
  const [bills] = useState<Bill[]>(() => makeBills(Math.max(1, Math.round(count))));

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {bills.map((b, i) => (
        <motion.span
          key={i}
          className="absolute block border border-ink/70 bg-ink/15"
          style={{ left: `${b.left}%`, top: -24, width: b.w, height: b.w * 0.46 }}
          initial={{ y: -30, x: 0, rotate: 0, opacity: 0.9 }}
          animate={{ y: "110vh", x: b.drift, rotate: b.spin, opacity: [0.9, 0.9, 0.55] }}
          transition={{ duration: FALL_S, delay: b.delay, ease: [0.3, 0, 0.8, 1] }}
        >
          {/* the bill's face: a hairline inner rule — printed money, not confetti */}
          <span className="absolute inset-x-1 top-1/2 block h-px -translate-y-1/2 bg-ink/50" />
        </motion.span>
      ))}
    </div>
  );
}
