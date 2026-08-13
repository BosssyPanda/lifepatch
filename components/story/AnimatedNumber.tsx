"use client";

import { animate, useMotionValue, useMotionValueEvent } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { EASE } from "@/src/motion/tokens";

/**
 * Count-up/down tween between value changes.
 *
 * This used to `setState` on every rAF frame, which re-rendered whatever tree it sat
 * in — and it sits in a lot of them at once (the Leaderboard mounts up to 25, the
 * Financial Statement 20+, and the year HUD keeps two live above a *sticky* header).
 * The tween now drives a MotionValue and writes the formatted string straight to the
 * span's `textContent`: one text write per frame and ZERO React renders during the
 * count. React re-renders exactly once per tween — when it settles — and the value it
 * renders is the one the DOM already holds, so the two never disagree.
 *
 * It renders a `<span>` (it used to be a bare fragment) because the writer needs a
 * node to own. The span is inline and carries no styling of its own, so it inherits
 * the caller's `.num` / `.figure` / colour context exactly as the loose text did.
 */
export function AnimatedNumber({
  value,
  format,
  duration = 700,
}: {
  value: number;
  format: (n: number) => string;
  duration?: number;
}) {
  // One source of truth for reduced motion (MotionProvider holds the server value through
  // first paint) instead of a second, hydration-racing matchMedia read per instance.
  const { reduced } = useMotionCtx();
  const ref = useRef<HTMLSpanElement>(null);
  const mv = useMotionValue(value);
  /** The last *settled* figure — the only thing React ever renders. */
  const [settled, setSettled] = useState(value);
  // `format` is an inline arrow at most call sites; read it through a ref so a new
  // identity on every render can never restart a running tween.
  const formatRef = useRef(format);
  formatRef.current = format;

  const write = useCallback((n: number) => {
    const el = ref.current;
    if (el) el.textContent = formatRef.current(n);
  }, []);

  useMotionValueEvent(mv, "change", write);

  useEffect(() => {
    if (mv.get() === value) return;

    if (reduced) {
      mv.jump(value);
      write(value);
      setSettled(value);
      return;
    }

    // React just re-rendered the *settled* text into this node; put the live figure
    // back before the tween's first frame so an interrupted count doesn't flicker.
    write(mv.get());
    const controls = animate(mv, value, {
      duration: duration / 1000,
      ease: EASE,
      onComplete: () => setSettled(value),
    });
    return () => controls.stop();
  }, [value, duration, reduced, mv, write]);

  return <span ref={ref}>{format(settled)}</span>;
}
