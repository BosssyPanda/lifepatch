import type { FastSquare, FastSquareType, RatSquare, RatSquareType } from "./types";

// ── Rat Race ring: 24 squares ──────────────────────────────────────────────────
// Heavy on Opportunity (deal) squares so players are always being offered assets.
//
// Paydays sit at 5 / 13 / 21 — exactly 8 apart, so every "month" is the same
// length. They used to sit at 5 / 11 / 19, which made months 6, 8 and 10 steps
// long: a Downsized on a 6-step month cost far less than the same card on a
// 10-step one, for no reason a player could see. The type counts and the ring
// size are unchanged (12 deal / 3 doodad / 2 charity / 3 payday / 2 market /
// 1 baby / 1 downsized), so saved `position` values stay valid.
const RAT_PATTERN: RatSquareType[] = [
  "deal", "doodad", "deal", "charity", "deal", "payday",
  "deal", "market", "deal", "doodad", "deal", "baby",
  "deal", "payday", "deal", "doodad", "deal", "market",
  "deal", "downsized", "deal", "payday", "deal", "charity",
];

export const RAT_BOARD: RatSquare[] = RAT_PATTERN.map((type, index) => ({ index, type }));
export const RAT_SIZE = RAT_BOARD.length;

// ── Fast Track ring: 16 squares (condensed victory lap) ────────────────────────
const FAST_PATTERN: FastSquareType[] = [
  "ftdeal", "cashflowday", "ftdeal", "dream", "ftdeal", "cashflowday",
  "ftdeal", "ftloss", "ftdeal", "cashflowday", "ftdeal", "dream",
  "ftdeal", "cashflowday", "ftdeal", "ftloss",
];

export const FAST_BOARD: FastSquare[] = FAST_PATTERN.map((type, index) => ({ index, type }));
export const FAST_SIZE = FAST_BOARD.length;

/**
 * What a square is called, in two registers.
 *
 * `short` is the word STAMPED ON THE TILE, and it is a plain English word on
 * purpose: the ring used to read `$$$ · MKT · GIVE · FIRED`, which a fourteen-
 * year-old opening the game for the first time cannot decode. A code is only
 * worth its ambiguity when the space genuinely runs out, and at 390px it does
 * not — `BoardView` sizes the chip type off the board, so the longest of these
 * ("LAID OFF", set one word per line) fits the smallest tile the layout draws.
 *
 * `label` is the full name for prose: the hover/settle readout, the landing
 * page's per-type tally, the run log's `landedOn`, and the `title` a tile
 * exposes on hover. It is allowed to be longer and more specific than `short`
 * ("Opportunity" for a DEAL square) — that is the point of having two.
 *
 * The Cashflow-101 term "doodad" is still taught, by the card and the glossary
 * that exist to teach it. It just isn't the first thing a new player has to
 * translate to understand the board.
 */
export const RAT_SQUARE_META: Record<RatSquareType, { label: string; short: string }> = {
  deal: { label: "Opportunity", short: "DEAL" },
  doodad: { label: "Expense", short: "EXPENSE" },
  charity: { label: "Charity", short: "CHARITY" },
  payday: { label: "Payday", short: "PAYDAY" },
  market: { label: "The Market", short: "MARKET" },
  baby: { label: "New Baby", short: "BABY" },
  downsized: { label: "Laid Off", short: "LAID OFF" },
};

export const FAST_SQUARE_META: Record<FastSquareType, { label: string; short: string }> = {
  ftdeal: { label: "Investment", short: "INVEST" },
  // A landing here pays twelve months at once (engine: CASHFLOW_DAY_MONTHS) — up
  // on the Fast Track time runs in years, so the square is named for what it pays.
  cashflowday: { label: "Cash Flow Year", short: "PAYDAY" },
  dream: { label: "Your Dream", short: "DREAM" },
  ftloss: { label: "Setback", short: "SETBACK" },
};
