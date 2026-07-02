import { FAST_BOARD, FAST_SIZE, RAT_BOARD, RAT_SIZE } from "./board";
import { BIG_DEALS, DOODADS, MARKET_CARDS, SMALL_DEALS } from "./decks";
import { FAST_TRACK_CASHFLOW_GOAL, getDream } from "./dreams";
import { FT_LOSS_AMOUNT } from "./messages";
import { getProfession } from "./professions";
import { pickIndex, rollDice as rollDiceRaw } from "./rng";
import {
  bankLoanPayment,
  hasEscaped,
  passiveIncome,
  payday,
  totalExpenses,
  totalIncome,
} from "./selectors";
import type {
  BusinessDeal,
  CashflowState,
  Deal,
  DoodadCard,
  FastTrackDeal,
  MarketCard,
  RealEstateDeal,
  StockDeal,
  TurnRecord,
} from "./types";

export const STATE_VERSION = 1;
const BANK_UNIT = 1000;

function uid(s: CashflowState, prefix: string): string {
  return `${prefix}-${s.seed.toString(36)}-${s.rngCursor.toString(36)}`;
}

function clampCash(s: CashflowState): CashflowState {
  // Never let cash go negative: auto-borrow from the bank (rounded to $1,000),
  // which adds a brutal 10%/mo payment. The squeeze IS the lesson.
  if (s.cash >= 0) return s;
  const need = Math.ceil(-s.cash / BANK_UNIT) * BANK_UNIT;
  return {
    ...s,
    cash: s.cash + need,
    liabilities: { ...s.liabilities, bankLoan: s.liabilities.bankLoan + need },
  };
}

// ── Init ────────────────────────────────────────────────────────────────────
export function initCashflow(professionId: string, dreamId: string, name: string): CashflowState {
  const p = getProfession(professionId);
  return {
    version: STATE_VERSION,
    seed: Math.floor(Math.random() * 1e9),
    rngCursor: 0,
    professionId: p.id,
    dreamId: getDream(dreamId).id,
    playerName: name.trim() || "Player",

    salary: p.salary,
    expenses: {
      taxes: p.taxes,
      homeMortgage: p.homeMortgage,
      schoolLoan: p.schoolLoan,
      carLoan: p.carLoan,
      creditCard: p.creditCard,
      retail: p.retail,
      other: p.other,
    },
    liabilities: {
      homeMortgage: p.liab.homeMortgage,
      schoolLoan: p.liab.schoolLoan,
      carLoan: p.liab.carLoan,
      creditCard: p.liab.creditCard,
      retail: p.liab.retail,
      bankLoan: 0,
    },
    children: 0,
    perChild: p.perChild,

    cash: p.startingCash,
    stocks: [],
    realEstate: [],
    businesses: [],

    track: "rat",
    position: 0,
    turn: 0,
    skipTurns: 0,
    charityRolls: 0,

    fastTrackCashflow: 0,
    dreamPurchased: false,

    status: "playing",
    escapedOnTurn: null,

    log: [],
    tutorialDone: false,
    seenLessons: [],
    quizzesPassed: 0,
    dealsBought: 0,
  };
}

// ── Dice ──────────────────────────────────────────────────────────────────────
export type RollResult = { rolls: number[]; total: number; next: CashflowState };

export function canRollTwo(s: CashflowState): boolean {
  return s.track === "fast" || s.charityRolls > 0;
}

export function roll(s: CashflowState, count: number): RollResult {
  const rolls = rollDiceRaw(s.seed, s.rngCursor, count);
  const total = rolls.reduce((t, n) => t + n, 0);
  return { rolls, total, next: { ...s, rngCursor: s.rngCursor + count } };
}

// ── Movement ────────────────────────────────────────────────────────────────
export type MoveResult = {
  state: CashflowState;
  landedType: string;
  paydaysPassed: number;
  paydayAmount: number;
};

export function applyMove(s: CashflowState, steps: number): MoveResult {
  if (s.track === "rat") {
    let pos = s.position;
    let paid = 0;
    for (let i = 0; i < steps; i++) {
      pos = (pos + 1) % RAT_SIZE;
      if (RAT_BOARD[pos].type === "payday") paid++;
    }
    const amount = payday(s);
    const state = clampCash({ ...s, position: pos, cash: s.cash + amount * paid });
    return { state, landedType: RAT_BOARD[pos].type, paydaysPassed: paid, paydayAmount: amount };
  }
  // fast track: no pass-payments; cash flow only on landing a Cash Flow Day
  const pos = (s.position + steps) % FAST_SIZE;
  return { state: { ...s, position: pos }, landedType: FAST_BOARD[pos].type, paydaysPassed: 0, paydayAmount: 0 };
}

// ── Deck draws ────────────────────────────────────────────────────────────────
function draw<T>(s: CashflowState, deck: T[]): { card: T; next: CashflowState } {
  const idx = pickIndex(s.seed, s.rngCursor, deck.length);
  return { card: deck[idx], next: { ...s, rngCursor: s.rngCursor + 1 } };
}

export const drawSmallDeal = (s: CashflowState) => draw<Deal>(s, SMALL_DEALS);
export const drawBigDeal = (s: CashflowState) => draw<Deal>(s, BIG_DEALS);
export const drawDoodad = (s: CashflowState) => draw<DoodadCard>(s, DOODADS);
export const drawMarket = (s: CashflowState) => draw<MarketCard>(s, MARKET_CARDS);

// ── Buying assets ─────────────────────────────────────────────────────────────
export function maxAffordableShares(s: CashflowState, deal: StockDeal): number {
  return Math.max(0, Math.floor(s.cash / deal.price));
}

export function buyStock(s: CashflowState, deal: StockDeal, shares: number): CashflowState {
  const n = Math.max(0, Math.floor(shares));
  if (n <= 0) return s;
  const cost = n * deal.price;
  const existing = s.stocks.find((h) => h.symbol === deal.symbol);
  let stocks;
  if (existing) {
    const totalShares = existing.shares + n;
    const newBasis = (existing.shares * existing.costBasis + cost) / totalShares;
    stocks = s.stocks.map((h) =>
      h.uid === existing.uid ? { ...h, shares: totalShares, costBasis: newBasis } : h,
    );
  } else {
    stocks = [
      ...s.stocks,
      { uid: uid(s, "stk"), symbol: deal.symbol, name: deal.name, shares: n, costBasis: deal.price, dividend: deal.dividend },
    ];
  }
  return { ...s, cash: s.cash - cost, stocks, dealsBought: s.dealsBought + 1, rngCursor: s.rngCursor + 1 };
}

export function sellStock(s: CashflowState, symbol: string, shares: number, price: number): CashflowState {
  const h = s.stocks.find((x) => x.symbol === symbol);
  if (!h) return s;
  const n = Math.min(shares, h.shares);
  const stocks = h.shares - n <= 0
    ? s.stocks.filter((x) => x.uid !== h.uid)
    : s.stocks.map((x) => (x.uid === h.uid ? { ...x, shares: x.shares - n } : x));
  return { ...s, cash: s.cash + n * price, stocks };
}

export function buyRealEstate(s: CashflowState, deal: RealEstateDeal): CashflowState {
  const base = clampCash({ ...s, cash: s.cash - deal.downPayment });
  return {
    ...base,
    realEstate: [
      ...base.realEstate,
      {
        uid: uid(s, "re"),
        label: deal.label,
        propertyType: deal.propertyType,
        price: deal.price,
        downPayment: deal.downPayment,
        mortgage: deal.mortgage,
        cashFlow: deal.cashFlow,
        units: deal.units,
      },
    ],
    dealsBought: s.dealsBought + 1,
    rngCursor: s.rngCursor + 1,
  };
}

export function buyBusiness(s: CashflowState, deal: BusinessDeal): CashflowState {
  const base = clampCash({ ...s, cash: s.cash - deal.downPayment });
  return {
    ...base,
    businesses: [
      ...base.businesses,
      { uid: uid(s, "biz"), label: deal.label, price: deal.price, downPayment: deal.downPayment, liability: deal.liability, cashFlow: deal.cashFlow },
    ],
    dealsBought: s.dealsBought + 1,
    rngCursor: s.rngCursor + 1,
  };
}

// ── Square resolutions ────────────────────────────────────────────────────────
export function payDoodad(s: CashflowState, cost: number): CashflowState {
  return clampCash({ ...s, cash: s.cash - cost });
}

export function charityCost(s: CashflowState): number {
  return Math.round(totalIncome(s) * 0.1);
}

export function donateCharity(s: CashflowState): CashflowState {
  return clampCash({ ...s, cash: s.cash - charityCost(s), charityRolls: 3 });
}

export function addBaby(s: CashflowState): CashflowState {
  return { ...s, children: Math.min(s.children + 1, 3) };
}

export function applyDownsized(s: CashflowState): CashflowState {
  const cost = totalExpenses(s);
  return clampCash({ ...s, cash: s.cash - cost, skipTurns: 2 });
}

export function applyWindfall(s: CashflowState, card: Extract<MarketCard, { kind: "windfall" }>): CashflowState {
  return clampCash({ ...s, cash: s.cash + card.cash });
}

/** Sell one property matching a market card; you net salePrice − mortgage. */
export function sellProperty(s: CashflowState, propUid: string, salePrice: number): CashflowState {
  const h = s.realEstate.find((x) => x.uid === propUid);
  if (!h) return s;
  return {
    ...s,
    cash: s.cash + (salePrice - h.mortgage),
    realEstate: s.realEstate.filter((x) => x.uid !== h.uid),
  };
}

/** Sell one business at a ~50% premium over its purchase price. */
export function businessSalePrice(price: number): number {
  return Math.round(price * 1.5);
}

export function sellBusiness(s: CashflowState, bizUid: string): CashflowState {
  const h = s.businesses.find((x) => x.uid === bizUid);
  if (!h) return s;
  return {
    ...s,
    cash: s.cash + (businessSalePrice(h.price) - h.liability),
    businesses: s.businesses.filter((x) => x.uid !== h.uid),
  };
}

// ── Bank ───────────────────────────────────────────────────────────────────────
export function borrow(s: CashflowState, amount: number): CashflowState {
  const units = Math.ceil(amount / BANK_UNIT) * BANK_UNIT;
  if (units <= 0) return s;
  return { ...s, cash: s.cash + units, liabilities: { ...s.liabilities, bankLoan: s.liabilities.bankLoan + units } };
}

export function repayBankLoan(s: CashflowState, amount: number): CashflowState {
  const units = Math.min(Math.floor(amount / BANK_UNIT) * BANK_UNIT, s.liabilities.bankLoan, Math.floor(s.cash / BANK_UNIT) * BANK_UNIT);
  if (units <= 0) return s;
  return { ...s, cash: s.cash - units, liabilities: { ...s.liabilities, bankLoan: s.liabilities.bankLoan - units } };
}

// ── Escape + Fast Track ─────────────────────────────────────────────────────────
export function markEscaped(s: CashflowState): CashflowState {
  if (s.status !== "playing" || s.track !== "rat") return s;
  if (!hasEscaped(s)) return s;
  return { ...s, status: "escaped", escapedOnTurn: s.turn };
}

export function enterFastTrack(s: CashflowState): CashflowState {
  const bonus = Math.max(passiveIncome(s) * 100, 150000);
  return { ...s, track: "fast", position: 0, cash: s.cash + bonus, status: "playing", fastTrackCashflow: 0 };
}

/** Monthly cash flow on the Fast Track = carried passive income + new FT cash flow. */
export function fastTrackMonthly(s: CashflowState): number {
  return passiveIncome(s) + s.fastTrackCashflow;
}

export function collectCashflowDay(s: CashflowState): CashflowState {
  return { ...s, cash: s.cash + fastTrackMonthly(s) };
}

export function applyFtLoss(s: CashflowState): CashflowState {
  return { ...s, cash: Math.max(0, s.cash - FT_LOSS_AMOUNT) };
}

export function canAffordFt(s: CashflowState, deal: FastTrackDeal): boolean {
  return s.cash >= deal.price;
}

export function buyFastTrackDeal(s: CashflowState, deal: FastTrackDeal): CashflowState {
  if (s.cash < deal.price) return s;
  const next = { ...s, cash: s.cash - deal.price, fastTrackCashflow: s.fastTrackCashflow + deal.cashFlow };
  return checkFastWin(next);
}

export function buyDream(s: CashflowState): CashflowState {
  const d = getDream(s.dreamId);
  if (s.cash < d.cost) return s;
  return { ...s, cash: s.cash - d.cost, dreamPurchased: true, status: "won" };
}

export function checkFastWin(s: CashflowState): CashflowState {
  if (s.fastTrackCashflow >= FAST_TRACK_CASHFLOW_GOAL) return { ...s, status: "won" };
  return s;
}

// ── Turn bookkeeping ────────────────────────────────────────────────────────────
export function beginTurn(s: CashflowState): CashflowState {
  return { ...s, turn: s.turn + 1 };
}

export function consumeCharityRoll(s: CashflowState): CashflowState {
  return s.charityRolls > 0 ? { ...s, charityRolls: s.charityRolls - 1 } : s;
}

export function pushLog(s: CashflowState, rec: Omit<TurnRecord, "turn" | "track" | "payday" | "passiveIncome">): CashflowState {
  const entry: TurnRecord = {
    turn: s.turn,
    track: s.track,
    payday: payday(s),
    passiveIncome: passiveIncome(s),
    ...rec,
  };
  return { ...s, log: [...s.log, entry].slice(-60) };
}

export function markLessonSeen(s: CashflowState, id: string): CashflowState {
  return s.seenLessons.includes(id) ? s : { ...s, seenLessons: [...s.seenLessons, id] };
}

// re-exports the controller leans on
export { bankLoanPayment, hasEscaped, passiveIncome, payday, totalExpenses, totalIncome };
