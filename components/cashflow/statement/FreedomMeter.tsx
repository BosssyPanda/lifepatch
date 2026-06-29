"use client";

import { motion, useReducedMotion } from "framer-motion";
import { currency } from "@/lib/format";
import { freedomRatio, passiveIncome, totalExpenses } from "@/lib/cashflow/selectors";
import type { CashflowState } from "@/lib/cashflow/types";

/** Passive income vs. expenses. At 100% the player is free. */
export function FreedomMeter({ s, compact = false }: { s: CashflowState; compact?: boolean }) {
  const reduce = useReducedMotion();
  const passive = passiveIncome(s);
  const expenses = totalExpenses(s);
  const ratio = freedomRatio(s);
  const pct = Math.min(100, Math.round(ratio * 100));
  const free = passive >= expenses;

  return (
    <div className={compact ? "" : "rounded-[5px] border border-ink/15 bg-bg2 p-3.5"}>
      <div className="flex items-baseline justify-between">
        <span className="eyebrow text-ink-dim" style={{ fontSize: "0.6rem" }}>
          Freedom
        </span>
        <span className={`num text-sm font-semibold ${free ? "text-olive" : "text-accent"}`}>{pct}%</span>
      </div>

      <div className="relative mt-2 h-3 overflow-hidden rounded-full bg-bg3">
        <motion.div
          className={`h-full rounded-full ${free ? "bg-olive" : "bg-accent"}`}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 20 }}
        />
        {/* goal marker at 100% (right edge) */}
        <div className="absolute inset-y-0 right-0 w-px bg-ink/40" />
        {free && !reduce && (
          <motion.div
            className="absolute inset-0 bg-olive/40"
            animate={{ opacity: [0.4, 0, 0.4] }}
            transition={{ duration: 1.6, repeat: Infinity }}
          />
        )}
      </div>

      <div className="mt-2 flex items-center justify-between font-serif text-[0.72rem] text-ink-dim">
        <span>
          Passive <span className="num text-olive">{currency(passive)}</span>
        </span>
        <span>
          Expenses <span className="num text-ink">{currency(expenses)}</span>
        </span>
      </div>
      {!compact && (
        <p className="mt-1.5 font-serif text-[0.72rem] leading-snug text-ink-dim">
          {free
            ? "Your assets now cover your life. You can escape the Rat Race!"
            : `Earn ${currency(Math.max(0, expenses - passive))}/mo more in passive income to break free.`}
        </p>
      )}
    </div>
  );
}
