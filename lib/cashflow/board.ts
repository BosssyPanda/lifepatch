import type { FastSquare, FastSquareType, RatSquare, RatSquareType } from "./types";

// ── Rat Race ring: 24 squares ──────────────────────────────────────────────────
// Heavy on Opportunity (deal) squares so players are always being offered assets.
const RAT_PATTERN: RatSquareType[] = [
  "deal", "doodad", "deal", "charity", "deal", "payday",
  "deal", "market", "deal", "doodad", "deal", "payday",
  "deal", "baby", "deal", "doodad", "deal", "market",
  "deal", "payday", "deal", "downsized", "deal", "charity",
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

export const RAT_SQUARE_META: Record<RatSquareType, { label: string; short: string }> = {
  deal: { label: "Opportunity", short: "DEAL" },
  doodad: { label: "Doodad", short: "$$$" },
  charity: { label: "Charity", short: "GIVE" },
  payday: { label: "Payday", short: "PAY" },
  market: { label: "The Market", short: "MKT" },
  baby: { label: "New Baby", short: "BABY" },
  downsized: { label: "Downsized", short: "FIRED" },
};

export const FAST_SQUARE_META: Record<FastSquareType, { label: string; short: string }> = {
  ftdeal: { label: "Investment", short: "BUY" },
  cashflowday: { label: "Cash Flow Day", short: "PAY" },
  dream: { label: "Your Dream", short: "DREAM" },
  ftloss: { label: "Setback", short: "LOSS" },
};
