"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Resolve-to-final text scramble (Addendum A §6 / §13 #2). The target string
 * locks in left-to-right over `durationMs` while unresolved characters flicker
 * through a limited charset — digits, block glyphs, and `$ % + −`. Under reduced
 * motion it returns the final text immediately with no churn.
 *
 * The churn used to `setState` on every rAF frame, re-rendering the whole hero for
 * the length of the scramble. It writes `textContent` straight to a node now: attach
 * the returned `ref` to the element that should hold the text, and render `text` as
 * its children. `text` only ever changes twice (empty → resolved), so React renders
 * twice instead of ~50 times, and the node it renders is the one the DOM ends on.
 */
const SCRAMBLE_CHARS = "0123456789$%+-=/█▓▒░#";

export function useScramble(
  target: string,
  active: boolean,
  opts: { durationMs?: number; reduced?: boolean } = {},
): { ref: React.RefObject<HTMLElement | null>; text: string } {
  const durationMs = opts.durationMs ?? 900;
  const reduced = opts.reduced ?? false;
  const ref = useRef<HTMLElement | null>(null);
  const [text, setText] = useState(reduced ? target : "");
  const raf = useRef(0);

  const write = useCallback((s: string) => {
    const el = ref.current;
    if (el) el.textContent = s;
  }, []);

  useEffect(() => {
    if (!active) return;
    if (reduced) {
      write(target);
      setText(target);
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
      write(s);
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else setText(target); // settle: React's model and the DOM agree again
    };

    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [active, target, durationMs, reduced, write]);

  return { ref, text };
}
