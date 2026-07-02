"use client";

import { useEffect, useRef } from "react";
import { useMotionCtx } from "./MotionProvider";

/**
 * Subscribe a ceremony to the global input-skip (Addendum A §1.4 / §5.3).
 *
 * While `active` is true, any pointerdown / keydown anywhere fires `onSkip` — the
 * ceremony's jump-to-final-state. Pass `active = !finished && !reduced`: the moment
 * the ceremony reaches its final state, `active` flips false and it unregisters, so
 * ambient input skips the animation but never drives what comes after it.
 *
 * `onSkip` is read through a ref, so a fresh closure each render does NOT churn the
 * subscription — it re-registers only when `active` flips. Returns the shared
 * `reduced` flag so the ceremony can render its final state immediately.
 */
export function useSkippable(active: boolean, onSkip: () => void): { reduced: boolean } {
  const { reduced, register } = useMotionCtx();
  const cb = useRef(onSkip);
  cb.current = onSkip;

  useEffect(() => {
    if (!active) return;
    return register(() => cb.current());
  }, [active, register]);

  return { reduced };
}
