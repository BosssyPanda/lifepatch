"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reveal-on-scroll without IntersectionObserver (which is unreliable under Lenis /
 * background tabs). Polls the element's rect via rAF until it enters the viewport,
 * then stops. Honors prefers-reduced-motion (reveals immediately).
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(threshold = 0.85) {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(true);
      return;
    }
    let raf = 0;
    const check = () => {
      const el = ref.current;
      if (!el) {
        raf = requestAnimationFrame(check);
        return;
      }
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      if (r.top < vh * threshold && r.bottom > 0) {
        setVisible(true);
        return;
      }
      raf = requestAnimationFrame(check);
    };
    raf = requestAnimationFrame(check);
    return () => cancelAnimationFrame(raf);
  }, [visible, threshold]);

  return { ref, visible };
}
