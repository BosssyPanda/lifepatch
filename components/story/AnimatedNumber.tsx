"use client";

import { useEffect, useRef, useState } from "react";
import { useMotionCtx } from "@/src/motion/MotionProvider";

/** Count-up/down tween between value changes. */
export function AnimatedNumber({
  value,
  format,
  duration = 700,
}: {
  value: number;
  format: (n: number) => string;
  duration?: number;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);
  // One source of truth for reduced motion (MotionProvider holds the server value through
  // first paint) instead of a second, hydration-racing matchMedia read per instance.
  const { reduced } = useMotionCtx();

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;

    if (reduced) {
      fromRef.current = to;
      setDisplay(to);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (to - from) * eased;
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
        setDisplay(to);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = to;
    };
  }, [value, duration, reduced]);

  return <>{format(display)}</>;
}
