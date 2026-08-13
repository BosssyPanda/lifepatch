"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, type ReactNode } from "react";
import { useDialog } from "@/components/ui/LedgerDialog";
import { currency } from "@/lib/format";

import { useMotionCtx } from "@/src/motion/MotionProvider";
import { EASE } from "@/src/motion/tokens";

/** Money in tabular display numerals, optionally signed/colored. */
export function Money({
  n,
  className = "",
  signed = false,
}: {
  n: number;
  className?: string;
  signed?: boolean;
}) {
  const s = signed && n > 0 ? `+${currency(n)}` : currency(n);
  return <span className={`num ${className}`}>{s}</span>;
}

/**
 * A modal scaffold: a flat darkening scrim + a card that rises and settles.
 * LEDGER: no aura, no backdrop-blur, no glow — depth comes from the scrim, the card's own
 * hairline frame, and (amendment B) the one sanctioned neutral float shadow.
 *
 * The scrim used to be a full-screen `<button aria-label="Close">`, which put an unlabeled
 * page-sized control in the tab order ahead of the card's real contents. It is a plain div
 * now; `useDialog` owns Escape, the focus trap, focus restore, and the scroll lock.
 * `tone` is retained for caller compatibility.
 */
export function Modal({
  children,
  onClose,
  maxWidth = "max-w-lg",
  tone = "neutral",
  label = "Dialog",
}: {
  children: ReactNode;
  onClose?: () => void;
  maxWidth?: string;
  tone?: "accent" | "brick" | "neutral";
  label?: string;
}) {
  void tone;
  const { reduced: reduce } = useMotionCtx();
  const noop = useCallback(() => {}, []);
  const ref = useDialog<HTMLDivElement>({ open: true, onClose: onClose ?? noop });
  return (
    <motion.div
      className="fixed inset-0 z-[80] grid place-items-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
    >
      {/* flat scrim — darkens the board so the card reads as lifted */}
      <motion.div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/80"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.26, ease: EASE }}
      />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-elevated=""
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.96 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.98 }}
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 24, mass: 0.9 }}
        className={`relative w-full ${maxWidth} thin-scroll max-h-[88svh] overflow-y-auto`}
        data-lenis-prevent
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

/**
 * The recurring teaching callout. LEDGER §3.3: no "Why this matters" header,
 * no badge — it renders as one quiet serif voice line under a hairline.
 */
export function LessonBox({ children }: { children: ReactNode }) {
  const { reduced: reduce } = useMotionCtx();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.35, ease: EASE, delay: 0.12 }}
      className="mt-4 border-t border-hairline pt-3"
    >
      <p className="voice text-[1rem] leading-snug text-ink/90">{children}</p>
    </motion.div>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "good" | "bad" | "neutral" }) {
  const cls =
    tone === "good"
      ? "text-gain border-gain/50"
      : tone === "bad"
        ? "text-loss border-loss/50"
        : "text-ink/70 border-ink/25";
  return (
    <span className={`inline-flex items-center gap-1 border px-2 py-0.5 num text-[0.7rem] ${cls}`}>
      {children}
    </span>
  );
}

/**
 * A short-lived floating toast (payday collected, etc.). `role="status"` — it is
 * `pointer-events-none`, so being announced is the only way a screen-reader user
 * ever learns a payday landed.
 */
export function Toast({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: 24, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -16, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className="pointer-events-none fixed left-1/2 top-24 z-[90] -translate-x-1/2"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
