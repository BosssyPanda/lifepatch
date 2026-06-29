"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { currency } from "@/lib/format";

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

/** A modal scaffold: dim backdrop + spring-in card. Parent controls mounting. */
export function Modal({
  children,
  onClose,
  maxWidth = "max-w-lg",
}: {
  children: ReactNode;
  onClose?: () => void;
  maxWidth?: string;
}) {
  return (
    <motion.div
      className="fixed inset-0 z-[80] grid place-items-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
        disabled={!onClose}
      />
      <motion.div
        initial={{ opacity: 0, y: 28, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 240, damping: 22 }}
        className={`relative w-full ${maxWidth} thin-scroll max-h-[88svh] overflow-y-auto`}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

/** The recurring "why this matters" teaching callout. */
export function LessonBox({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 rounded-[4px] border-l-[3px] border-accent bg-accent/10 px-3.5 py-2.5">
      <p className="eyebrow text-accent" style={{ fontSize: "0.6rem" }}>
        Why this matters
      </p>
      <p className="mt-1 font-serif text-[0.9rem] leading-relaxed text-paper-ink/85">{children}</p>
    </div>
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
