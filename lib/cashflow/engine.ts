import { FAST_BOARD, FAST_SIZE, RAT_BOARD, RAT_SIZE } from "./board";
import {
  BIG_DEALS,
  DOODADS,
  MARKET_CARDS,
  SMALL_DEALS,
  STOCK_CATALOG,
  initialStockPrices,
} from "./decks";
import { FAST_TRACK_CASHFLOW_GOAL, getDream } from "./dreams";
import { FT_LOSS_MIN } from "./messages";
import { getProfession } from "./professions";
import { pickIndex, rngAt, rollDice as rollDiceRaw } from "./rng";
import {
  BANK_UNIT,
  bankHeadroom,
  canAffordDown,
  bankLoanPayment,
  hasEscaped,
  maxAffordable,
  maxBankLoan,
  netWorth,
  passiveIncome,
  payday,
  quote,
  totalExpenses,
  totalIncome,
} from "./selectors";
import type {
  BusinessDeal,
  BusinessHolding,
  CashflowState,
  Deal,
  DoodadCard,
  FastTrackDeal,
  MarketCard,
  PayoffKey,
  RealEstateDeal,
  RealEstateHolding,
  SaleTerms,
  StockDeal,
  TurnRecord,
} from "./types";

export const STATE_VERSION = 2;


/** The copy shown on the lose screen when the bank finally says no. */
export const BANKRUPT_REASON =
  "The bank stopped lending. Your bank loan hit its ceiling and there was no cash left to cover the bill.";

function uid(s: CashflowState, prefix: string): string {
  return `${prefix}-${s.seed.toString(36)}-${s.rngCursor.toString(36)}`;
}

/**
 * Cash can never be negative: the shortfall becomes a bank loan (rounded to
 * $1,000) at a brutal 10%/mo. The squeeze IS the lesson — but it now has a floor
 * AND a ceiling. Borrowing stops at `maxBankLoan`, and a shortfall the bank will
 * not cover ends the run. Before this, `bankLoan_{n+1} ≈ 1.1 × bankLoan_n +
 * deficit` compounded forever and `"lost"` was a status nothing ever assigned, so
 * a hopeless run simply never ended.
 */
function clampCash(s: CashflowState): CashflowState {
  if (s.cash >= 0) return s;
  const shortfall = -s.cash;
  // `bankHeadroom` is already quantised to whole $1,000 units, so the number the
  // Bank panel prints is the number that can actually be drawn. It used to floor
  // here and nowhere else, which left the loan parked at the largest multiple under
  // an arbitrary cap and headroom stranded in [$1, $999]: the panel advertised
  // "$320 left to borrow" and the next $50 bill ended the run. That accounted for
  // 26.6% of all bankruptcies.
  const room = Math.max(0, bankHeadroom(s));
  const borrowed = Math.min(Math.ceil(shortfall / BANK_UNIT) * BANK_UNIT, room);
  const next: CashflowState = {
    ...s,
    cash: s.cash + borrowed,
    liabilities: { ...s.liabilities, bankLoan: s.liabilities.bankLoan + borrowed },
  };
  if (next.cash >= 0) return next;
  // Still short with the bank tapped out. On the Fast Track the player has already
  // escaped — a setback there eats the balance, it does not un-win the game.
  if (next.track !== "rat" || next.status !== "playing") return { ...next, cash: 0 };
  return { ...next, cash: 0, status: "lost", lostReason: BANKRUPT_REASON };
}

// ── Init ────────────────────────────────────────────────────────────────────
export function initCashflow(
  professionId: string,
  dreamId: string,
  name: string,
  /** QA/replay hook: pin the run's RNG so a session is reproducible. */
  seed?: number,
): CashflowState {
  const p = getProfession(professionId);
  const startingLiabilities =
    p.liab.homeMortgage + p.liab.schoolLoan + p.liab.carLoan + p.liab.creditCard + p.liab.retail;
  return {
    version: STATE_VERSION,
    seed: Number.isFinite(seed) ? Math.abs(Math.floor(seed as number)) : Math.floor(Math.random() * 1e9),
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
    stockPrices: initialStockPrices(),

    // Everyone starts underwater — that is the premise, not a failure state. The
    // solvency drag measures against THIS, so leverage is judged on what it does
    // to you, not on the hole you were handed.
    startingNetWorth: p.startingCash - startingLiabilities,
    interestPaid: 0,

    track: "rat",
    position: 0,
    turn: 0,
    skipTurns: 0,
    charityRolls: 0,

    fastTrackCashflow: 0,
    dreamPurchased: false,

    status: "playing",
    escapedOnTurn: null,
    lostReason: null,

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
    const state = clampCash({
      ...s,
      position: pos,
      cash: s.cash + amount * paid,
      // the receipt the lose screen reads back: every dollar the bank took
      interestPaid: s.interestPaid + bankLoanPayment(s) * paid,
    });
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
  return maxAffordable(s.cash, quote(s, deal.symbol, deal.price));
}

export function buyStock(s: CashflowState, deal: StockDeal, shares: number): CashflowState {
  // Guarded in the engine, not just by the share stepper's clamp: an engine that
  // only behaves because one caller happens to bound its input is not a rule.
  const n = Math.min(Math.max(0, Math.floor(shares)), maxAffordableShares(s, deal));
  if (n <= 0) return s;
  const price = quote(s, deal.symbol, deal.price);
  // Settled in cents for the same reason the share count is counted in them.
  const cost = Math.round(n * price * 100) / 100;
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
      { uid: uid(s, "stk"), symbol: deal.symbol, name: deal.name, shares: n, costBasis: price, dividend: deal.dividend },
    ];
  }
  // Quantised, not just `s.cash - cost`. Both operands are whole cents, but their
  // float difference is not: it lands ~1e-13 either side, and this is the only
  // cash write in the engine that can produce a sub-cent balance at all (every
  // other one moves whole dollars). That dirt is not cosmetic — it is read back by
  // `maxAffordable`, which counts a budget in whole cents and rounded the dirty
  // balance UP, handing out one share too many; the buy then drove cash negative
  // by a fraction of a cent and the next `applyMove`'s `clampCash` converted it
  // into a genuine $1,000 bank loan at 10%/mo. Settling to the cent here keeps the
  // invariant `maxAffordable` depends on, and fixes it for every future reader.
  const cash = Math.round((s.cash - cost) * 100) / 100;
  return { ...s, cash, stocks, dealsBought: s.dealsBought + 1, rngCursor: s.rngCursor + 1 };
}

/** Sell shares at today's quote. This is the only way a capital gain is ever realized. */
export function sellStock(s: CashflowState, symbol: string, shares: number): CashflowState {
  const h = s.stocks.find((x) => x.symbol === symbol);
  if (!h) return s;
  const n = Math.min(Math.max(0, Math.floor(shares)), h.shares);
  if (n <= 0) return s;
  const price = quote(s, symbol, h.costBasis);
  const stocks =
    h.shares - n <= 0
      ? s.stocks.filter((x) => x.uid !== h.uid)
      : s.stocks.map((x) => (x.uid === h.uid ? { ...x, shares: x.shares - n } : x));
  // Settled in cents, because the debit already is. `Math.round` to whole dollars
  // is half-up, so a sale at an UNCHANGED quote returned up to $0.50 more than the
  // position cost — a slow faucet in the one mode whose leaderboard ranks on
  // `netWorth`, and money the ledger cannot reconcile in a game whose whole premise
  // is a reconcilable ledger. `buyStock` moved to cents to kill the phantom $1,000
  // loan; this is the other half of the same convention, and quantising the SUM
  // (not just the proceeds) is what actually holds the whole-cent invariant that
  // `maxAffordable` reads back out of `cash`.
  const proceeds = Math.round(n * price * 100) / 100;
  const cash = Math.round((s.cash + proceeds) * 100) / 100;
  return { ...s, cash, stocks };
}

// ── The quote board ───────────────────────────────────────────────────────────
/**
 * How hard the published range pulls a quote that has left it.
 *
 * Applied in log space (see `tickStockPrices`), so it is a proportion of the
 * distance out rather than a number of dollars: at 0.5 a quote sitting at half its
 * floor is pulled back to ~71% of that floor — still outside, still falling if the
 * next shock is negative. 0 would be a pure random walk with no character per
 * ticker; 1 would be the hard wall this replaced.
 */
const BAND_PULL = 0.5;

/** No quote is ever worth exactly nothing, and a price of 0 would be absorbing. */
const MIN_QUOTE = 0.01;

/**
 * Move every quote. `drift` is the card's centre; each ticker then gets its own
 * RNG shock scaled by how wide its published range is, so PLSE stays a lottery
 * ticket and GRID stays a utility. Deterministic from (seed, cursor) like every
 * other draw, so a run replays exactly.
 *
 * THE RANGE IS A PULL, NOT A WALL — and it used to be a wall:
 *
 *     Math.max(lo, Math.min(hi, moved))
 *
 * The deal card publishes that same pair to the player under the label "Typical
 * range" (components/cashflow/cards/DealCard.tsx), so the engine was contradicting
 * its own card. It was also the most expensive contradiction in the game. A floor
 * that the player can see, reach, and rest on is a free put option: measured over
 * 200,000 ticks, quotes sat exactly on the published floor between 9.6% and 24.4%
 * of the time while the ceiling was touched 0.0–0.2%. At the floor the next move
 * could only be sideways or up. "Buy PLSE at $1.00" was therefore a position that
 * could not lose a cent and could pay $60 — not a decision, an arbitrage, and the
 * one lesson the Rat Race must never teach.
 *
 * So the band now reverts rather than clamps, in log space, which is the shape a
 * price actually has: outside the range a quote is pulled back by a FRACTION of how
 * far out it is, keeps its own multiplicative motion, and can keep falling. Nothing
 * above zero absorbs it. Buying low is still the right instinct — it is just a bet
 * again, which is the whole point of putting it on a card.
 */
export function tickStockPrices(s: CashflowState, drift: number): CashflowState {
  const prices: Record<string, number> = { ...s.stockPrices };
  STOCK_CATALOG.forEach((d, i) => {
    const [lo, hi] = d.range;
    const now = quote(s, d.symbol, d.price);
    const volatility = (hi - lo) / d.price; // GRID ≈ 0.87, PLSE ≈ 11.8
    const shock = (rngAt(s.seed, s.rngCursor + 101 + i) - 0.5) * 0.14 * Math.min(volatility, 4);
    let moved = now * (1 + drift * Math.min(1, volatility) + shock);
    // `x → edge * (x / edge)^(1 - BAND_PULL)` — the identity at the edge itself, so
    // there is no kink for a player to feel, and monotonic, so a bigger shock is
    // still a bigger move. Both branches are guarded on the edge being positive;
    // every published range is, but a zero would make the ratio undefined.
    if (moved > hi && hi > 0) moved = hi * Math.pow(moved / hi, 1 - BAND_PULL);
    else if (moved < lo && lo > 0) moved = lo * Math.pow(Math.max(moved, MIN_QUOTE) / lo, 1 - BAND_PULL);
    prices[d.symbol] = Math.max(MIN_QUOTE, Math.round(moved * 100) / 100);
  });
  return { ...s, stockPrices: prices, rngCursor: s.rngCursor + 1 };
}

export function buyRealEstate(s: CashflowState, deal: RealEstateDeal): CashflowState {
  // A deal you cannot cover is REFUSED, not completed at a discount. `clampCash`
  // borrows what it can and writes off the rest, so without this the balance sheet
  // gained the whole asset for whatever the player happened to have. The card
  // disables its own CTA (see DealCard); this is the guard that makes it true of
  // every caller.
  if (!canAffordDown(s, deal.downPayment)) return s;
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
  // Same shape, same refusal — see `buyRealEstate`.
  if (!canAffordDown(s, deal.downPayment)) return s;
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

// ── Selling assets at The Market ──────────────────────────────────────────────
/**
 * The offer on one holding, resolved from the card's terms and the run's RNG.
 * PURE and stable for a given (state, card, holding): the card shows this number
 * and the sale executes at this number, so the UI can never quote a price the
 * engine won't honour. A tiny per-uid hash keeps two identical duplexes from
 * fetching the identical offer.
 */
function uidNoise(uid: string): number {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) | 0;
  return Math.abs(h) % 97;
}

export function saleOffer(s: CashflowState, terms: SaleTerms, holdingUid: string, price: number): number {
  const r = rngAt(s.seed, s.rngCursor + 211 + uidNoise(holdingUid));
  const multiple = terms.multiple * (1 + (r * 2 - 1) * terms.spread);
  return Math.max(0, Math.round(price * Math.max(0.15, multiple)));
}

export function propertySaleOffer(s: CashflowState, terms: SaleTerms, h: RealEstateHolding): number {
  return saleOffer(s, terms, h.uid, h.price);
}

export function businessSaleOffer(s: CashflowState, terms: SaleTerms, h: BusinessHolding): number {
  return saleOffer(s, terms, h.uid, h.price);
}

/** Sell one property matching a market card; you net the offer − the mortgage. */
export function sellProperty(s: CashflowState, propUid: string, salePrice: number): CashflowState {
  const h = s.realEstate.find((x) => x.uid === propUid);
  if (!h) return s;
  return clampCash({
    ...s,
    cash: s.cash + (salePrice - h.mortgage),
    realEstate: s.realEstate.filter((x) => x.uid !== h.uid),
  });
}

export function sellBusiness(s: CashflowState, bizUid: string, salePrice: number): CashflowState {
  const h = s.businesses.find((x) => x.uid === bizUid);
  if (!h) return s;
  return clampCash({
    ...s,
    cash: s.cash + (salePrice - h.liability),
    businesses: s.businesses.filter((x) => x.uid !== h.uid),
  });
}

// ── Bank ───────────────────────────────────────────────────────────────────────
/** Deliberate borrowing, capped at the same ceiling the auto-borrow respects. */
export function borrow(s: CashflowState, amount: number): CashflowState {
  const room = Math.floor(bankHeadroom(s) / BANK_UNIT) * BANK_UNIT;
  const units = Math.min(Math.ceil(Math.max(0, amount) / BANK_UNIT) * BANK_UNIT, room);
  if (units <= 0) return s;
  return { ...s, cash: s.cash + units, liabilities: { ...s.liabilities, bankLoan: s.liabilities.bankLoan + units } };
}

export function repayBankLoan(s: CashflowState, amount: number): CashflowState {
  const units = Math.min(Math.floor(amount / BANK_UNIT) * BANK_UNIT, s.liabilities.bankLoan, Math.floor(s.cash / BANK_UNIT) * BANK_UNIT);
  if (units <= 0) return s;
  return { ...s, cash: s.cash - units, liabilities: { ...s.liabilities, bankLoan: s.liabilities.bankLoan - units } };
}

/**
 * Clear a starting liability outright — balance and its monthly expense line
 * together. Full payoff only: the balances carry no amortization schedule, so
 * partial payments would silently buy nothing. This is the second lever on the
 * Freedom meter (buying assets is the first), and it is the move that makes the
 * denominator of `freedomRatio` finally move.
 */
export function payoffLiability(s: CashflowState, key: PayoffKey): CashflowState {
  const balance = s.liabilities[key];
  if (balance <= 0 || s.cash < balance) return s;
  return {
    ...s,
    cash: s.cash - balance,
    liabilities: { ...s.liabilities, [key]: 0 },
    expenses: { ...s.expenses, [key]: 0 },
  };
}

// ── Escape + Fast Track ─────────────────────────────────────────────────────────
export function markEscaped(s: CashflowState): CashflowState {
  if (s.status !== "playing" || s.track !== "rat") return s;
  if (!hasEscaped(s)) return s;
  return { ...s, status: "escaped", escapedOnTurn: s.turn };
}

/** The Fast Track opens with a year of your own passive income, banked. */
export const FAST_TRACK_STAKE_MONTHS = 12;
/** ...and never less than this, so the smallest machine still gets a stake to play. */
export const FAST_TRACK_STAKE_MIN = 150000;

/**
 * The stake handed over on escape.
 *
 * It used to be `max(passiveIncome × 100, 150000)`, which is the genre's convention and
 * was the single reason the Fast Track never got played: a Doctor escaped with ~$950,000
 * against dreams that topped out at $250,000, so the second act was won on the first
 * DREAM square every time. Twelve months keeps the reward proportional to the machine the
 * player actually built (a bigger passive income still means a bigger stake AND a bigger
 * Cash Flow Year) while putting every dream out of reach on arrival — the cheapest is
 * $400,000, and the largest stake a normal escape produces is a little over half of that.
 */
export function fastTrackStake(s: CashflowState): number {
  return Math.max(FAST_TRACK_STAKE_MIN, passiveIncome(s) * FAST_TRACK_STAKE_MONTHS);
}

export function enterFastTrack(s: CashflowState): CashflowState {
  // Idempotent, because this is the one resolution handler committed with a
  // FUNCTIONAL updater — every other one hands `commit` a precomputed constant, so
  // a repeat click re-applies the same value harmlessly. This one composes, and the
  // escape ceremony stays mounted and clickable through its exit animation: four
  // clicks turned a $150,000 stake into $600,000 and cleared every dream the
  // rebalance had just put out of reach.
  if (s.track === "fast") return s;
  return { ...s, track: "fast", position: 0, cash: s.cash + fastTrackStake(s), status: "playing", fastTrackCashflow: 0 };
}

/** Monthly cash flow on the Fast Track = carried passive income + new FT cash flow. */
export function fastTrackMonthly(s: CashflowState): number {
  return passiveIncome(s) + s.fastTrackCashflow;
}

/**
 * Up here time runs in years, not months. A Cash Flow Day pays twelve months at once.
 *
 * This is the change that makes the Fast Track playable rather than a formality or a
 * grind. At one month a landing, a 25%-frequency square paying ≤$50,000 cannot fund the
 * half-million dollars of investments the +$50k/mo goal requires — the measured median
 * was 41 turns and the tail ran past 180. At twelve, the two win routes come in within a
 * few turns of each other and the board is actually played on the way.
 */
export const CASHFLOW_DAY_MONTHS = 12;

export function cashflowDayPayout(s: CashflowState): number {
  return fastTrackMonthly(s) * CASHFLOW_DAY_MONTHS;
}

export function collectCashflowDay(s: CashflowState): CashflowState {
  return { ...s, cash: s.cash + cashflowDayPayout(s) };
}

/** Half a Cash Flow Year, floored — see FT_LOSS_MIN. */
export const FT_LOSS_MONTHS = 6;

export function ftLossAmount(s: CashflowState): number {
  return Math.max(FT_LOSS_MIN, fastTrackMonthly(s) * FT_LOSS_MONTHS);
}

/**
 * A Fast-Track setback goes through the same borrow path as everything else. It
 * used to floor at `Math.max(0, cash - 20000)`, which meant a player holding
 * $3,000 lost $3,000 and a player holding $0 lost nothing at all — the one square
 * on the board that could not hurt you. It is now scaled to the player as well: a
 * flat figure next to a twelve-month payout is a rounding error, and a setback that
 * cannot be felt is not a setback.
 */
export function applyFtLoss(s: CashflowState): CashflowState {
  return clampCash({ ...s, cash: s.cash - ftLossAmount(s) });
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
export {
  bankHeadroom,
  bankLoanPayment,
  hasEscaped,
  maxBankLoan,
  netWorth,
  passiveIncome,
  payday,
  totalExpenses,
  totalIncome,
};
