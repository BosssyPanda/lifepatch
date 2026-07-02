"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * Terminal-op loading state (Addendum A §8.4) — replaces every spinner. A mono
 * uppercase operation label with a blinking block caret, e.g.
 * `PROCESSING TRANSACTION ▮`. CSS-steps blink (opacity keyframes, no rAF);
 * reduced motion renders the label static. LEDGER tokens only.
 */
export function TerminalOp({
  label,
  className = "",
  center = false,
}: {
  label: string;
  className?: string;
  center?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-2 ${center ? "justify-center" : ""} ${className}`}
    >
      <span className="num text-secondary" style={{ fontSize: "0.68rem", letterSpacing: "0.14em" }}>
        {label.toUpperCase()}…
      </span>
      <motion.span
        aria-hidden
        className="inline-block h-[0.85em] w-[0.5ch] bg-ink"
        animate={reduce ? { opacity: 1 } : { opacity: [1, 1, 0, 0] }}
        transition={reduce ? undefined : { duration: 1.05, repeat: Infinity, times: [0, 0.5, 0.5, 1], ease: "linear" }}
      />
    </span>
  );
}
