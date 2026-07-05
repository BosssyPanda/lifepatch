"use client";

import { motion } from "framer-motion";

/**
 * YearFlap — a digit split-flap on the verdict board's exact visual grammar
 * (hairline cells, bg2 plates, mid seam, ~90ms rotateX flip) but for numerals,
 * built for the outro's year replay (CINEMA Phase Q). SplitFlap itself stays
 * letters-only — widening its glyph set would change the verdict aesthetics.
 * Every value change flips all cells once (Solari clack handled by the parent's
 * pacing, not per-cell audio — years can pass at ~90ms).
 */
export function YearFlap({
  value,
  reduced,
  className = "",
}: {
  value: number;
  reduced: boolean;
  className?: string;
}) {
  const digits = String(value).split("");
  return (
    <span className={`inline-flex gap-[0.06em] ${className}`} aria-hidden>
      {digits.map((d, i) => (
        <span
          key={i}
          className="relative inline-flex items-center justify-center overflow-hidden border border-hairline bg-bg2"
          style={{ width: "0.86em", height: "1.2em", perspective: "220px" }}
        >
          <span className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-px -translate-y-1/2 bg-bg" />
          <motion.span
            key={`${i}-${value}`}
            initial={reduced ? false : { rotateX: -88, opacity: 0.5 }}
            animate={{ rotateX: 0, opacity: 1 }}
            transition={{ duration: 0.09, ease: "easeOut" }}
            className="font-anton leading-none text-ink"
            style={{ transformOrigin: "center" }}
          >
            {d}
          </motion.span>
        </span>
      ))}
    </span>
  );
}
