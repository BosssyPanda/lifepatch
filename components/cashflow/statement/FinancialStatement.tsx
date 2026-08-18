"use client";

import { motion } from "framer-motion";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { DUR, EASE } from "@/src/motion/tokens";
import { AnimatedNumber } from "@/components/story/AnimatedNumber";
import { NeonButton } from "@/components/ui/LedgerButton";
import {
  PAYOFF_LINES,
  bankLoanPayment,
  businessValue,
  canPayoff,
  childExpense,
  netWorth,
  passiveIncome,
  payday,
  payoffFreedomGain,
  quote,
  realEstateValue,
  stocksUnrealized,
  stocksValue,
  totalAssets,
  totalExpenses,
  totalIncome,
  totalLiabilities,
} from "@/lib/cashflow/selectors";
import { currency } from "@/lib/format";
import type { CashflowState, PayoffKey } from "@/lib/cashflow/types";

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

/** One holding, shown gross with its own debt and the equity that leaves. */
function HoldingLine({ label, price, debt }: { label: string; price: number; debt: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-[1px] pl-2.5 text-[0.72rem]">
      <span className="min-w-0 flex-1 truncate text-ink/45" title={label}>
        {label}
      </span>
      <span className="num shrink-0 tabular-nums text-ink/45">
        {currency(price)}
        {debt > 0 && <span className="text-loss"> − {currency(debt)}</span>}
        <span className="text-ink/70"> = {currency(price - debt)}</span>
      </span>
    </div>
  );
}

/**
 * A liability the player can clear outright. Starting balances carry no
 * amortization schedule, so without this button a large slab of the freedom
 * denominator was permanently unreducible — the meter had exactly one lever.
 */
function LiabilityRow({
  s,
  payKey,
  label,
  hint,
  onPayoff,
  disabled = false,
}: {
  s: CashflowState;
  payKey: PayoffKey;
  label: string;
  hint: string;
  onPayoff?: (key: PayoffKey) => void;
  disabled?: boolean;
}) {
  const balance = s.liabilities[payKey];
  if (balance <= 0) return null;
  const monthly = s.expenses[payKey];
  const able = canPayoff(s, payKey);
  const gain = able ? payoffFreedomGain(s, payKey) : 0;

  return (
    <div className="py-[1px]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[0.82rem] text-ink/50" title={hint}>
          {label}
          {monthly > 0 && <span className="num text-[0.68rem] text-ink/35"> · {currency(monthly)}/mo</span>}
        </span>
        <span className="num text-[0.8rem] tabular-nums text-ink">
          <AnimatedNumber value={balance} format={(n) => currency(n)} />
        </span>
      </div>
      {/* The shortfall is a *fact*, not a control: rendering a permanently
          disabled button on every liability put five dead targets in the panel.
          The button appears only when the move is actually available. */}
      {onPayoff && !able && (
        <p className="num text-right text-[0.62rem] text-ink/35">
          {currency(balance - s.cash)} more to clear it
        </p>
      )}
      {onPayoff && able && (
        <div className="mt-0.5 flex items-center justify-end gap-2">
          {gain > 0 && <span className="num text-[0.62rem] text-gain">+{gain} pts freedom</span>}
          <NeonButton size="sm" variant="secondary" disabled={disabled} onClick={() => onPayoff(payKey)}>
            Pay off {currency(balance)}
          </NeonButton>
        </div>
      )}
    </div>
  );
}

export function FinancialStatement({
  s,
  className = "",
  onPayoff,
  actionsDisabled = false,
}: {
  s: CashflowState;
  className?: string;
  /** Wire this to enable the per-liability payoff buttons. */
  onPayoff?: (key: PayoffKey) => void;
  /** True while a resolution card owns the screen. */
  actionsDisabled?: boolean;
}) {
  const { reduced: reduce } = useMotionCtx();
  const passive = passiveIncome(s);
  const expenses = totalExpenses(s);
  const pay = payday(s);
  const dividends = s.stocks.reduce((t, h) => t + h.dividend * h.shares, 0);
  const reCash = s.realEstate.reduce((t, h) => t + h.cashFlow, 0);
  const bizCash = s.businesses.reduce((t, h) => t + h.cashFlow, 0);

  const propertyDebt = s.realEstate.reduce((t, h) => t + h.mortgage, 0);
  const businessDebt = s.businesses.reduce((t, h) => t + h.liability, 0);
  const assets = totalAssets(s);
  const liabilities = totalLiabilities(s);
  const unrealized = stocksUnrealized(s);

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
        transition={{ duration: DUR.base, ease: EASE }}
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

      {/* ── BALANCE SHEET ──
          Gross on gross, so the identity is visible: what you own, what you owe,
          and the difference. Assets used to be listed as EQUITY while liabilities
          listed the same mortgages again, and net worth subtracted the debt twice
          — a $520k building with a $450k mortgage read as −$380,000. Per-holding
          equity now lives on the holding line, where it belongs. */}
      <div className="mt-4 border-t border-hairline pt-3">
        <SectionLabel>Assets — what you own</SectionLabel>
        <Row label="Cash" value={s.cash} />
        <Row label="Stocks (at market)" value={stocksValue(s)} dim hint="Valued at today's quote, not what you paid" />
        {s.stocks.map((h) => (
          <div key={h.uid} className="flex items-baseline justify-between gap-2 py-[1px] pl-2.5 text-[0.72rem]">
            <span className="min-w-0 flex-1 truncate text-ink/45">
              {h.symbol} × {h.shares}
            </span>
            <span className="num shrink-0 tabular-nums text-ink/45">
              {currency(quote(s, h.symbol, h.costBasis))}/sh
              <span className="text-ink/70"> = {currency(Math.round(h.shares * quote(s, h.symbol, h.costBasis)))}</span>
            </span>
          </div>
        ))}
        {s.stocks.length > 0 && unrealized !== 0 && (
          <p className={`pl-2.5 text-[0.66rem] ${unrealized > 0 ? "text-gain" : "text-loss"}`}>
            Unrealized {unrealized > 0 ? "gain" : "loss"} {currency(Math.abs(unrealized))} — only real once you sell.
          </p>
        )}
        <Row label="Real Estate (price paid)" value={realEstateValue(s)} dim />
        {s.realEstate.map((h) => (
          <HoldingLine key={h.uid} label={h.label} price={h.price} debt={h.mortgage} />
        ))}
        <Row label="Businesses (price paid)" value={businessValue(s)} dim />
        {s.businesses.map((h) => (
          <HoldingLine key={h.uid} label={h.label} price={h.price} debt={h.liability} />
        ))}
        <Row label="Total Assets" value={assets} strong />

        <SectionLabel>Liabilities — what you owe</SectionLabel>
        {PAYOFF_LINES.map((l) => (
          <LiabilityRow key={l.key} s={s} payKey={l.key} label={l.label} hint={l.hint} onPayoff={onPayoff} disabled={actionsDisabled} />
        ))}
        <Row label="Property Mortgages" value={propertyDebt} dim hint="Attached to your rentals — the tenants pay these" />
        <Row label="Business Loans" value={businessDebt} dim />
        <Row label="Bank Loan" value={s.liabilities.bankLoan} dim accent="expense" hint="10% of the balance, every single month" />
        <Row label="Total Liabilities" value={liabilities} strong accent="expense" />
      </div>

      <div className="mt-2 border border-hairline bg-bg2 px-3.5 py-2">
        <div className="flex items-center justify-between">
          <span className="display-caps text-[0.8rem] text-ink">Net Worth</span>
          <span className={`num text-[1.15rem] font-bold tabular-nums ${netWorth(s) >= 0 ? "text-ink" : "text-loss"}`}>
            <AnimatedNumber value={netWorth(s)} format={(n) => currency(n)} />
          </span>
        </div>
        {/* the identity, spelled out — this panel is the teaching surface, so it
            has to be checkable by hand */}
        <p className="num mt-0.5 text-right text-[0.62rem] text-ink/45">
          {currency(assets)} assets − {currency(liabilities)} liabilities
        </p>
      </div>
    </div>
  );
}
