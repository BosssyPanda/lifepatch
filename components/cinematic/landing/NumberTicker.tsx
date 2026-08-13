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
 *
 * Two separate effects on purpose. The reveal owns the first crossing into view and
 * must NOT depend on `value`, or a live control (CompoundToy's sliders) restarts the
 * count-up from $0 on every step. Once revealed, updates re-target the same
 * MotionValue at `updateMs` — `animate()` starts from wherever the value currently
 * is, so an interrupted drag continues instead of snapping. Routing updates through
 * the observer instead would cost a frame per step and drop tweens mid-drag.
 */
export function NumberTicker({
  value,
  prefix = "",
  suffix = "",
  durationMs = 1100,
  updateMs = 220,
  fractionDigits = 0,
  className = "",
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  /** Count-up length for the one-time reveal. */
  durationMs?: number;
  /** Re-target length after the reveal — short, or the figure lags a drag. */
  updateMs?: number;
  fractionDigits?: number;
  className?: string;
}) {
  const { reduced } = useMotionCtx();
  const ref = useRef<HTMLSpanElement>(null);
  const mv = useMotionValue(reduced ? value : 0);
  /** The last settled figure — the only thing React renders. */
  const [settled, setSettled] = useState(reduced ? value : 0);
  const started = useRef(false);
  /** Latest figure, so the reveal targets the current one however late it fires. */
  const valueRef = useRef(value);
  valueRef.current = value;
  const durationRef = useRef(durationMs);
  durationRef.current = durationMs;

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

  // ── reveal: fires once, the first time the figure scrolls into view ──
  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;
    let controls: { stop: () => void } | null = null;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || started.current) return;
      started.current = true;
      io.disconnect();
      const target = valueRef.current;
      controls = animate(mv, target, {
        duration: durationRef.current / 1000,
        ease: EASE,
        onComplete: () => setSettled(target),
      });
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); controls?.stop(); };
  }, [reduced, mv]);

  // ── updates: a live value changing after the reveal (sliders, toggles) ──
  useEffect(() => {
    if (reduced) {
      mv.jump(value);
      setSettled(value);
      return;
    }
    if (!started.current) return; // pre-reveal: the reveal owns the first count-up
    const controls = animate(mv, value, {
      duration: updateMs / 1000,
      ease: EASE,
      onComplete: () => setSettled(value),
    });
    return () => controls.stop();
  }, [value, updateMs, reduced, mv]);

  // `settled` only paints before the first MotionValue write (SSR/pre-reveal) and
  // after a remount: once the "change" handler has set textContent, React's three
  // text nodes are detached and later `settled` writes never reach the DOM. It is
  // still kept current so the reduced-motion and hydration paths stay truthful.
  // The aria-label derives from `value` directly, so it is always the live figure;
  // no aria-live here — announcing every drag step would flood a screen reader.
  return (
    <span ref={ref} className={`num ${className}`} aria-label={`${prefix}${value.toLocaleString("en-US")}${suffix}`}>
      {prefix}{fmt(settled)}{suffix}
    </span>
  );
}
