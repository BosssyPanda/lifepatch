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
  /** House exit speed — an exit runs ~30% faster than the enter it reverses. */
  exitFast: 0.24,
} as const;

/** Per-item stagger / delay steps (seconds). `list` = staggerChildren default. */
export const STAGGER = {
  tight: 0.05,
  base: 0.07,
  loose: 0.12,
  list: 0.06,
} as const;

/**
 * How many items may actually stagger. Past roughly a dozen the effect stops
 * reading as choreography and starts reading as a slow page: the last rows of a
 * 20-row statement arrive seconds after the first, and the user has already
 * looked at them. Cap the ramp and let the tail arrive together — the sequence
 * then always finishes inside ~800ms.
 */
export const STAGGER_CAP = 12;

/** Stagger delay for item `i`, flattened past `STAGGER_CAP`. */
export function stepDelay(i: number, step: number, cap: number = STAGGER_CAP): number {
  return Math.min(i, cap) * step;
}

/**
 * The house springs (framer-motion `Transition` spring shape).
 *
 * `pop`/`soft` are the original stiffness/damping pair. The three added below are spelled in
 * `visualDuration` + `bounce` instead — the perceptual parameterization, so "how long it looks
 * like it takes" stays fixed no matter what travel distance a surface gives it:
 *   press  — a control acknowledging a tap: fast, zero overshoot.
 *   lift   — hover/settle: gentle overshoot, still calm.
 *   reward — a payoff landing: the only spring allowed to be springy.
 */
export const SPRING = {
  pop: { type: "spring", stiffness: 220, damping: 20 },
  soft: { type: "spring", stiffness: 150, damping: 18 },
  press: { type: "spring", visualDuration: 0.18, bounce: 0 },
  lift: { type: "spring", visualDuration: 0.25, bounce: 0.15 },
  reward: { type: "spring", visualDuration: 0.35, bounce: 0.45 },
} as const;

/** Travel distances (px) for screen/element wipes. */
export const SHIFT = { wipe: 16 } as const;

/**
 * Hit-stop (seconds) — the beat of held stillness before an impact's follow-through.
 * Game-feel literature puts the readable window at 50–100ms; the house uses 80ms.
 */
export const HITSTOP = 0.08;
