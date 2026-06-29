"use client";

import { motion } from "framer-motion";
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
  const color =
    accent === "income" ? "text-olive" : accent === "expense" ? "text-brick" : "text-paper-ink";
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? "" : "py-0.5"}`}>
      <span
        className={`font-serif ${strong ? "display-caps text-[0.78rem] tracking-wide text-paper-ink" : `text-[0.84rem] ${dim ? "text-paper-ink/55" : "text-paper-ink/80"}`}`}
        title={hint}
      >
        {label}
      </span>
      <span className={`num ${strong ? "text-[0.95rem] font-semibold" : "text-[0.82rem]"} ${color}`}>
        <AnimatedNumber value={value} format={(n) => currency(n)} />
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="mb-1 mt-3 flex items-center gap-2 first:mt-0">
      <span className="eyebrow text-paper-dim" style={{ fontSize: "0.6rem" }}>
        {children}
      </span>
      <span className="h-px flex-1 bg-paper-ink/20" />
    </div>
  );
}

export function FinancialStatement({ s, className = "" }: { s: CashflowState; className?: string }) {
  const passive = passiveIncome(s);
  const expenses = totalExpenses(s);
  const pay = payday(s);
  const dividends = s.stocks.reduce((t, h) => t + h.dividend * h.shares, 0);
  const reCash = s.realEstate.reduce((t, h) => t + h.cashFlow, 0);
  const bizCash = s.businesses.reduce((t, h) => t + h.cashFlow, 0);

  return (
    <div className={`paper rounded-[5px] p-4 ${className}`}>
      <div className="flex items-center justify-between border-b-2 border-paper-ink pb-2">
        <h3 className="display-caps text-lg text-paper-ink">Financial Statement</h3>
        <span className="eyebrow text-paper-dim" style={{ fontSize: "0.58rem" }}>
          monthly
        </span>
      </div>

      {/* ── INCOME STATEMENT ── */}
      <SectionLabel>Income</SectionLabel>
      <Row label="Salary" value={s.salary} />
      <Row label="Interest / Dividends" value={Math.round(dividends)} dim accent="income" />
      <Row label="Real Estate" value={reCash} dim accent="income" />
      <Row label="Business" value={bizCash} dim accent="income" />
      <div className="my-1 h-px bg-paper-ink/15" />
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
      <div className="my-1 h-px bg-paper-ink/15" />
      <Row label="Total Expenses" value={expenses} strong />

      {/* ── PAYDAY ── the punchline */}
      <motion.div
        key={pay >= 0 ? "pos" : "neg"}
        initial={{ scale: 0.98 }}
        animate={{ scale: 1 }}
        className={`mt-3 flex items-center justify-between rounded-[4px] px-3 py-2 ${pay >= 0 ? "bg-olive/15" : "bg-brick/15"}`}
      >
        <div>
          <p className="display-caps text-[0.8rem] text-paper-ink">Payday (Cash Flow)</p>
          <p className="font-serif text-[0.68rem] text-paper-ink/60">Income − Expenses</p>
        </div>
        <span className={`num text-xl font-bold ${pay >= 0 ? "text-olive" : "text-brick"}`}>
          <AnimatedNumber value={pay} format={(n) => (n >= 0 ? `+${currency(n)}` : currency(n))} />
        </span>
      </motion.div>

      {/* ── PASSIVE INCOME — the freedom number ── */}
      <div className="mt-2 flex items-center justify-between rounded-[4px] border border-accent/40 bg-accent/10 px-3 py-2">
        <div>
          <p className="display-caps text-[0.8rem] text-accent">Passive Income</p>
          <p className="font-serif text-[0.68rem] text-paper-ink/60">Beat your expenses to win</p>
        </div>
        <span className="num text-xl font-bold text-accent">
          <AnimatedNumber value={passive} format={(n) => currency(n)} />
        </span>
      </div>

      {/* ── BALANCE SHEET ── */}
      <div className="mt-4 grid grid-cols-2 gap-3 border-t-2 border-paper-ink pt-3">
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
      <div className="mt-2 flex items-center justify-between rounded-[4px] bg-paper-ink/8 px-3 py-1.5">
        <span className="display-caps text-[0.74rem] text-paper-ink">Net Worth</span>
        <span className="num text-[0.95rem] font-semibold text-paper-ink">
          <AnimatedNumber value={netWorth(s)} format={(n) => currency(n)} />
        </span>
      </div>
      <p className="sr-only">Total liabilities {currency(totalLiabilities(s))}.</p>
    </div>
  );
}
