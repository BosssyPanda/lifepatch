"use client";

import { motion, useReducedMotion } from "framer-motion";
import { currency } from "@/lib/format";
import { freedomRatio, passiveIncome, totalExpenses } from "@/lib/cashflow/selectors";
import type { CashflowState } from "@/lib/cashflow/types";

// premium tabletop palette — ivory ledger, slate groove, brass fill (matches Board)
const IVORY = "#e9e1cd";
const INK = "#2a241d";
const BRASS = "#c9a24a";
const OLIVE = "#7f8b52";

const EASE = [0.2, 0.65, 0.3, 0.9] as const;
/** Progress milestones — each is a notch the brass fill crosses on the way to free. */
const MILESTONES = [25, 50, 75] as const;

/** Passive income vs. expenses. At 100% the player is free. A brass freedom gauge. */
export function FreedomMeter({ s, compact = false }: { s: CashflowState; compact?: boolean }) {
  const reduce = useReducedMotion();
  const passive = passiveIncome(s);
  const expenses = totalExpenses(s);
  const ratio = freedomRatio(s);
  const pct = Math.min(100, Math.round(ratio * 100));
  const free = passive >= expenses;
  const near = !free && pct >= 80; // close enough to "feel" the goal pulling
  const fillTop = free ? "#a9b06a" : "#e6cb7e";
  const fillMid = free ? OLIVE : BRASS;
  const fillLow = free ? "#5f6a3c" : "#a07f2c";

  return (
    <div
      className={compact ? "" : "relative overflow-hidden rounded-[7px] p-4"}
      style={
        compact
          ? undefined
          : {
              // beveled ivory card — top sheen, inner edge, grounded drop (matches the board chips)
              background: `linear-gradient(180deg, #f3ecd9 0%, ${IVORY} 55%, #d8cfb6 100%)`,
              boxShadow:
                "0 1px 0 rgba(255,255,255,0.7) inset, 0 0 0 1px rgba(33,28,22,0.1) inset, 0 20px 40px -26px rgba(0,0,0,0.85)",
              border: `1px solid ${BRASS}66`,
            }
      }
    >
      <div className="flex items-baseline justify-between">
        <span className="eyebrow" style={{ color: INK, opacity: 0.6, fontSize: "0.6rem", letterSpacing: "0.22em" }}>
          Freedom
        </span>
        <motion.span
          // a small count-pop each time the percentage changes makes progress feel earned
          key={pct}
          initial={reduce ? false : { scale: 1.18, opacity: 0.7 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.32, ease: EASE }}
          className="num text-sm font-bold tabular-nums"
          style={{ color: free ? OLIVE : "#8a6d22" }}
        >
          {pct}%
        </motion.span>
      </div>

      {/* recessed slate groove holding a domed brass fill — an instrument, not a flat bar */}
      <div
        className="relative mt-2 h-4 overflow-hidden rounded-full"
        style={{
          background: "linear-gradient(180deg, #12161b 0%, #1b2027 60%, #232a33 100%)",
          boxShadow: `inset 0 2px 4px rgba(0,0,0,0.7), inset 0 -1px 0 rgba(255,255,255,0.05), 0 0 0 1px ${BRASS}44`,
        }}
      >
        {/* engraved tick notches behind the fill — a measured gauge face */}
        {MILESTONES.map((m) => (
          <span
            key={m}
            aria-hidden
            className="absolute inset-y-[3px] w-px"
            style={{ left: `${m}%`, background: `${BRASS}55` }}
          />
        ))}

        <motion.div
          className="relative h-full rounded-full"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 20 }}
          style={{
            background: `linear-gradient(180deg, ${fillTop} 0%, ${fillMid} 52%, ${fillLow} 100%)`,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.55), 0 0 0 1px ${fillLow}, ${
              free
                ? "0 0 14px -2px " + OLIVE
                : near
                  ? "0 0 12px -3px " + BRASS
                  : "0 1px 3px rgba(0,0,0,0.5)"
            }`,
          }}
        >
          {/* moving sheen along the brass — motion that reads as "live", not idle decoration */}
          {!reduce && pct > 4 && (
            <motion.span
              aria-hidden
              className="absolute inset-y-0 w-1/3 -skew-x-12"
              style={{ background: "rgba(255,255,255,0.35)", filter: "blur(2px)" }}
              initial={{ left: "-40%" }}
              animate={{ left: ["-40%", "130%"] }}
              transition={{ duration: free ? 1.7 : 2.6, repeat: Infinity, ease: "easeInOut", repeatDelay: free ? 0.2 : 1.1 }}
            />
          )}
        </motion.div>

        {/* the goal post at 100% — the thing being earned, a brass rail */}
        <div className="absolute inset-y-0 right-0 flex items-center">
          <span className="h-full w-[2px]" style={{ background: free ? OLIVE : `${BRASS}aa` }} />
        </div>

        {/* a brighter wash when free, breathing once crossed (reduced-motion: steady) */}
        {free && (
          <motion.div
            aria-hidden
            className="absolute inset-0"
            style={{ background: `${OLIVE}55` }}
            initial={reduce ? { opacity: 0.22 } : { opacity: 0.5 }}
            animate={reduce ? { opacity: 0.22 } : { opacity: [0.45, 0.08, 0.45] }}
            transition={reduce ? { duration: 0 } : { duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </div>

      {/* milestone + goal legend under the gauge */}
      <div className="mt-1.5 flex items-center justify-between font-serif text-[0.6rem]" style={{ color: `${INK}88` }}>
        <span style={pct >= 50 ? { color: INK, opacity: 0.75 } : undefined}>halfway</span>
        <motion.span
          key={free ? "free" : "goal"}
          initial={reduce ? false : { y: free ? 6 : 0, opacity: free ? 0 : 1 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4, ease: EASE }}
          className="eyebrow"
          style={{ fontSize: "0.54rem", color: free ? OLIVE : near ? "#8a6d22" : `${INK}88`, letterSpacing: "0.2em" }}
        >
          {free ? "Free" : "Escape · 100%"}
        </motion.span>
      </div>

      <div className="mt-2 flex items-center justify-between font-serif text-[0.72rem]" style={{ color: `${INK}aa` }}>
        <span>
          Passive <span className="num font-semibold" style={{ color: OLIVE }}>{currency(passive)}</span>
        </span>
        <span>
          Expenses <span className="num font-semibold" style={{ color: INK }}>{currency(expenses)}</span>
        </span>
      </div>
      {!compact && (
        <p className="mt-1.5 font-serif text-[0.72rem] leading-snug" style={{ color: `${INK}99` }}>
          {free
            ? "Your assets now cover your life. You can escape the Rat Race!"
            : `Earn ${currency(Math.max(0, expenses - passive))}/mo more in passive income to break free.`}
        </p>
      )}
    </div>
  );
}
