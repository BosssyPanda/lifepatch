/**
 * Screen-transition wipes for the AppShell phase switch (Addendum A §5.2).
 *
 * Two LEDGER-native candidates — the director picks one, the other is deleted:
 *   • paper-feed     — the statement is fed through the printer: the outgoing
 *                      screen clips away upward while the incoming one prints in
 *                      top-down (clip-path inset). Compositor-only.
 *   • terminal-flicker — a two-frame ink flash: the incoming screen resolves
 *                      through a brief invert pulse (opacity + filter). Compositor-only.
 *
 * Both collapse to a plain fade under reduced motion. Only transform / opacity /
 * clip-path / filter are touched, so there is no layout work and CLS stays 0.
 * Shapes match what `motion.div` spreads: `{ initial, animate, exit, transition }`.
 */
import type { MotionProps } from "framer-motion";
import { DUR, EASE } from "./tokens";

export type TransitionKind = "paper" | "flicker";

// Exactly the props a `motion.div` receives when a wipe is spread onto it, so the
// spread is provably assignable (and avoids framer's over-wide union blowing up TS).
export type Wipe = Pick<MotionProps, "initial" | "animate" | "exit" | "transition">;

const fade: Wipe = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: DUR.instant },
};

const paperFeed: Wipe = {
  // incoming prints in from the top; outgoing is fed up and out of the head.
  initial: { opacity: 0, clipPath: "inset(0 0 100% 0)" },
  animate: { opacity: 1, clipPath: "inset(0 0 0% 0)" },
  exit: { opacity: 0, clipPath: "inset(100% 0 0 0)" },
  transition: { duration: DUR.slow, ease: EASE },
};

const terminalFlicker: Wipe = {
  // resolve through two ink frames: a hard invert flash, then settle.
  initial: { opacity: 0, filter: "invert(1)" },
  animate: { opacity: [0, 1, 0.55, 1], filter: ["invert(1)", "invert(0)", "invert(0)", "invert(0)"] },
  exit: { opacity: [1, 0.35, 0] },
  transition: { duration: DUR.fast, ease: "linear", times: [0, 0.25, 0.5, 1] },
};

/** Pick the wipe for a kind, collapsing to a fade under reduced motion. */
export function wipeFor(kind: TransitionKind, reduced: boolean): Wipe {
  if (reduced) return fade;
  return kind === "flicker" ? terminalFlicker : paperFeed;
}
