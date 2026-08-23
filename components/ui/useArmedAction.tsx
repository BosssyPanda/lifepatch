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
  /**
   * The LONGEST label this control will ever show. Pass it to `ArmedLabel` on any
   * control whose size is load-bearing for the layout around it — see the note there.
   */
  reserve: string;
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

  return {
    armed,
    label: armed ? armedLabel : label,
    reserve: armedLabel.length >= label.length ? armedLabel : label,
    onClick,
    onBlur: reset,
    reset,
  };
}

/**
 * The label slot for an armed control: a polite live region, so the "tap again" state
 * is announced rather than only seen.
 *
 * It sets no colour of its own, deliberately. It used to force `text-loss`, which is
 * INK — and ink cannot be laid over a fill without breaking DESIGN.md § Palette hard
 * rule 1 ("knockout is paper, never ink"). It broke twice over: red on the accent
 * fill of a `primary` CTA measures 1.12:1, and red on the loss fill a `danger`
 * button takes on hover measures 1:1 — the sentence the player is being asked to
 * read simply is not there. The control itself is the only thing that knows what
 * ground the label is sitting on, so the control owns the colour: every call site
 * already paints its own armed state (`AuthGate`, `CashflowGame`, `Setup` and
 * `LobbyScreen` swap the variant to `danger`, whose own `hover:text-bg` then does
 * the knockout properly; `AdvanceBar` sets `text-loss` on its bare button). The
 * label inherits, and is legible in every state of all five.
 *
 * Colour was never the only channel here anyway — the words themselves change.
 *
 * `reserve` holds the control at the width of its LONGEST state so arming cannot
 * resize it. Pass it wherever the control shares a row with anything else. Rat Race's
 * HUD is the case that proved it: the row is `flex-wrap`, and "Exit" -> "Tap again —
 * run is saved" took the button from 59px to 202px, which dropped it onto a new line
 * 42px down and 207px left. The finger that armed it was no longer on it, so tapping
 * twice in the same place — the whole affordance — could not exit at all.
 */
export function ArmedLabel({
  children,
  reserve,
  align = "center",
}: {
  children: ReactNode;
  reserve?: string;
  /** Where the SHORT label sits inside the reserved box. `end` for a control anchored
   *  to the right edge of a row, so at rest it stays exactly where it always was and
   *  the long label grows inwards, the way it did before the box was fixed. */
  align?: "start" | "center" | "end";
}) {
  if (!reserve) return <span aria-live="polite">{children}</span>;
  const justify = align === "end" ? "justify-self-end" : align === "start" ? "justify-self-start" : "justify-self-center";
  return (
    <span className="grid">
      {/* A sizing ghost. `aria-hidden` so the longest label is never read out, and it
          sits in the same grid cell so the two states stack rather than add up. */}
      <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-nowrap">
        {reserve}
      </span>
      <span aria-live="polite" className={`col-start-1 row-start-1 whitespace-nowrap ${justify}`}>
        {children}
      </span>
    </span>
  );
}
