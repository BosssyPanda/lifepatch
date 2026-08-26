"use client";

import { motion, type MotionProps } from "framer-motion";
import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { DUR, EASE } from "@/src/motion/tokens";

/**
 * The house dialog. Every overlay in the app used to hand-roll its own scrim + card and each
 * one shipped the same three bugs: no focus trap (Tab walked straight out into the page
 * behind), no Escape, and a full-screen `<button aria-label="Close">` scrim that landed in the
 * tab order as a giant unlabeled control. `useDialog` owns the behavior, `LedgerDialog` owns
 * the surface, and callers keep their own enter/exit animations.
 *
 * Deliberately *not* a portal: the overlays it retrofits are mounted once and kept mounted by
 * AppShell so their exit animations survive, and moving them would break that.
 */

type UseDialogOptions = {
  open: boolean;
  onClose: () => void;
  /** Focus this on open instead of the first tabbable child. */
  initialFocus?: React.RefObject<HTMLElement | null>;
};

const TABBABLE =
  'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),iframe,object,embed,[contenteditable],[tabindex]:not([tabindex="-1"])';

function tabbable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) => el.offsetParent !== null || el.getClientRects().length > 0,
  );
}

/**
 * Focus trap + Escape + focus restore + body scroll lock for one open overlay.
 * Returns the ref to spread onto the dialog's card element.
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>({
  open,
  onClose,
  initialFocus,
}: UseDialogOptions) {
  const ref = useRef<T>(null);
  const opener = useRef<HTMLElement | null>(null);

  // Body scroll lock — same pattern as ConsequenceBeat: capture the inline value so we
  // restore whatever was there rather than clobbering it to "".
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Remember the opener, move focus in, and hand it back on close. Restoring is what makes
  // "open the almanac, close it, keep tabbing" work instead of dumping focus at <body>.
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const target = initialFocus?.current ?? tabbable(el)[0] ?? el;
      if (target === el && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(id);
      opener.current?.focus?.({ preventScroll: true });
    };
  }, [open, initialFocus]);

  // Escape closes; Tab cycles inside the card.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const el = ref.current;
      if (!el) return;
      const items = tabbable(el);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !el.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !el.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  return ref;
}

export type LedgerDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. */
  label: string;
  children: ReactNode;
  /** Clicking the scrim closes. Off by default — a stray click shouldn't destroy state. */
  dismissOnScrimClick?: boolean;
  /** Width cap on the card. */
  maxWidth?: string;
  className?: string;
  /** Card motion — callers pass their existing enter/exit so retrofits look unchanged. */
  card?: Pick<MotionProps, "initial" | "animate" | "exit" | "transition">;
  /** Full-bleed layout (no scrim inset, card fills the viewport) — Almanac/ShareCard style. */
  fullBleed?: boolean;
  initialFocus?: React.RefObject<HTMLElement | null>;
};

/**
 * Scrim + framed card. The scrim is a plain div with an onClick, never a `<button>`: a
 * screen-reader user should not meet a full-screen unlabeled control, and the card's own
 * Close button is the announced way out.
 */
export function LedgerDialog({
  open,
  onClose,
  label,
  children,
  dismissOnScrimClick = false,
  maxWidth = "max-w-lg",
  className = "",
  card,
  fullBleed = false,
  initialFocus,
}: LedgerDialogProps) {
  const ref = useDialog<HTMLDivElement>({ open, onClose, initialFocus });
  const labelId = useId();

  const onScrim = useCallback(() => {
    if (dismissOnScrimClick) onClose();
  }, [dismissOnScrimClick, onClose]);

  return (
    <motion.div
      className={`fixed inset-0 z-50 flex ${fullBleed ? "" : "items-center justify-center p-4"}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DUR.instant, ease: EASE }}
    >
      <div
        aria-hidden
        onClick={onScrim}
        className={`absolute inset-0 ${fullBleed ? "bg-bg" : "scrim"}`}
      />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        data-elevated={fullBleed ? undefined : ""}
        className={`relative flex flex-col ${
          fullBleed ? "h-full w-full bg-bg" : `w-full ${maxWidth} border border-hairline-strong bg-bg2`
        } ${className}`}
        initial={card?.initial}
        animate={card?.animate}
        exit={card?.exit}
        transition={card?.transition ?? { duration: DUR.base, ease: EASE }}
      >
        <span id={labelId} className="sr-only">
          {label}
        </span>
        {children}
      </motion.div>
    </motion.div>
  );
}
