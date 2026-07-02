"use client";

import { motion, useReducedMotion } from "framer-motion";
import { currency } from "@/lib/format";
import { freedomRatio, passiveIncome, totalExpenses } from "@/lib/cashflow/selectors";
import type { CashflowState } from "@/lib/cashflow/types";

import { DUR, EASE } from "@/src/motion/tokens";
/** Progress milestones — each is a notch the fill crosses on the way to free. */
const MILESTONES = [25, 50, 75] as const;

/** Passive income vs. expenses. At 100% the player is free. A flat LEDGER gauge. */
export function FreedomMeter({ s, compact = false }: { s: CashflowState; compact?: boolean }) {
  const reduce = useReducedMotion();
  const passive = passiveIncome(s);
  const expenses = totalExpenses(s);
  const ratio = freedomRatio(s);
  const pct = Math.min(100, Math.round(ratio * 100));
  const free = passive >= expenses;
  const fillVar = free ? "var(--color-gain)" : "var(--color-ink)";

  return (
    <div className={compact ? "" : "border border-hairline bg-bg2 p-4"}>
      <div className="flex items-baseline justify-between">
        <span className="eyebrow text-secondary" style={{ fontSize: "0.6rem", letterSpacing: "0.22em" }}>
          Freedom
        </span>
        <motion.span
          key={pct}
          initial={reduce ? false : { scale: 1.18, opacity: 0.7 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.32, ease: EASE }}
          className="num text-sm font-bold tabular-nums"
          style={{ color: fillVar }}
        >
          {pct}%
        </motion.span>
      </div>

      {/* flat gauge track — hairline groove, ink/gain fill, milestone tick notches */}
      <div className="relative mt-2 h-4 overflow-hidden border border-hairline bg-bg">
        {MILESTONES.map((m) => (
          <span key={m} aria-hidden className="absolute inset-y-[2px] w-px" style={{ left: `${m}%`, background: "var(--color-hairline)" }} />
        ))}
        <motion.div
          className="relative h-full"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 20 }}
          style={{ background: fillVar }}
        />
        {/* the goal post at 100% — the thing being earned */}
        <div className="absolute inset-y-0 right-0 flex items-center">
          <span className="h-full w-[2px]" style={{ background: free ? "var(--color-gain)" : "var(--color-secondary)" }} />
        </div>
      </div>

      {/* milestone + goal legend under the gauge */}
      <div className="mt-1.5 flex items-center justify-between text-[0.6rem]" style={{ color: "var(--color-secondary)" }}>
        <span style={pct >= 50 ? { color: "var(--color-ink)" } : undefined}>halfway</span>
        <motion.span
          key={free ? "free" : "goal"}
          initial={reduce ? false : { y: free ? 6 : 0, opacity: free ? 0 : 1 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: DUR.base, ease: EASE }}
          className="eyebrow"
          style={{ fontSize: "0.54rem", color: free ? "var(--color-gain)" : "var(--color-secondary)", letterSpacing: "0.2em" }}
        >
          {free ? "Free" : "Escape · 100%"}
        </motion.span>
      </div>

      <div className="mt-2 flex items-center justify-between text-[0.72rem]" style={{ color: "var(--color-ink)" }}>
        <span>
          Passive <span className="num font-semibold" style={{ color: "var(--color-gain)" }}>{currency(passive)}</span>
        </span>
        <span>
          Expenses <span className="num font-semibold" style={{ color: "var(--color-ink)" }}>{currency(expenses)}</span>
        </span>
      </div>
      {!compact && (
        <p className="mt-1.5 text-[0.72rem] leading-snug" style={{ color: "var(--color-secondary)" }}>
          {free
            ? "Your assets now cover your life. You can escape the Rat Race!"
            : `Earn ${currency(Math.max(0, expenses - passive))}/mo more in passive income to break free.`}
        </p>
      )}
    </div>
  );
}
