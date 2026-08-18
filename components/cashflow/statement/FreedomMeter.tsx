"use client";

import { motion } from "framer-motion";
import { currency } from "@/lib/format";
import {
  freedomPct,
  freedomRatio,
  passiveIncome,
  solvencyFactor,
  totalExpenses,
  valueDestroyed,
} from "@/lib/cashflow/selectors";
import type { CashflowState } from "@/lib/cashflow/types";

import { useMotionCtx } from "@/src/motion/MotionProvider";
import { DUR, EASE } from "@/src/motion/tokens";
/** Progress milestones — each is a notch the fill crosses on the way to free. */
const MILESTONES = [25, 50, 75] as const;

/**
 * Passive income vs. expenses, dragged down by value destroyed. A flat LEDGER gauge.
 *
 * The raw ratio alone was a lie: property and business mortgages have no expense
 * line (a holding's `cashFlow` is already net of its own mortgage), so leverage
 * could only ever push the meter UP. A player $1.2M in the hole read "FREEDOM 28%".
 * `freedomPct` multiplies the ratio by a solvency factor keyed on value destroyed
 * since turn 0 — so good leverage still costs nothing, and burned money costs
 * exactly what it burned.
 */
export function FreedomMeter({ s, compact = false }: { s: CashflowState; compact?: boolean }) {
  const { reduced: reduce } = useMotionCtx();
  const passive = passiveIncome(s);
  const expenses = totalExpenses(s);
  const raw = Math.min(100, Math.round(freedomRatio(s) * 100));
  const pct = freedomPct(s);
  const drag = solvencyFactor(s);
  const dragged = drag < 1;
  const underwater = valueDestroyed(s);
  const free = passive >= expenses;
  // Loss colour wins while the meter is dragged: the fill is reporting a problem,
  // not progress. Palette tokens only — no invented colours.
  const fillVar = dragged ? "var(--color-loss)" : free ? "var(--color-gain)" : "var(--color-ink)";

  return (
    <div className={compact ? "" : "border border-hairline bg-bg2 p-4"}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="eyebrow text-secondary" style={{ fontSize: "0.6rem", letterSpacing: "0.22em" }}>
          Freedom
        </span>
        <div className="flex items-baseline gap-2">
          {dragged && (
            /* Never colour-only: the glyph carries the warning for anyone who
               can't separate loss-red from ink. */
            <span
              className="eyebrow inline-flex items-center gap-1 border px-1.5 py-[1px]"
              style={{ fontSize: "0.5rem", letterSpacing: "0.16em", color: "var(--color-loss)", borderColor: "var(--color-loss)" }}
            >
              <span aria-hidden>▲</span> Debt
            </span>
          )}
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
      </div>

      {/* flat gauge track — hairline groove, ink/gain fill, milestone tick notches.
          This is the win condition, so it carries real gauge semantics. */}
      <div
        className="relative mt-2 h-4 overflow-hidden border border-hairline bg-bg"
        role="progressbar"
        aria-label="Freedom"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={
          dragged
            ? `${pct}% — ${currency(passive)} passive income against ${currency(expenses)} monthly expenses, held down from ${raw}% because you are ${currency(underwater)} worse off than you started`
            : `${pct}% — ${currency(passive)} passive income against ${currency(expenses)} monthly expenses`
        }
      >
        {MILESTONES.map((m) => (
          <span key={m} aria-hidden className="absolute inset-y-[2px] w-px" style={{ left: `${m}%`, background: "var(--color-hairline)" }} />
        ))}
        {/* Where the meter WOULD sit on cash flow alone — the gap between this
            ghost mark and the fill is the debt, drawn rather than asserted. */}
        {dragged && raw > pct && (
          <span
            aria-hidden
            className="absolute inset-y-0 w-px opacity-60"
            style={{ left: `${raw}%`, background: "var(--color-secondary)" }}
          />
        )}
        {/* The fill used to animate `width` — a layout tween on the game's win
            condition, re-run on every state recompute. The track is the fixed-size
            box (the `role="progressbar"` element above); the fill is full-width and
            scales from its left edge instead, so the gauge is compositor-only.
            Same spring, so the crossing of each milestone notch reads identically. */}
        <motion.div
          className="relative h-full w-full origin-left"
          initial={false}
          animate={{ scaleX: pct / 100 }}
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

      {dragged && (
        <p
          className="mt-2 flex items-start gap-1.5 border-l-2 py-1 pl-2 text-[0.72rem] leading-snug"
          style={{ color: "var(--color-loss)", borderColor: "var(--color-loss)" }}
        >
          <span aria-hidden className="mt-[1px]">▲</span>
          <span>
            Underwater by <span className="num font-semibold">{currency(underwater)}</span> more than you
            started
            {/* Both figures are rounded, so a small drag can leave them equal — and
                "dragging your meter from 6% down to 6%" reads as a broken sentence.
                Only name the fall when there is a fall to name. */}
            {raw > pct ? <> — debt is dragging your meter from {raw}% down to {pct}%.</> : " — that debt is weight your meter has to lift."}
          </span>
        </p>
      )}

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
