"use client";

import { motion, useReducedMotion } from "framer-motion";
import { currency } from "@/lib/format";
import { freedomRatio, passiveIncome, totalExpenses } from "@/lib/cashflow/selectors";
import type { CashflowState } from "@/lib/cashflow/types";

const EASE = [0.2, 0.65, 0.3, 0.9] as const;
/** Progress milestones — each is a small notch the fill crosses on the way to free. */
const MILESTONES = [25, 50, 75] as const;

/** Passive income vs. expenses. At 100% the player is free. */
export function FreedomMeter({ s, compact = false }: { s: CashflowState; compact?: boolean }) {
  const reduce = useReducedMotion();
  const passive = passiveIncome(s);
  const expenses = totalExpenses(s);
  const ratio = freedomRatio(s);
  const pct = Math.min(100, Math.round(ratio * 100));
  const free = passive >= expenses;
  const near = !free && pct >= 80; // close enough to "feel" the goal pulling

  return (
    <div className={compact ? "" : "rounded-[5px] border border-ink/15 bg-bg2 p-3.5"}>
      <div className="flex items-baseline justify-between">
        <span className="eyebrow text-ink-dim" style={{ fontSize: "0.6rem" }}>
          Freedom
        </span>
        <motion.span
          // a small count-pop each time the percentage changes makes progress feel earned
          key={pct}
          initial={reduce ? false : { scale: 1.18, opacity: 0.7 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.32, ease: EASE }}
          className={`num text-sm font-semibold ${free ? "text-olive" : "text-accent"}`}
        >
          {pct}%
        </motion.span>
      </div>

      <div
        className={`relative mt-2 h-3.5 overflow-hidden rounded-full bg-bg3 ring-1 ring-inset ${
          free ? "ring-olive/50" : near ? "ring-accent/40" : "ring-ink/10"
        }`}
      >
        {/* track ticks behind the fill — give the bar a measured, instrument feel */}
        {MILESTONES.map((m) => (
          <span
            key={m}
            aria-hidden
            className="absolute inset-y-0 w-px bg-ink/15"
            style={{ left: `${m}%` }}
          />
        ))}

        <motion.div
          className={`relative h-full rounded-full ${free ? "bg-olive" : "bg-accent"}`}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 20 }}
          style={{
            boxShadow: free
              ? "0 0 14px -2px var(--color-olive)"
              : near
                ? "0 0 12px -3px var(--color-accent)"
                : "none",
          }}
        >
          {/* moving sheen along the fill — motion that reads as "live", not idle decoration */}
          {!reduce && pct > 4 && (
            <motion.span
              aria-hidden
              className="absolute inset-y-0 w-1/3 -skew-x-12 bg-paper/25 blur-[2px]"
              initial={{ left: "-40%" }}
              animate={{ left: ["-40%", "130%"] }}
              transition={{ duration: free ? 1.7 : 2.6, repeat: Infinity, ease: "easeInOut", repeatDelay: free ? 0.2 : 1.1 }}
            />
          )}
        </motion.div>

        {/* the goal flag at 100% — the thing being earned */}
        <div className="absolute inset-y-0 right-0 flex items-center">
          <span className={`h-full w-[2px] ${free ? "bg-olive" : "bg-ink/45"}`} />
        </div>

        {/* a brighter wash when free, breathing once crossed (reduced-motion: steady) */}
        {free && (
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-olive/35"
            initial={reduce ? { opacity: 0.22 } : { opacity: 0.5 }}
            animate={reduce ? { opacity: 0.22 } : { opacity: [0.45, 0.08, 0.45] }}
            transition={reduce ? { duration: 0 } : { duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </div>

      {/* milestone + goal legend under the bar */}
      <div className="mt-1 flex items-center justify-between font-serif text-[0.6rem] text-ink-dim/70">
        <span className={pct >= 50 ? "text-ink-dim" : ""}>halfway</span>
        <motion.span
          key={free ? "free" : "goal"}
          initial={reduce ? false : { y: free ? 6 : 0, opacity: free ? 0 : 1 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4, ease: EASE }}
          className={`eyebrow ${free ? "text-olive" : near ? "text-accent" : "text-ink-dim/70"}`}
          style={{ fontSize: "0.54rem" }}
        >
          {free ? "Free" : "Escape · 100%"}
        </motion.span>
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
