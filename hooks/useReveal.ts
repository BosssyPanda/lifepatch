"use client";

import { useEffect, useRef, useState } from "react";
import { useMotionCtx } from "@/src/motion/MotionProvider";

/** Nothing may stay invisible longer than this, whatever the observer thinks. */
const FALLBACK_MS = 2500;

/**
 * Reveal-on-scroll. One IntersectionObserver per element, disconnected the moment it fires
 * (`once` semantics), instead of the old rAF rect-poll that ran a `getBoundingClientRect` on
 * every frame for every unrevealed element on the page.
 *
 * `threshold` keeps its original meaning — the fraction of the viewport an element has to
 * reach — expressed as a negative bottom `rootMargin`, so 0.85 still means "reveal once the
 * top edge crosses 85% of the viewport height".
 *
 * The 2.5s fallback is not belt-and-braces: life-event cards render inside a Lenis-scrolled
 * container, and any layout the observer never gets a callback for (hidden tab on mount,
 * zero-height parent at observe time, a missed scroll frame) would leave a card at opacity 0
 * with no way for the player to recover it. Time-out and show it.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(threshold = 0.85) {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  const { reduced } = useMotionCtx();

  useEffect(() => {
    if (visible) return;
    if (reduced) {
      setVisible(true);
      return;
    }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), FALLBACK_MS);
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setVisible(true);
        io.disconnect();
      },
      { rootMargin: `0px 0px -${Math.round((1 - threshold) * 100)}% 0px`, threshold: 0 },
    );
    io.observe(el);
    return () => {
      window.clearTimeout(timer);
      io.disconnect();
    };
  }, [visible, threshold, reduced]);

  return { ref, visible };
}
