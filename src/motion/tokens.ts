/**
 * Motion tokens — the house scale, named once.
 *
 * These codify the durations / staggers / springs / travel that were already
 * hardcoded across ~15 components (see the Phase-C audit); nothing here is *new*
 * motion, it's the existing scale centralized so surfaces stop each spelling out
 * the same numbers. The house ease lives in `@/lib/motion` and is re-exported
 * here so `@/src/motion` is the single import surface (lib stays untouched).
 *
 * LEDGER law: only compositor-friendly properties get animated
 * (transform / opacity / clip-path / filter). Values are framer-motion seconds.
 */
export { EASE } from "@/lib/motion";

/** Transition durations (seconds). */
export const DUR = {
  instant: 0.18,
  fast: 0.34,
  base: 0.4,
  slow: 0.5,
  scene: 0.55,
} as const;

/** Per-item stagger / delay steps (seconds). `list` = staggerChildren default. */
export const STAGGER = {
  tight: 0.05,
  base: 0.07,
  loose: 0.12,
  list: 0.06,
} as const;

/** The two house springs (framer-motion `Transition` spring shape). */
export const SPRING = {
  pop: { type: "spring", stiffness: 220, damping: 20 },
  soft: { type: "spring", stiffness: 150, damping: 18 },
} as const;

/** Travel distances (px) for screen/element wipes. */
export const SHIFT = { wipe: 16 } as const;
