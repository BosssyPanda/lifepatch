"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { currency } from "@/lib/format";

/** House easing — shared across the cashflow mode's motion. */
const EASE = [0.2, 0.65, 0.3, 0.9] as const;

/** Modal tone → the colored aura behind the card (opportunity / loss / neutral). */
const TONE_GLOW: Record<"accent" | "brick" | "neutral", string> = {
  accent: "radial-gradient(60% 50% at 50% 38%, rgba(212,84,30,0.28), transparent 70%)",
  brick: "radial-gradient(60% 50% at 50% 38%, rgba(163,50,24,0.3), transparent 70%)",
  neutral: "radial-gradient(60% 50% at 50% 38%, rgba(233,225,207,0.12), transparent 72%)",
};

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
 * A modal scaffold: a deepening backdrop + a cinematic card reveal that rises,
 * settles, and tilts back into place behind a tonal aura. Parent controls
 * mounting; pass `tone` to color the aura (opportunity / loss / neutral).
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
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="fixed inset-0 z-[80] grid place-items-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
      style={{ perspective: 1400 }}
    >
      {/* backdrop: darkens + blurs in, so the card reads as lifted off the table */}
      <motion.button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/75"
        disabled={!onClose}
        initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
        animate={{ opacity: 1, backdropFilter: reduce ? "blur(0px)" : "blur(3px)" }}
        exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
        transition={{ duration: 0.26, ease: EASE }}
      />
      {/* tonal aura behind the card */}
      {!reduce && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: TONE_GLOW[tone] }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
        />
      )}
      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.94, rotateX: 12 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, rotateX: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.97, rotateX: 6 }}
        transition={
          reduce
            ? { duration: 0 }
            : { type: "spring", stiffness: 260, damping: 24, mass: 0.9 }
        }
        className={`relative w-full ${maxWidth} thin-scroll max-h-[88svh] overflow-y-auto`}
        style={{ transformStyle: "preserve-3d", transformOrigin: "center bottom" }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

/** The recurring "why this matters" teaching callout. Reveals just after the card. */
export function LessonBox({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.35, ease: EASE, delay: 0.12 }}
      className="mt-4 rounded-[4px] border-l-[3px] border-accent bg-accent/10 px-3.5 py-2.5 shadow-[0_8px_18px_-16px_rgba(212,84,30,0.9)]"
    >
      <p className="eyebrow text-accent" style={{ fontSize: "0.6rem" }}>
        Why this matters
      </p>
      <p className="mt-1 font-serif text-[0.9rem] leading-relaxed text-paper-ink/85">{children}</p>
    </motion.div>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "good" | "bad" | "neutral" }) {
  const cls =
    tone === "good"
      ? "bg-olive/20 text-olive border-olive/40"
      : tone === "bad"
        ? "bg-brick/20 text-brick border-brick/40"
        : "bg-paper-ink/10 text-paper-ink/70 border-paper-ink/20";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 num text-[0.7rem] ${cls}`}>
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
