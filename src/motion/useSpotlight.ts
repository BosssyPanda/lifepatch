"use client";

import { useCallback, useEffect, useRef } from "react";
import { useMotionCtx } from "./MotionProvider";

/**
 * Pointer spotlight (DESIGN.md amendment D) — writes `--spot-x` / `--spot-y` on the host
 * element so the `.spotlight` CSS wash can follow the cursor.
 *
 * Writes go straight to the style attribute inside one rAF per frame: no React state, so a
 * card carrying this never re-renders on pointer move. Disabled entirely for coarse pointers
 * (nothing to follow) and for reduced motion — in both cases the CSS also hides the layer, so
 * the wash can never be left frozen mid-card.
 *
 * Usage:
 *   const spot = useSpotlight<HTMLButtonElement>();
 *   <button ref={spot.ref} onPointerMove={spot.onPointerMove} className="spotlight …">
 */
/**
 * The same wash, for cards rendered in a `.map()` — where one hook per card is impossible.
 * Call it once in the parent and spread the handler onto every card: the coordinates are
 * written to whichever element the pointer is actually over (`e.currentTarget`), and only one
 * card can be under the cursor at a time, so a single shared rAF covers the whole grid.
 */
export function useSpotlightHandler<T extends HTMLElement = HTMLElement>() {
  const { reduced } = useMotionCtx();
  const enabled = useRef(false);
  const raf = useRef(0);
  const next = useRef<{ el: T; x: number; y: number } | null>(null);

  useEffect(() => {
    enabled.current =
      !reduced &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(hover: hover) and (pointer: fine)").matches === true;
  }, [reduced]);

  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    },
    [],
  );

  return useCallback((e: React.PointerEvent<T>) => {
    if (!enabled.current || e.pointerType !== "mouse") return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    next.current = { el, x: e.clientX - r.left, y: e.clientY - r.top };
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const p = next.current;
      if (!p) return;
      p.el.style.setProperty("--spot-x", `${p.x}px`);
      p.el.style.setProperty("--spot-y", `${p.y}px`);
    });
  }, []);
}

export function useSpotlight<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const { reduced } = useMotionCtx();
  const enabled = useRef(false);
  const raf = useRef(0);
  const next = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    enabled.current =
      !reduced &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(hover: hover) and (pointer: fine)").matches === true;
  }, [reduced]);

  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    },
    [],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<T>) => {
    if (!enabled.current || e.pointerType !== "mouse") return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    next.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const p = next.current;
      if (!p || !ref.current) return;
      ref.current.style.setProperty("--spot-x", `${p.x}px`);
      ref.current.style.setProperty("--spot-y", `${p.y}px`);
    });
  }, []);

  return { ref, onPointerMove };
}
