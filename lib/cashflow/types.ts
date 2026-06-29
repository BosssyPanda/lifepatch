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

export type MarketCard =
  | {
      kind: "propertySale";
      id: string;
      title: string;
      propertyType: string;
      salePrice: number; // gross sale price per property
      flavor: string;
      lesson: string;
    }
  | {
      kind: "businessSale";
      id: string;
      title: string;
      salePrice: number;
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

  track: Track;
  position: number;
  turn: number;
  skipTurns: number; // downsized
  charityRolls: number; // turns remaining with 1-or-2 dice choice

  fastTrackCashflow: number; // extra monthly cash flow earned on the Fast Track
  dreamPurchased: boolean;

  status: CashflowStatus;
  escapedOnTurn: number | null;

  log: TurnRecord[];

  // teaching progress
  tutorialDone: boolean;
  seenLessons: string[];
  quizzesPassed: number;
  dealsBought: number;
};
