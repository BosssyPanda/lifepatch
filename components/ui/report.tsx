"use client";

import type { ReactNode } from "react";

/**
 * The printed-statement primitives. LifeReport and CashflowReport each grew their own copy of
 * these and drifted (0.9rem vs 0.95rem figures, string-only vs node values) — one module now
 * covers both, with the superset API: `value` takes any node so a caller can drop an
 * <AnimatedNumber> in, and `size` keeps the figure scale explicit.
 */

/** A ledger section header — eyebrow with a dotted rule running to the margin. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1.5 mt-7 flex items-center gap-2">
      <span aria-hidden className="h-2 w-[2px]" style={{ background: "var(--color-secondary)" }} />
      <span className="eyebrow text-secondary" style={{ fontSize: "0.6rem", letterSpacing: "0.2em" }}>
        {children}
      </span>
      <span className="rule-dotted h-px flex-1" />
    </div>
  );
}

/** A statement line: label — dot leader — figure. */
export function LedgerRow({
  label,
  value,
  strong = false,
  tone = "text-ink",
  size = "0.9rem",
}: {
  label: string;
  value: ReactNode;
  /** Total lines: heavier label, larger bold figure. */
  strong?: boolean;
  /** Text-color class for the figure (e.g. "text-gain"). */
  tone?: string;
  /** Figure size for non-strong rows. */
  size?: string;
}) {
  return (
    <div className="flex items-baseline gap-2.5 py-[3px]">
      <span className={strong ? "display-caps text-[0.82rem] text-ink" : "text-[0.84rem] text-ink/80"}>{label}</span>
      <span className="rule-dotted h-px flex-1" />
      <span
        className={`num ${strong ? "font-bold" : ""} ${tone}`}
        style={{ fontSize: strong ? "1.05rem" : size }}
      >
        {value}
      </span>
    </div>
  );
}
