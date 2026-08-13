"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Inline two-tap confirmation for a destructive action — the house alternative to a
 * modal for things that cannot be undone (ending a run, exiting a session, overwriting
 * a save). The first tap *arms* the control and swaps its label; a second tap inside the
 * window commits. It disarms itself after ~3s, on Escape, and on blur, so a control is
 * never left quietly hot.
 *
 * The label swap is the whole affordance, so it has to be announced: render it through
 * `ArmedLabel`, which is the polite live region.
 */

/** How long an armed control stays hot before reverting (ms). */
const ARM_MS = 3000;

export type ArmedAction = {
  armed: boolean;
  /** The label to render right now — resting or armed. */
  label: string;
  onClick: () => void;
  /** Spread onto the control: leaving it cancels the arming. */
  onBlur: () => void;
  reset: () => void;
};

export function useArmedAction({
  label,
  armedLabel = "Tap again to confirm",
  onConfirm,
  onArm,
  timeoutMs = ARM_MS,
}: {
  label: string;
  /** Shown once armed. Keep it short and say what the second tap does. */
  armedLabel?: string;
  onConfirm: () => void;
  /** Fired on the arming tap — a place for the ui tick. */
  onArm?: () => void;
  timeoutMs?: number;
}): ArmedAction {
  const [armed, setArmed] = useState(false);

  const reset = useCallback(() => setArmed(false), []);

  // Auto-revert + Escape, mounted only while armed so the listener costs nothing at rest.
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), timeoutMs);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setArmed(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [armed, timeoutMs]);

  // `armed` is read through a ref inside the handler so the click identity stays stable
  // for callers that memoize their buttons.
  const armedRef = useRef(armed);
  armedRef.current = armed;

  const onClick = useCallback(() => {
    if (armedRef.current) {
      setArmed(false);
      onConfirm();
      return;
    }
    setArmed(true);
    onArm?.();
  }, [onConfirm, onArm]);

  return { armed, label: armed ? armedLabel : label, onClick, onBlur: reset, reset };
}

/**
 * The label slot for an armed control: a polite live region so the "tap again" state is
 * announced rather than only seen, tinted loss-red once hot.
 */
export function ArmedLabel({ armed, children }: { armed: boolean; children: ReactNode }) {
  return (
    <span aria-live="polite" className={armed ? "text-loss" : undefined}>
      {children}
    </span>
  );
}
