"use client";

import { motion } from "framer-motion";
import { useState } from "react";

/**
 * AshFall — MoneyFall's dark twin (CINEMA Phase Q). On a loss beat the bills
 * fall as ash: darker tones, slower drift, a touch more of them. Same
 * contract as MoneyFall: fixed count, one shot, transform/opacity only, no
 * loop; the parent gates it away under reduced motion and on skip.
 */

const ASH_COUNT = 26;
const FALL_S = 2.2;

type Flake = { left: number; delay: number; drift: number; spin: number; w: number; dim: boolean };

function makeFlakes(): Flake[] {
  return Array.from({ length: ASH_COUNT }, (_, i) => ({
    left: (i * 100) / ASH_COUNT + (Math.random() * 4 - 2),
    delay: Math.random() * 0.8,
    drift: Math.random() * 70 - 35,
    spin: Math.random() * 320 - 160,
    w: 16 + Math.random() * 14,
    dim: Math.random() > 0.5,
  }));
}

export function AshFall() {
  // positions fixed once per mount — a single deterministic fall, then done
  const [flakes] = useState<Flake[]>(makeFlakes);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {flakes.map((f, i) => (
        <motion.span
          key={i}
          className={`absolute block border ${f.dim ? "border-hairline bg-bg3" : "border-tertiary/60 bg-bg2"}`}
          style={{ left: `${f.left}%`, top: -20, width: f.w, height: f.w * 0.46 }}
          initial={{ y: -26, x: 0, rotate: 0, opacity: 0.85 }}
          animate={{ y: "112vh", x: f.drift, rotate: f.spin, opacity: [0.85, 0.7, 0.3] }}
          transition={{ duration: FALL_S, delay: f.delay, ease: [0.35, 0, 0.85, 1] }}
        >
          <span className="absolute inset-x-1 top-1/2 block h-px -translate-y-1/2 bg-tertiary/40" />
        </motion.span>
      ))}
    </div>
  );
}
