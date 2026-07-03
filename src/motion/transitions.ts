/**
 * Screen-transition wipe for the AppShell phase switch (Addendum A §5.2).
 *
 * Paper-feed — the statement is fed through the printer: the outgoing screen
 * clips away upward while the incoming one prints in top-down (clip-path inset).
 * Compositor-only. Director's pick from the Phase C A/B; the terminal-flicker
 * candidate was deleted with the pick.
 *
 * Collapses to a plain fade under reduced motion. Only transform / opacity /
 * clip-path are touched, so there is no layout work and CLS stays 0. Shapes
 * match what `motion.div` spreads: `{ initial, animate, exit, transition }`.
 */
import type { MotionProps } from "framer-motion";
import { DUR, EASE } from "./tokens";

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

/** The app wipe, collapsing to a fade under reduced motion. */
export function wipeFor(reduced: boolean): Wipe {
  return reduced ? fade : paperFeed;
}
