"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Resolve-to-final text scramble (Addendum A §6 / §13 #2). The target string
 * locks in left-to-right over `durationMs` while unresolved characters flicker
 * through a limited charset — digits, block glyphs, and `$ % + −`. Compositor-safe
 * (it only swaps textContent). Under reduced motion it returns the final text
 * immediately with no churn.
 *
 * Returns the string to render. Drive `active` from the sequence timeline.
 */
const SCRAMBLE_CHARS = "0123456789$%+-=/█▓▒░#";

export function useScramble(
  target: string,
  active: boolean,
  opts: { durationMs?: number; reduced?: boolean } = {},
): string {
  const durationMs = opts.durationMs ?? 900;
  const reduced = opts.reduced ?? false;
  const [out, setOut] = useState(reduced ? target : "");
  const raf = useRef(0);

  useEffect(() => {
    if (!active) return;
    if (reduced) {
      setOut(target);
      return;
    }
    const n = target.length;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const locked = t * n; // characters resolved so far, left-to-right
      let s = "";
      for (let i = 0; i < n; i++) {
        const ch = target[i];
        if (ch === " " || i < locked) {
          s += ch;
        } else {
          s += SCRAMBLE_CHARS[(Math.random() * SCRAMBLE_CHARS.length) | 0];
        }
      }
      setOut(s);
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else setOut(target);
    };

    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [active, target, durationMs, reduced]);

  return out;
}
