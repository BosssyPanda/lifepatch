"use client";

import { motion, useReducedMotion } from "framer-motion";
import { AnimatedNumber } from "@/components/story/AnimatedNumber";
import {
  bankLoanPayment,
  businessEquity,
  childExpense,
  netWorth,
  passiveIncome,
  payday,
  realEstateEquity,
  stocksValue,
  totalExpenses,
  totalIncome,
  totalLiabilities,
} from "@/lib/cashflow/selectors";
import { currency } from "@/lib/format";
import type { CashflowState } from "@/lib/cashflow/types";

function Row({
  label,
  value,
  dim = false,
  strong = false,
  accent,
  hint,
}: {
  label: string;
  value: number;
  dim?: boolean;
  strong?: boolean;
  accent?: "income" | "expense";
  hint?: string;
}) {
  if (!strong && value === 0 && dim) return null;
  // Color semantics: gain = income, loss = expense.
  const color = accent === "income" ? "text-gain" : accent === "expense" ? "text-loss" : "text-ink";
  // A strong row is a section total — it sits on a hairline shelf and dominates
  // the recessed line items above it (scale contrast, not just bold).
  return (
    <div
      className={`flex items-baseline justify-between gap-3 ${strong ? "mt-0.5 border-t border-hairline pt-1" : "py-[1px]"}`}
    >
      <span
        className={
          strong
            ? "display-caps text-[0.84rem] tracking-wide text-ink"
            : `text-[0.82rem] ${dim ? "text-ink/50" : "text-ink/80"}`
        }
        title={hint}
      >
        {label}
      </span>
      <span className={`num ${strong ? "text-[1.08rem] font-bold tabular-nums" : "text-[0.8rem]"} ${color}`}>
        <AnimatedNumber value={value} format={(n) => currency(n)} />
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="mb-1 mt-3 flex items-center gap-2 first:mt-0">
      <span aria-hidden className="h-2 w-[2px]" style={{ background: "var(--color-secondary)" }} />
      <span className="eyebrow text-secondary" style={{ fontSize: "0.6rem", letterSpacing: "0.2em" }}>
        {children}
      </span>
      <span className="rule-dotted h-px flex-1" />
    </div>
  );
}

export function FinancialStatement({ s, className = "" }: { s: CashflowState; className?: string }) {
  const reduce = useReducedMotion();
  const passive = passiveIncome(s);
  const expenses = totalExpenses(s);
  const pay = payday(s);
  const dividends = s.stocks.reduce((t, h) => t + h.dividend * h.shares, 0);
  const reCash = s.realEstate.reduce((t, h) => t + h.cashFlow, 0);
  const bizCash = s.businesses.reduce((t, h) => t + h.cashFlow, 0);

  return (
    <div className={`paper relative p-4 ${className}`}>
      {/* ledger binding edge */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-[2px]" style={{ background: "var(--color-secondary)" }} />
      {/* masthead — hairline rule under the title */}
      <div className="flex items-center justify-between border-b border-hairline pb-2">
        <h3 className="display-caps text-xl text-ink">Financial Statement</h3>
        <span className="eyebrow text-secondary" style={{ fontSize: "0.58rem", letterSpacing: "0.18em" }}>
          monthly
        </span>
      </div>

      {/* ── INCOME STATEMENT ── */}
      <SectionLabel>Income</SectionLabel>
      <Row label="Salary" value={s.salary} />
      <Row label="Interest / Dividends" value={Math.round(dividends)} dim accent="income" />
      <Row label="Real Estate" value={reCash} dim accent="income" />
      <Row label="Business" value={bizCash} dim accent="income" />
      <Row label="Total Income" value={totalIncome(s)} strong />

      <SectionLabel>Expenses</SectionLabel>
      <Row label="Taxes" value={s.expenses.taxes} dim />
      <Row label="Home Mortgage" value={s.expenses.homeMortgage} dim />
      <Row label="School Loan" value={s.expenses.schoolLoan} dim />
      <Row label="Car Loan" value={s.expenses.carLoan} dim />
      <Row label="Credit Card" value={s.expenses.creditCard} dim />
      <Row label="Retail" value={s.expenses.retail} dim />
      <Row label="Other" value={s.expenses.other} dim />
      <Row label={`Children (${s.children})`} value={childExpense(s)} dim hint="Per-child expense × number of children" />
      <Row label="Bank Loan Payment" value={bankLoanPayment(s)} dim accent="expense" hint="10% of bank-loan balance, every month" />
      <Row label="Total Expenses" value={expenses} strong />

      {/* ── PAYDAY ── the punchline: the dominant figure in the card. */}
      <motion.div
        key={pay}
        initial={reduce ? false : { scale: 0.965, opacity: 0.85 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.2, 0.65, 0.3, 0.9] }}
        className="relative mt-3 flex items-center justify-between border border-hairline bg-bg2 px-3.5 py-2.5"
      >
        <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${pay >= 0 ? "bg-gain" : "bg-loss"}`} />
        <div>
          <p className="display-caps text-[0.86rem] text-ink">Payday · Cash Flow</p>
          <p className="text-[0.66rem] text-ink/60">Income − Expenses, every payday</p>
        </div>
        <span className={`num text-2xl font-bold tabular-nums ${pay >= 0 ? "text-gain" : "text-loss"}`}>
          <AnimatedNumber value={pay} format={(n) => (n >= 0 ? `+${currency(n)}` : currency(n))} />
        </span>
      </motion.div>

      {/* ── PASSIVE INCOME — the freedom number (second anchor) ── */}
      <div className="relative mt-2 flex items-center justify-between border border-hairline bg-bg2 px-3.5 py-2.5">
        <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: "var(--color-ink)" }} />
        <div>
          <p className="display-caps text-[0.86rem] text-ink">Passive Income</p>
          <p className="text-[0.66rem] text-ink/60">Beat your expenses to win</p>
        </div>
        <span className="num text-2xl font-bold tabular-nums text-ink">
          <AnimatedNumber value={passive} format={(n) => currency(n)} />
        </span>
      </div>

      {/* ── BALANCE SHEET ── */}
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-hairline pt-3">
        <div>
          <SectionLabel>Assets</SectionLabel>
          <Row label="Cash" value={s.cash} dim />
          <Row label="Stocks" value={stocksValue(s)} dim />
          <Row label="Real Estate" value={realEstateEquity(s)} dim />
          <Row label="Businesses" value={businessEquity(s)} dim />
        </div>
        <div>
          <SectionLabel>Liabilities</SectionLabel>
          <Row label="Mortgages" value={s.liabilities.homeMortgage + s.realEstate.reduce((t, h) => t + h.mortgage, 0)} dim />
          <Row label="School Loan" value={s.liabilities.schoolLoan} dim />
          <Row label="Car / Credit" value={s.liabilities.carLoan + s.liabilities.creditCard + s.liabilities.retail} dim />
          <Row label="Bank Loan" value={s.liabilities.bankLoan} dim accent="expense" />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between border border-hairline bg-bg2 px-3.5 py-2">
        <span className="display-caps text-[0.8rem] text-ink">Net Worth</span>
        <span className="num text-[1.15rem] font-bold tabular-nums text-ink">
          <AnimatedNumber value={netWorth(s)} format={(n) => currency(n)} />
        </span>
      </div>
      <p className="sr-only">Total liabilities {currency(totalLiabilities(s))}.</p>
    </div>
  );
}
