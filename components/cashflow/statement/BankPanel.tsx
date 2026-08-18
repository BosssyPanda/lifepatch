"use client";

import { motion } from "framer-motion";
import { AnimatedNumber } from "@/components/story/AnimatedNumber";
import { NeonButton } from "@/components/ui/LedgerButton";
import {
  BANK_LOAN_RATE,
  bankHeadroom,
  bankLoanPayment,
  bankLoanStress,
  maxBankLoan,
} from "@/lib/cashflow/selectors";
import { currency } from "@/lib/format";
import type { CashflowState } from "@/lib/cashflow/types";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { DUR, EASE } from "@/src/motion/tokens";

/** Past this share of the ceiling the panel starts shouting. */
const WARN_AT = 0.6;

/**
 * The bank. Borrowing used to happen only *to* the player — `clampCash` converted
 * every shortfall into an uncapped loan at 10%/month, and the `borrow` and
 * `repayBankLoan` engine functions had no callers anywhere in the UI. So there was
 * no way to take a loan on purpose, no way to pay one back, and no visible edge to
 * the hole. All three are here now: the balance, what it costs you every single
 * month, and how much rope the bank has left.
 */
export function BankPanel({
  s,
  onBorrow,
  onRepay,
  disabled = false,
}: {
  s: CashflowState;
  onBorrow: (amount: number) => void;
  onRepay: (amount: number) => void;
  /** True while a resolution card owns the screen — these actions are unreachable
   *  behind the scrim, so they must read as unavailable rather than merely inert. */
  disabled?: boolean;
}) {
  const { reduced: reduce } = useMotionCtx();
  const balance = s.liabilities.bankLoan;
  const payment = bankLoanPayment(s);
  const cap = maxBankLoan(s);
  const headroom = bankHeadroom(s);
  const stress = bankLoanStress(s);
  const warn = stress >= WARN_AT;
  const used = Math.min(100, Math.round(stress * 100));

  const canRepayUnit = balance >= 1000 && s.cash >= 1000;
  const maxRepay = Math.min(Math.floor(s.cash / 1000) * 1000, Math.floor(balance / 1000) * 1000);

  return (
    <div className="border border-hairline bg-bg2 p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="eyebrow text-secondary" style={{ fontSize: "0.6rem", letterSpacing: "0.22em" }}>
          The Bank
        </span>
        {warn && (
          <span
            className="eyebrow inline-flex items-center gap-1 border px-1.5 py-[1px]"
            style={{ fontSize: "0.5rem", letterSpacing: "0.16em", color: "var(--color-loss)", borderColor: "var(--color-loss)" }}
          >
            <span aria-hidden>▲</span> {used}% of limit
          </span>
        )}
      </div>

      <div className="mt-2 flex items-baseline justify-between">
        <div>
          <p className="text-[0.72rem] text-ink/60">Bank loan balance</p>
          <p className="text-[0.66rem] text-ink/45">
            Costs {currency(payment)}/mo — {Math.round(BANK_LOAN_RATE * 100)}% of the balance, forever
          </p>
        </div>
        <motion.span
          key={balance}
          initial={reduce ? false : { scale: 1.1, opacity: 0.7 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: DUR.base, ease: EASE }}
          className={`num text-xl font-bold tabular-nums ${balance > 0 ? "text-loss" : "text-ink"}`}
        >
          <AnimatedNumber value={balance} format={(n) => currency(n)} />
        </motion.span>
      </div>

      {/* credit line — how much rope is left, drawn */}
      <div
        className="relative mt-2 h-2.5 overflow-hidden border border-hairline bg-bg"
        role="progressbar"
        aria-label="Bank credit used"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${currency(balance)} borrowed of a ${currency(cap)} limit — ${currency(headroom)} left`}
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0"
          style={{
            width: `${used}%`,
            background: warn ? "var(--color-loss)" : "var(--color-secondary)",
          }}
        />
        <span aria-hidden className="absolute inset-y-0 w-px" style={{ left: `${WARN_AT * 100}%`, background: "var(--color-hairline)" }} />
      </div>
      <p className="mt-1 flex items-center justify-between text-[0.66rem] text-ink/55">
        <span className="num">Limit {currency(cap)}</span>
        <span className="num">{currency(headroom)} left to borrow</span>
      </p>

      {warn && (
        <p
          className="mt-2 flex items-start gap-1.5 border-l-2 py-1 pl-2 text-[0.72rem] leading-snug"
          style={{ color: "var(--color-loss)", borderColor: "var(--color-loss)" }}
        >
          <span aria-hidden className="mt-[1px]">▲</span>
          <span>
            You are near the bank&apos;s limit. If a bill lands that it won&apos;t cover, the run ends.
            Repay, or sell something.
          </span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <NeonButton size="sm" variant="secondary" disabled={disabled || headroom < 1000} onClick={() => onBorrow(1000)}>
          Borrow $1,000
        </NeonButton>
        <NeonButton size="sm" variant="secondary" disabled={disabled || !canRepayUnit} onClick={() => onRepay(1000)}>
          Repay $1,000
        </NeonButton>
        <NeonButton size="sm" variant="primary" disabled={disabled || maxRepay < 1000} onClick={() => onRepay(maxRepay)}>
          Repay MAX{maxRepay >= 1000 ? ` · ${currency(maxRepay)}` : ""}
        </NeonButton>
      </div>

      <p className="mt-2 text-[0.68rem] leading-snug" style={{ color: "var(--color-secondary)" }}>
        {balance > 0
          ? `Every $1,000 you repay takes $100/mo straight off your expenses — that is a guaranteed 120%/yr return, better than any deal on the board.`
          : `Borrow only to buy something that pays you more than ${Math.round(BANK_LOAN_RATE * 100)}%/mo. Almost nothing does.`}
      </p>
    </div>
  );
}
