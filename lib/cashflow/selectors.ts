// Derived numbers off CashflowState. This is the heart of the lesson: the income
// statement + balance sheet recomputed live, every render.

import type { CashflowState } from "./types";

/** Monthly bank-loan payment: a punishing 10% of the outstanding balance. */
export function bankLoanPayment(s: CashflowState): number {
  return Math.round(s.liabilities.bankLoan * 0.1);
}

/** Passive income = stock dividends + real-estate cash flow + business cash flow.
 *  Note: idle cash earns nothing — that's a deliberate teaching point. */
export function passiveIncome(s: CashflowState): number {
  const dividends = s.stocks.reduce((t, h) => t + h.dividend * h.shares, 0);
  const realEstate = s.realEstate.reduce((t, h) => t + h.cashFlow, 0);
  const business = s.businesses.reduce((t, h) => t + h.cashFlow, 0);
  return Math.round(dividends + realEstate + business);
}

export function totalIncome(s: CashflowState): number {
  return s.salary + passiveIncome(s);
}

export function childExpense(s: CashflowState): number {
  return s.perChild * s.children;
}

export function totalExpenses(s: CashflowState): number {
  const e = s.expenses;
  return (
    e.taxes +
    e.homeMortgage +
    e.schoolLoan +
    e.carLoan +
    e.creditCard +
    e.retail +
    e.other +
    childExpense(s) +
    bankLoanPayment(s)
  );
}

/** Monthly cash flow = the "Payday" number. */
export function payday(s: CashflowState): number {
  return totalIncome(s) - totalExpenses(s);
}

/** 0..1+ — fraction of expenses now covered by passive income. */
export function freedomRatio(s: CashflowState): number {
  const exp = totalExpenses(s);
  if (exp <= 0) return 1;
  return passiveIncome(s) / exp;
}

/** The win condition for the Rat Race. */
export function hasEscaped(s: CashflowState): boolean {
  return passiveIncome(s) >= totalExpenses(s);
}

// ── Balance sheet ──────────────────────────────────────────────────────────────
export function stocksValue(s: CashflowState): number {
  return Math.round(s.stocks.reduce((t, h) => t + h.shares * h.costBasis, 0));
}

export function realEstateEquity(s: CashflowState): number {
  return Math.round(s.realEstate.reduce((t, h) => t + (h.price - h.mortgage), 0));
}

export function businessEquity(s: CashflowState): number {
  return Math.round(s.businesses.reduce((t, h) => t + (h.price - h.liability), 0));
}

export function totalAssets(s: CashflowState): number {
  return s.cash + stocksValue(s) + realEstateEquity(s) + businessEquity(s);
}

export function totalLiabilities(s: CashflowState): number {
  const l = s.liabilities;
  const propertyDebt = s.realEstate.reduce((t, h) => t + h.mortgage, 0);
  const businessDebt = s.businesses.reduce((t, h) => t + h.liability, 0);
  return (
    l.homeMortgage +
    l.schoolLoan +
    l.carLoan +
    l.creditCard +
    l.retail +
    l.bankLoan +
    propertyDebt +
    businessDebt
  );
}

export function netWorth(s: CashflowState): number {
  return Math.round(s.cash + stocksValue(s) + realEstateEquity(s) + businessEquity(s) - totalLiabilities(s) + s.fastTrackCashflow * 0);
}

// ── Deal analysis (the coach math) ──────────────────────────────────────────────
/** Cash-on-cash return: annual cash flow ÷ cash invested, as a percent. */
export function cashOnCash(annualCashFlow: number, cashInvested: number): number {
  if (cashInvested <= 0) return 0;
  return (annualCashFlow / cashInvested) * 100;
}

/** Dividend yield for a stock at a given price, as a percent (annualized). */
export function dividendYield(monthlyDividend: number, price: number): number {
  if (price <= 0) return 0;
  return ((monthlyDividend * 12) / price) * 100;
}
