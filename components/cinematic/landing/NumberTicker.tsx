"use client";

import { animate, useMotionValue, useMotionValueEvent } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { EASE } from "@/src/motion/tokens";

/**
 * LEDGER number ticker — counts up (ease-out) the first time it scrolls into view.
 * Tabular numerals; static final value under reduced motion.
 *
 * The count used to `setState` every rAF frame. It drives a MotionValue and writes
 * `textContent` directly now, so the surrounding section (a landing set piece, or a
 * Leaderboard row among 25) never re-renders during the tween — React only sees the
 * settled figure. Text swaps only: still no layout animation anywhere in here.
 */
export function NumberTicker({
  value,
  prefix = "",
  suffix = "",
  durationMs = 1100,
  fractionDigits = 0,
  className = "",
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  durationMs?: number;
  fractionDigits?: number;
  className?: string;
}) {
  const { reduced } = useMotionCtx();
  const ref = useRef<HTMLSpanElement>(null);
  const mv = useMotionValue(reduced ? value : 0);
  /** The last settled figure — the only thing React renders. */
  const [settled, setSettled] = useState(reduced ? value : 0);
  const started = useRef(false);

  const digits = useRef(fractionDigits);
  digits.current = fractionDigits;
  const fmt = useCallback(
    (n: number) =>
      n.toLocaleString("en-US", {
        minimumFractionDigits: digits.current,
        maximumFractionDigits: digits.current,
      }),
    [],
  );

  useMotionValueEvent(mv, "change", (n) => {
    const el = ref.current;
    if (el) el.textContent = `${prefix}${fmt(n)}${suffix}`;
  });

  useEffect(() => {
    if (reduced) {
      mv.jump(value);
      setSettled(value);
      return;
    }
    const el = ref.current;
    if (!el) return;
    let controls: { stop: () => void } | null = null;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || started.current) return;
      started.current = true;
      io.disconnect();
      controls = animate(mv, value, {
        duration: durationMs / 1000,
        ease: EASE,
        onComplete: () => setSettled(value),
      });
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); controls?.stop(); };
  }, [value, durationMs, reduced, mv]);

  return (
    <span ref={ref} className={`num ${className}`} aria-label={`${prefix}${value.toLocaleString("en-US")}${suffix}`}>
      {prefix}{fmt(settled)}{suffix}
    </span>
  );
}
