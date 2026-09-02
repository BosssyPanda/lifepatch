// ── ESCAPE THE RAT RACE — core domain types ──────────────────────────────────
// A self-contained CASHFLOW-style model. All figures are monthly unless noted.
// Originality: professions, decks, tickers, dreams, and all dollar values are
// invented — modeled on the genre, never copied from any published game.

export type Track = "rat" | "fast";
export type CashflowStatus = "playing" | "escaped" | "won" | "lost";

// ── Profession (sets the starting financial statement) ───────────────────────
export type Profession = {
  id: string;
  title: string;
  blurb: string;
  difficulty: 1 | 2 | 3 | 4 | 5; // higher = harder to escape
  salary: number;
  // fixed monthly expense lines
  taxes: number;
  homeMortgage: number;
  schoolLoan: number;
  carLoan: number;
  creditCard: number;
  retail: number;
  other: number;
  perChild: number;
  // starting liability balances
  liab: {
    homeMortgage: number;
    schoolLoan: number;
    carLoan: number;
    creditCard: number;
    retail: number;
  };
  startingCash: number;
};

// ── Dream (Fast Track win target) ────────────────────────────────────────────
export type Dream = {
  id: string;
  title: string;
  blurb: string;
  cost: number;
};

// ── Holdings (assets on the balance sheet) ───────────────────────────────────
export type StockHolding = {
  uid: string;
  symbol: string;
  name: string;
  shares: number;
  costBasis: number; // average price paid per share
  dividend: number; // monthly dividend per share (often 0)
};

/** The keys of `Liabilities` a player can pay off outright from cash. */
export type PayoffKey = "homeMortgage" | "schoolLoan" | "carLoan" | "creditCard" | "retail";

export type RealEstateHolding = {
  uid: string;
  label: string;
  propertyType: string; // "house" | "duplex" | "plex" | "land" | "commercial"
  price: number;
  downPayment: number;
  mortgage: number; // remaining loan attached to this property
  cashFlow: number; // monthly net cash flow (already net of its mortgage)
  units: number;
};

export type BusinessHolding = {
  uid: string;
  label: string;
  price: number;
  downPayment: number;
  liability: number;
  cashFlow: number; // monthly net
};

export type Expenses = {
  taxes: number;
  homeMortgage: number;
  schoolLoan: number;
  carLoan: number;
  creditCard: number;
  retail: number;
  other: number;
};

export type Liabilities = {
  homeMortgage: number;
  schoolLoan: number;
  carLoan: number;
  creditCard: number;
  retail: number;
  bankLoan: number; // borrowed in $1,000 units; payment = 10% of balance / month
};

// ── Decks ────────────────────────────────────────────────────────────────────
export type StockDeal = {
  kind: "stock";
  id: string;
  symbol: string;
  name: string;
  price: number; // per share now
  dividend: number; // monthly per share
  range: [number, number]; // typical low/high (teaching context)
  lesson: string;
};

export type RealEstateDeal = {
  kind: "realestate";
  id: string;
  label: string;
  propertyType: string;
  price: number;
  downPayment: number;
  mortgage: number;
  cashFlow: number;
  units: number;
  lesson: string;
};

export type BusinessDeal = {
  kind: "business";
  id: string;
  label: string;
  price: number;
  downPayment: number;
  liability: number;
  cashFlow: number;
  lesson: string;
};

export type Deal = StockDeal | RealEstateDeal | BusinessDeal;

export type DoodadCard = {
  id: string;
  label: string;
  cost: number;
  flavor: string;
  lesson: string;
};

/**
 * Sale cards quote a *multiple of what the holding cost*, not a flat price, plus a
 * `spread` of genuine variance resolved off the run's RNG. A flat price meant one
 * card was a guaranteed 83% arbitrage every time it appeared (and a flat price for
 * a whole propertyType paid the same for a $30k fixer as a $52k condo). A multiple
 * below 1 — or a wide spread straddling it — is what makes selling a real decision.
 */
export type SaleTerms = {
  multiple: number; // centre of the offer, × the holding's purchase price
  spread: number; // ± fraction of the multiple actually offered (0.25 = ±25%)
};

export type MarketCard =
  | ({
      kind: "propertySale";
      id: string;
      title: string;
      propertyType: string;
      flavor: string;
      lesson: string;
    } & SaleTerms)
  | ({
      kind: "businessSale";
      id: string;
      title: string;
      flavor: string;
      lesson: string;
    } & SaleTerms)
  | {
      // A market report: every quoted share price moves, and you may sell into it.
      kind: "stockMarket";
      id: string;
      title: string;
      drift: number; // centre of the move, e.g. -0.12 = a 12% average drawdown
      flavor: string;
      lesson: string;
    }
  | {
      kind: "windfall";
      id: string;
      title: string;
      cash: number; // +/-, applied immediately
      flavor: string;
      lesson: string;
    };

export type FastTrackDeal = {
  id: string;
  label: string;
  price: number; // cash cost
  cashFlow: number; // monthly cash flow added
  flavor: string;
};

// ── Board ─────────────────────────────────────────────────────────────────────
export type RatSquareType =
  | "deal"
  | "doodad"
  | "charity"
  | "payday"
  | "market"
  | "baby"
  | "downsized";

export type FastSquareType = "ftdeal" | "cashflowday" | "dream" | "ftloss";

export type RatSquare = { index: number; type: RatSquareType };
export type FastSquare = { index: number; type: FastSquareType };

// ── Turn log ──────────────────────────────────────────────────────────────────
export type TurnRecord = {
  turn: number;
  track: Track;
  roll: number;
  landedOn: string;
  note: string;
  payday: number;
  passiveIncome: number;
};

// ── The full game state ────────────────────────────────────────────────────────
export type CashflowState = {
  version: number;
  seed: number;
  rngCursor: number;
  professionId: string;
  dreamId: string;
  playerName: string;

  salary: number;
  expenses: Expenses;
  liabilities: Liabilities;
  children: number;
  perChild: number;

  cash: number;
  stocks: StockHolding[];
  realEstate: RealEstateHolding[];
  businesses: BusinessHolding[];
  /** Live quote per ticker. Stocks are valued at this, not at what you paid, so a
   *  non-dividend stock can actually deliver (or destroy) the capital gain its card
   *  promises. Seeded from the deck and moved by "The Market". */
  stockPrices: Record<string, number>;

  /** Net worth at turn 0. The solvency drag measures value DESTROYED against this,
   *  never against zero — every profession starts deeply underwater by design. */
  startingNetWorth: number;
  /** Cumulative bank-loan interest already paid at Payday. The debt-spiral receipt. */
  interestPaid: number;

  track: Track;
  position: number;
  turn: number;
  skipTurns: number; // downsized
  /** Two-dice rolls still BANKED, not turns still running. Only a roll that
   *  actually took the two-dice option spends one (see `consumeCharityRoll` and
   *  `useCashflowTurn`), so the benefit keeps until it is used. */
  charityRolls: number;

  fastTrackCashflow: number; // extra monthly cash flow earned on the Fast Track
  dreamPurchased: boolean;

  status: CashflowStatus;
  escapedOnTurn: number | null;
  /** Why the run ended in `"lost"` — shown on the recap. Null while solvent. */
  lostReason: string | null;

  log: TurnRecord[];

  // teaching progress
  tutorialDone: boolean;
  seenLessons: string[];
  quizzesPassed: number;
  dealsBought: number;
};
