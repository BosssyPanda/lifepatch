import type { GameStats, StatKey, Tone } from "./types";

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function currency(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(Math.round(n));
  return `${sign}$${abs.toLocaleString("en-US")}`;
}

/** Soft caps so meters stay readable. Cash/debt are money; the rest are 0-100. */
export const STAT_BOUNDS: Record<StatKey, { min: number; max: number }> = {
  cash: { min: -2000, max: 20000 },
  debt: { min: 0, max: 60000 },
  credit: { min: 300, max: 850 },
  stress: { min: 0, max: 100 },
  skill: { min: 0, max: 100 },
  freedom: { min: 0, max: 100 },
};

/** For 0-100 style meters, what fraction is filled. Money meters use log-ish scaling. */
export function meterPct(key: StatKey, value: number): number {
  const b = STAT_BOUNDS[key];
  if (key === "cash") {
    return clamp(((value - b.min) / (b.max - b.min)) * 100, 0, 100);
  }
  if (key === "debt") {
    return clamp((value / b.max) * 100, 0, 100);
  }
  if (key === "credit") {
    return clamp(((value - b.min) / (b.max - b.min)) * 100, 0, 100);
  }
  return clamp(value, 0, 100);
}

/** Whether the current value is good/warning/bad for color coding. */
export function statStatus(key: StatKey, value: number): Tone {
  switch (key) {
    case "cash":
      return value < 100 ? "bad" : value < 600 ? "warning" : "good";
    case "debt":
      return value > 15000 ? "bad" : value > 3000 ? "warning" : "good";
    case "credit":
      return value < 580 ? "bad" : value < 670 ? "warning" : "good";
    case "stress":
      return value > 70 ? "bad" : value > 45 ? "warning" : "good";
    case "skill":
      return value < 25 ? "warning" : "good";
    case "freedom":
      return value < 30 ? "bad" : value < 55 ? "warning" : "good";
  }
}

/** Display value for a stat. */
export function statDisplay(key: StatKey, value: number): string {
  if (key === "cash" || key === "debt") return currency(value);
  if (key === "credit") return String(Math.round(value));
  return `${Math.round(value)}`;
}

/** A 0-100 "Freedom Score" derived from the full board. */
export function freedomScore(stats: GameStats): number {
  const cashScore = clamp((stats.cash / 6000) * 100, 0, 100);
  const debtPenalty = clamp((stats.debt / 30000) * 100, 0, 100);
  const creditScore = clamp(((stats.credit - 300) / 550) * 100, 0, 100);
  const score =
    stats.freedom * 0.4 +
    cashScore * 0.18 +
    creditScore * 0.12 +
    stats.skill * 0.14 +
    (100 - stats.stress) * 0.16 -
    debtPenalty * 0.25;
  return Math.round(clamp(score, 0, 100));
}
