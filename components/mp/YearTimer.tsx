"use client";

import { motion, useAnimationControls } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useAudio } from "@/hooks/useAudio";
import { useMatchCtx } from "@/hooks/useMatch";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { SPRING } from "@/src/motion/tokens";

/** How often the deadline is re-read. Well under a second, so a tick never looks late. */
const POLL_MS = 200;
/** Below this the year is visibly running out and the figure comes up to full ink. */
const URGENT_S = 10;
/** The resting weight of the clock: present, but not the loudest thing on the run. */
const RESTING_OPACITY = 0.72;
const RESTING_METER_OPACITY = 0.55;
/** The last seconds that make a sound — one `uitick` each, never a loop. */
const FOLEY_S = 3;

/**
 * The shared year clock, as the player sees it.
 *
 * The deadline itself comes from `useMatch` and is always anchored on the LOCAL
 * clock, so this only ever counts down what its own device believes. Outside a
 * running match (`deadlineAt === null`) it renders nothing at all, which is what
 * keeps the solo run screen byte-identical.
 *
 * The last ten seconds are marked by weight, not by hue: the figure and the meter
 * come up from a resting dim to full ink, and the figure pops once a second over
 * the final three. Colour is not available for this — orange marks identity and
 * what is live, never a state going bad (DESIGN.md § the accent budget), and red
 * and green in this game mean money and nothing else.
 */
export function YearTimer() {
  const match = useMatchCtx();
  const { sfx } = useAudio();
  const { reduced } = useMotionCtx();
  const pop = useAnimationControls();
  const [left, setLeft] = useState<number | null>(null);
  /** The last second that already made its sound, so a re-render can't double it. */
  const tickedRef = useRef(-1);

  const deadlineAt = match?.deadlineAt ?? null;
  const total = match?.config?.yearSeconds ?? null;

  useEffect(() => {
    tickedRef.current = -1;
    if (deadlineAt === null) {
      setLeft(null);
      return;
    }
    const read = () => Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
    setLeft(read());
    // `setLeft` with an unchanged number bails out of the render, so this polls four
    // times a second and re-renders once — the count is what changes, not the clock.
    const id = window.setInterval(() => setLeft(read()), POLL_MS);
    return () => window.clearInterval(id);
  }, [deadlineAt]);

  useEffect(() => {
    if (left === null || left <= 0 || left > FOLEY_S) return;
    if (tickedRef.current === left) return;
    tickedRef.current = left;
    sfx("uitick");
    if (reduced) return;
    void pop
      .start({ scale: 1.14 }, SPRING.press)
      .then(() => pop.start({ scale: 1 }, SPRING.lift))
      .catch(() => {});
  }, [left, reduced, pop, sfx]);

  if (left === null || total === null) return null;

  const urgent = left <= URGENT_S;
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;

  return (
    <div role="timer" aria-label="Time left in this year" className="w-full">
      <div className="flex items-baseline justify-between gap-3">
        <span className="eyebrow text-secondary" style={{ fontSize: "0.58rem" }}>
          Year ends in
        </span>
        <motion.span
          aria-hidden
          animate={pop}
          className="num inline-block text-xl leading-none text-ink transition-opacity duration-300"
          style={{ opacity: urgent ? 1 : RESTING_OPACITY }}
        >
          {clock}
        </motion.span>
      </div>
      {/* A fixed track with a scaling fill: the meter moves every second, and `scaleX`
          from the left edge is the same picture without a layout pass. */}
      <div className="mt-1.5 h-1 overflow-hidden bg-hairline">
        <motion.div
          className="h-full w-full origin-left bg-ink transition-opacity duration-300"
          style={{ opacity: urgent ? 1 : RESTING_METER_OPACITY }}
          initial={false}
          animate={{ scaleX: Math.max(0, Math.min(1, left / total)) }}
          // One second, linear — the figure steps once a second and the bar walks the
          // gap between steps, so the meter reads continuous instead of ratcheting.
          transition={reduced ? { duration: 0 } : { duration: 1, ease: "linear" }}
        />
      </div>
      {/* The digits are aria-hidden — a per-second live region would read the whole
          year out loud. Only the two thresholds a player actually needs are spoken. */}
      <span className="sr-only" aria-live="polite">
        {left === 10 || left === 5 ? `${left} seconds left in this year` : ""}
      </span>
    </div>
  );
}
