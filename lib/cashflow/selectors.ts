// Derived numbers off CashflowState. This is the heart of the lesson: the income
// statement + balance sheet recomputed live, every render.

import type { CashflowState, PayoffKey } from "./types";

/** Monthly bank-loan payment: a punishing 10% of the outstanding balance. */
export const BANK_LOAN_RATE = 0.1;

export function bankLoanPayment(s: CashflowState): number {
  return Math.round(s.liabilities.bankLoan * BANK_LOAN_RATE);
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

/**
 * How much value the player has DESTROYED since turn 0 — cash burned on doodads,
 * bank interest, bad sales. Not raw net worth: every profession starts tens or
 * hundreds of thousands underwater (that is the premise), so measuring against
 * zero would peg everyone at 0% from turn 1 and make the meter useless.
 *
 * Buying a $520k building with a $450k mortgage moves this by exactly $0 — good
 * leverage is not punished. Paying $8k for doodads moves it by $8k.
 */
export function valueDestroyed(s: CashflowState): number {
  return Math.max(0, s.startingNetWorth - netWorth(s));
}

/** Two years of the player's own lifestyle — the scale a deficit is judged against. */
export function solvencyHorizon(s: CashflowState): number {
  return Math.max(24 * totalExpenses(s), 50_000);
}

/** 1 = solvent, 0 = has destroyed two years of living costs. Multiplies the meter. */
export function solvencyFactor(s: CashflowState): number {
  const horizon = solvencyHorizon(s);
  if (horizon <= 0) return 1;
  return clamp01(1 - valueDestroyed(s) / horizon);
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * The number on the Freedom meter. Cash flow earns it; destroyed value drags it.
 * Without the drag, a player $1.2M in the hole still read "FREEDOM 28%" — because
 * property mortgages have no expense line, so leverage could only ever raise it.
 */
export function freedomPct(s: CashflowState): number {
  return Math.round(Math.min(1, freedomRatio(s)) * solvencyFactor(s) * 100);
}

/** The win condition for the Rat Race. */
export function hasEscaped(s: CashflowState): boolean {
  return passiveIncome(s) >= totalExpenses(s);
}

/**
 * What the player ACHIEVED, as opposed to where their books stand this moment.
 *
 * `hasEscaped` is a live reading — "is passive income covering expenses right
 * now" — and it is the right question while the player is still in the Rat Race,
 * because that is the bar they are trying to clear. It is the wrong question once
 * they have cleared it. `status` latches the achievement (`engine.ts` sets
 * "escaped" on the turn they escape and "won" on the dream purchase or the Fast
 * Track goal); the live reading can go false again afterwards and commonly does,
 * because a Fast Track setback forces a bank loan whose 10%/month payment pushes
 * expenses back above passive income.
 *
 * The two were being used interchangeably, and a run that WON while carrying that
 * loan was recorded, ranked and shared as "Still Racing" — the verdict for never
 * having escaped at all.
 */
export function cashflowEscaped(s: Pick<CashflowState, "status">): boolean {
  return s.status === "escaped" || s.status === "won";
}

// ── Balance sheet ──────────────────────────────────────────────────────────────
/** The live quote for a ticker, falling back to what the holding cost. */
export function quote(s: CashflowState, symbol: string, fallback = 0): number {
  const q = s.stockPrices?.[symbol];
  return typeof q === "number" && q > 0 ? q : fallback;
}

export function stocksValue(s: CashflowState): number {
  return Math.round(s.stocks.reduce((t, h) => t + h.shares * quote(s, h.symbol, h.costBasis), 0));
}

/** Unrealized gain/loss across the whole stock book. */
export function stocksUnrealized(s: CashflowState): number {
  return Math.round(
    s.stocks.reduce((t, h) => t + h.shares * (quote(s, h.symbol, h.costBasis) - h.costBasis), 0),
  );
}

// ── Per-holding EQUITY (display only) ────────────────────────────────────────
// These are net of the holding's own debt, so they must NEVER be combined with
// `totalLiabilities` — that double-counts the principal. Net worth was doing
// exactly that: a $520k building with a $450k mortgage contributed −$380,000
// instead of +$70,000. The balance sheet below is gross-on-gross instead.
export function realEstateEquity(s: CashflowState): number {
  return Math.round(s.realEstate.reduce((t, h) => t + (h.price - h.mortgage), 0));
}

export function businessEquity(s: CashflowState): number {
  return Math.round(s.businesses.reduce((t, h) => t + (h.price - h.liability), 0));
}

export function realEstateValue(s: CashflowState): number {
  return Math.round(s.realEstate.reduce((t, h) => t + h.price, 0));
}

export function businessValue(s: CashflowState): number {
  return Math.round(s.businesses.reduce((t, h) => t + h.price, 0));
}

/** GROSS assets — what you own, before what you owe on it. */
export function totalAssets(s: CashflowState): number {
  return Math.round(s.cash + stocksValue(s) + realEstateValue(s) + businessValue(s));
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

/** The one identity the statement has to reconcile: assets − liabilities. */
export function netWorth(s: CashflowState): number {
  return Math.round(totalAssets(s) - totalLiabilities(s));
}

// ── The bank ───────────────────────────────────────────────────────────────────
/**
 * Everything the player owes each month EXCEPT the bank payment. The ceiling has
 * to be measured against this and never against `totalExpenses`: the bank payment
 * is itself an expense, so a limit keyed on total expenses would grow every time
 * the loan grew — the runaway the ceiling exists to stop.
 */
export function lifestyleExpenses(s: CashflowState): number {
  return totalExpenses(s) - bankLoanPayment(s);
}

/** Months of living costs the bank will extend to anyone, however small the salary. */
export const BANK_FLOOR_MONTHS = 18;

/** The bank lends in whole thousands — the ceiling is quantised to match. */
export const BANK_UNIT = 1000;

/**
 * The credit ceiling. Uncapped, `clampCash` turned every shortfall into
 * `bankLoan_{n+1} ≈ 1.1 × bankLoan_n + deficit`: an exponential spiral with no
 * bottom, and `"lost"` was a status nothing ever assigned, so a hopeless run
 * never ended.
 *
 * `5 × income` is the headline (at 10%/month that caps the payment near half of
 * income). It is not enough on its own: the low-salary professions have so
 * little rope that a Downsized-plus-doodad opening killed a Janitor on turn 3 —
 * an unsurvivable start, not a lesson. The floor of 18 months of lifestyle costs
 * is what makes an early run recoverable; verified worst case is now turn 6 for
 * every profession (see the balance notes in the Stage 2A report).
 */
export function maxBankLoan(s: CashflowState): number {
  // Quantised to the $1,000 unit the bank actually lends in. An arbitrary integer
  // ceiling can never be reached by thousand-dollar draws, so the last $1–$999 was
  // permanently unreachable while every surface kept offering it.
  const raw = Math.max(5 * totalIncome(s), BANK_FLOOR_MONTHS * lifestyleExpenses(s));
  // Never below what is already drawn. Clearing a liability removes its expense
  // line, which shrinks this ceiling — so the game's own recommended move could
  // leave a player who was at the limit retroactively OVER it, at zero headroom
  // and one bill from bankruptcy. Paying down debt must not be punished.
  return Math.max(Math.floor(raw / BANK_UNIT) * BANK_UNIT, s.liabilities.bankLoan);
}

/** How much more the bank will lend right now. */
export function bankHeadroom(s: CashflowState): number {
  return Math.max(0, maxBankLoan(s) - s.liabilities.bankLoan);
}

/**
 * Can this player actually pay this down payment?
 *
 * Cash plus every dollar the bank will still lend. Below that line a purchase is
 * not "expensive", it is impossible, and completing it anyway is how a $90,000
 * property was landing on an $800 balance sheet for $18,800: `clampCash` borrows
 * what it can, writes the rest off, and ends the run — while the buy went ahead
 * and added the holding regardless. The player finished bankrupt, owning the
 * asset, with a HIGHER leaderboard score than for playing on.
 */
export function canAffordDown(s: CashflowState, downPayment: number): boolean {
  return s.cash + Math.max(0, bankHeadroom(s)) >= downPayment;
}

/** Fraction of the ceiling already used, 0..1+. Warn past ~0.6. */
export function bankLoanStress(s: CashflowState): number {
  const cap = maxBankLoan(s);
  return cap <= 0 ? 1 : s.liabilities.bankLoan / cap;
}

/**
 * Starting liabilities never amortize, so their expense lines are a permanently
 * unreducible slab of the freedom denominator. Paying one off outright is the
 * classic freedom-raising move — and the meter's second lever, next to buying
 * assets. Maps each payable balance to the expense line it kills.
 */
export const PAYOFF_LINES: { key: PayoffKey; label: string; hint: string }[] = [
  { key: "creditCard", label: "Credit Card", hint: "The most expensive debt per dollar — kill it first." },
  { key: "retail", label: "Retail Debt", hint: "Small balance, real monthly bite." },
  { key: "carLoan", label: "Car Loan", hint: "A depreciating asset you are still paying for." },
  { key: "schoolLoan", label: "School Loan", hint: "Cheap debt, but the payment still counts against freedom." },
  { key: "homeMortgage", label: "Home Mortgage", hint: "Your biggest line — and the biggest single jump in freedom." },
];

export function canPayoff(s: CashflowState, key: PayoffKey): boolean {
  const bal = s.liabilities[key];
  return bal > 0 && s.cash >= bal;
}

/** What clearing this balance does to the Freedom meter, in points. */
export function payoffFreedomGain(s: CashflowState, key: PayoffKey): number {
  const bal = s.liabilities[key];
  if (bal <= 0) return 0;
  const after: CashflowState = {
    ...s,
    cash: s.cash - bal,
    liabilities: { ...s.liabilities, [key]: 0 },
    expenses: { ...s.expenses, [key]: 0 },
  };
  return Math.max(0, freedomPct(after) - freedomPct(s));
}

// ── Deal analysis (the coach math) ──────────────────────────────────────────────
/** Cash-on-cash return: annual cash flow ÷ cash invested, as a percent. */
export function cashOnCash(annualCashFlow: number, cashInvested: number): number {
  if (cashInvested <= 0) return 0;
  return (annualCashFlow / cashInvested) * 100;
}

/** How many whole shares `cash` buys at `price`. */
export function maxAffordable(cash: number, price: number): number {
  if (price <= 0) return 0;
  // Both sides in whole cents. Quotes carry two decimals, so `cash / price` in
  // floating point can hand back a share count whose cost then exceeds `cash` by
  // ~1e-13 — enough to leave the engine holding negative cash, which the next
  // `clampCash` reads as a shortfall and answers with a phantom $1,000 loan at
  // 10%/mo (or, at the ceiling, a bankruptcy). $1,003 of PLSE at $2.95 did it.
  const cents = Math.round(cash * 100);
  const priceCents = Math.round(price * 100);
  if (priceCents <= 0) return 0;
  return Math.max(0, Math.floor(cents / priceCents));
}

/** Dividend yield for a stock at a given price, as a percent (annualized). */
export function dividendYield(monthlyDividend: number, price: number): number {
  if (price <= 0) return 0;
  return ((monthlyDividend * 12) / price) * 100;
}
