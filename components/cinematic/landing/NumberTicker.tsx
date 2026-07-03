"use client";

import { useEffect, useRef, useState } from "react";
import { useMotionCtx } from "@/src/motion/MotionProvider";

/**
 * LEDGER number ticker — counts up (rAF, ease-out) the first time it scrolls
 * into view. Tabular numerals; static final value under reduced motion.
 * Compositor-free by design: text swaps only, no layout animation.
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
  const [display, setDisplay] = useState(reduced ? value : 0);
  const started = useRef(false);

  useEffect(() => {
    if (reduced) { setDisplay(value); return; }
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || started.current) return;
      started.current = true;
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / durationMs);
        const eased = 1 - Math.pow(1 - p, 3);
        setDisplay(value * eased);
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      io.disconnect();
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [value, durationMs, reduced]);

  const text = display.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

  return (
    <span ref={ref} className={`num ${className}`} aria-label={`${prefix}${value.toLocaleString("en-US")}${suffix}`}>
      {prefix}{text}{suffix}
    </span>
  );
}
