"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { currency } from "@/lib/format";

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
 * LEDGER: no aura, no backdrop-blur, no glow — depth comes from the scrim and
 * the card's own hairline frame. `tone` is retained for caller compatibility.
 */
export function Modal({
  children,
  onClose,
  maxWidth = "max-w-lg",
  tone = "neutral",
}: {
  children: ReactNode;
  onClose?: () => void;
  maxWidth?: string;
  tone?: "accent" | "brick" | "neutral";
}) {
  void tone;
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="fixed inset-0 z-[80] grid place-items-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
    >
      {/* flat scrim — darkens the board so the card reads as lifted */}
      <motion.button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/80"
        disabled={!onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.26, ease: EASE }}
      />
      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.96 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.98 }}
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 24, mass: 0.9 }}
        className={`relative w-full ${maxWidth} thin-scroll max-h-[88svh] overflow-y-auto`}
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
  const reduce = useReducedMotion();
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

/** A short-lived floating toast (payday collected, etc.). */
export function Toast({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
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
