"use client";

import { motion } from "framer-motion";
import { currency } from "@/lib/format";
import type { Outcome } from "@/lib/lifeEvents";
import { DUR, EASE, STAGGER } from "@/src/motion/tokens";
import type { beatFor } from "./consequenceBeats";

/**
 * The consequence beat's ledger derivation: what a row IS, and how a row PRINTS.
 * Both live here because they only make sense together — the tone map is what the
 * builder assigns and what the renderer paints.
 */

export type RowTone = "loss" | "gain" | "muted";
export type Row = { label: string; value: string; tone: RowTone; strong?: boolean; rule?: boolean };

export const TONE_VAR: Record<RowTone, string> = {
  loss: "var(--color-loss)",
  gain: "var(--color-gain)",
  muted: "var(--color-secondary)",
};

export function signedMoney(n: number): string {
  const s = n < 0 ? "−" : n > 0 ? "+" : "";
  return `${s}${currency(Math.abs(n))}`;
}
export function signedInt(n: number): string {
  return `${n < 0 ? "−" : "+"}${Math.abs(Math.round(n))}`;
}

/** Derivation first (only when the authored maths reconciles), then secondary effects. */
export function buildRows(effect: Outcome["effect"], cash: number, beat: ReturnType<typeof beatFor>): Row[] {
  const rows: Row[] = [];
  const d = beat?.derivation;
  const reconciled = !!d && Math.abs(cash) === d.monthly * d.months;
  if (d && reconciled) {
    rows.push({ label: d.unitLabel, value: `${cash < 0 ? "−" : "+"}${currency(d.monthly)} / mo`, tone: cash < 0 ? "loss" : "gain" });
    rows.push({ label: "×", value: `${d.months} ${d.periodLabel}`, tone: "muted" });
    rows.push({ label: d.totalLabel, value: signedMoney(cash), tone: cash < 0 ? "loss" : "gain", strong: true, rule: true });
  }
  if (effect.debt) rows.push({ label: "Debt", value: signedMoney(effect.debt), tone: effect.debt > 0 ? "loss" : "gain" });
  if (effect.salaryTo !== undefined) rows.push({ label: "Salary", value: `→ ${currency(effect.salaryTo)}`, tone: "muted" });
  if (effect.salaryPct) rows.push({ label: "Pay", value: `${effect.salaryPct > 0 ? "+" : "−"}${Math.abs(effect.salaryPct)}%`, tone: effect.salaryPct > 0 ? "gain" : "loss" });
  if (effect.health) rows.push({ label: "Health", value: signedInt(effect.health), tone: effect.health > 0 ? "gain" : "loss" });
  if (effect.happiness) rows.push({ label: "Mood", value: signedInt(effect.happiness), tone: effect.happiness > 0 ? "gain" : "loss" });
  return rows;
}

/** The rows printing in, one after another, once the landing has settled. */
export function LedgerRows({ rows, show, reduced }: { rows: Row[]; show: boolean; reduced: boolean }) {
  return (
    <div className="mt-6 max-w-lg">
      {rows.map((r, i) => (
        <motion.div
          key={`${r.label}-${i}`}
          className={`flex items-baseline gap-2 py-1.5 ${r.rule ? "mt-1 border-t border-hairline pt-2.5" : ""}`}
          initial={reduced ? undefined : { opacity: 0, clipPath: "inset(0 0 100% 0)" }}
          animate={show ? { opacity: 1, clipPath: "inset(0 0 0% 0)" } : { opacity: 0, clipPath: "inset(0 0 100% 0)" }}
          transition={{ duration: DUR.fast, ease: EASE, delay: show && !reduced ? i * STAGGER.loose : 0 }}
        >
          <span
            className={r.strong ? "display-caps text-ink" : "eyebrow text-secondary"}
            style={{ fontSize: r.strong ? "0.72rem" : "0.62rem", letterSpacing: r.strong ? "0.08em" : "0.14em" }}
          >
            {r.label}
          </span>
          <span className="mt-1 flex-1 rule-dotted" />
          <span
            className="num"
            style={{ fontSize: r.strong ? "0.92rem" : "0.76rem", color: TONE_VAR[r.tone] }}
          >
            {r.value}
          </span>
        </motion.div>
      ))}
    </div>
  );
}
