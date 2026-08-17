"use client";

import { motion } from "framer-motion";
import { EASE } from "@/src/motion/tokens";

/**
 * Net-worth line that draws left-to-right; `tall` = the full-bleed scene-4 cut.
 * Drawn via a clip-path reveal (not framer pathLength — its dasharray trick
 * fragments the stroke under preserveAspectRatio="none").
 */
export function NetWorthDraw({ values, draw, reduced, tall = false }: { values: number[]; draw: boolean; reduced: boolean; tall?: boolean }) {
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 28 - ((v - min) / range) * 26;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const zeroY = 28 - ((0 - min) / range) * 26;
  const up = values[values.length - 1] >= (values[0] ?? 0);
  const shown = reduced || draw;
  return (
    <div className={`relative w-full ${tall ? "h-[46svh]" : "h-16"}`} aria-hidden>
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <line x1="0" y1={zeroY} x2="100" y2={zeroY} stroke="var(--color-ink-dim)" strokeWidth="0.3" strokeDasharray="1 1" opacity="0.5" />
      </svg>
      <motion.div
        className="absolute inset-0"
        initial={reduced ? false : { clipPath: "inset(0 100% 0 0)" }}
        animate={{ clipPath: shown ? "inset(0 0% 0 0)" : "inset(0 100% 0 0)" }}
        transition={{ duration: reduced ? 0 : tall ? 1.6 : 0.9, ease: EASE }}
      >
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-full w-full">
          <polyline
            points={pts.join(" ")}
            fill="none"
            stroke={up ? "#2bd576" : "#ff3b30"}
            strokeWidth={tall ? 1.6 : 0.9}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </motion.div>
    </div>
  );
}
