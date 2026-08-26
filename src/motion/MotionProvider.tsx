"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * MotionProvider — one home for cross-cutting motion behavior (Addendum A §5.3):
 *
 *  • reduced   — a single `prefers-reduced-motion` read, so every surface honors
 *                it from one source instead of each calling useReducedMotion().
 *  • register  — the global input-skip registry. While a ceremony is on screen it
 *                registers a "skip to final" handler; the provider listens for any
 *                pointerdown / keydown (capture phase, so it beats app handlers) and
 *                fires every registered handler. Consumers subscribe via useSkippable.
 *
 * A ceremony registers only while it is *animating* and unregisters when it reaches
 * its final state, so ambient input skips the animation but never advances past it —
 * advancing stays with explicit controls. This is the plumbing the later spectacle
 * phases (title, verdict) all plug into.
 */

type SkipFn = () => void;

/**
 * `prefers-reduced-motion`, read live — **for effects only**.
 *
 * The provider's `reduced` is deliberately gated behind `mounted` (see below: framer's
 * hook reads matchMedia synchronously on the client, so an ungated value mismatches the
 * server markup and throws React #418). The cost is that the value is FALSE for exactly
 * one render — and React runs a child's effects before the parent's, so any `[]`-pinned
 * effect that mounts in the provider's first commit closes over `false` and starts a
 * timeline the user asked not to see. `Intro` is that case, and it opens with a
 * full-frame ink invert.
 *
 * An effect never runs on the server, so it can ask the browser directly with no
 * hydration exposure at all. Rendering must keep using `reduced` from the context, or
 * the mismatch comes straight back.
 */
export function prefersReducedMotionNow(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type MotionCtxValue = {
  reduced: boolean;
  /** Register a skip-to-final handler; returns an unregister fn. */
  register: (fn: SkipFn) => () => void;
};

const MotionCtx = createContext<MotionCtxValue | null>(null);

export function MotionProvider({ children }: { children: React.ReactNode }) {
  // framer's useReducedMotion reads matchMedia synchronously on the client, so its
  // value flips during hydration (server: false, first client render: true) and any
  // SSR-visible markup that branches on it mismatches (React #418). Hold `reduced`
  // at the server value through the first paint and promote after mount — same gate
  // as Opening's sessionStorage promote and HudRail's clock.
  const prefersReduced = !!useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const reduced = mounted && prefersReduced;
  const skips = useRef<Set<SkipFn>>(new Set());

  const register = useCallback((fn: SkipFn) => {
    skips.current.add(fn);
    return () => {
      skips.current.delete(fn);
    };
  }, []);

  useEffect(() => {
    // "Any input skips the ceremony" must not mean "any input, including the controls the
    // ceremony itself puts on screen". Reaching for Mute during the cold open used to end the
    // film, because this listener runs in the capture phase and fires before the button's own
    // handler. Anything operable — or anything that opts out with data-no-skip — is exempt.
    const fromControl = (e: Event) => {
      const t = e.target;
      return (
        t instanceof Element &&
        t.closest("button,a,input,select,textarea,[role='button'],[data-no-skip]") !== null
      );
    };
    const fire = (e: Event) => {
      if (skips.current.size === 0) return;
      if (fromControl(e)) return;
      // snapshot: a handler may unregister itself (via its `active` flag) mid-flush.
      for (const fn of Array.from(skips.current)) fn();
    };
    window.addEventListener("pointerdown", fire, { capture: true });
    window.addEventListener("keydown", fire, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", fire, { capture: true });
      window.removeEventListener("keydown", fire, { capture: true });
    };
  }, []);

  const value = useMemo<MotionCtxValue>(() => ({ reduced, register }), [reduced, register]);
  return <MotionCtx.Provider value={value}>{children}</MotionCtx.Provider>;
}

export function useMotionCtx(): MotionCtxValue {
  const ctx = useContext(MotionCtx);
  if (!ctx) throw new Error("useMotionCtx must be used within <MotionProvider>");
  return ctx;
}
