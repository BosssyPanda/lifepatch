import { freedomScore } from "./format";
import type { GameStats, Totals } from "./types";

export type FinalClass = {
  title: string;
  emoji: string;
  blurb: string;
  color: "cash" | "debt" | "freedom" | "social";
};

/** Derive the Spotify-Wrapped-style "final class" from the board + run totals. */
export function deriveFinalClass(stats: GameStats, totals: Totals): FinalClass {
  const score = freedomScore(stats);
  const heavyDebt = stats.debt > 12000;
  const fakeRich =
    totals.debtTaken > 4000 && stats.cash > 1500 && stats.stress > 55;

  if (fakeRich) {
    return {
      title: "Fake Rich",
      emoji: "🪩",
      blurb:
        "Looked wealthy, financed the whole thing. The fit was immaculate; the balance sheet was on fire.",
      color: "social",
    };
  }
  if (heavyDebt && score < 45) {
    return {
      title: "Debt Spiral",
      emoji: "🌀",
      blurb:
        "The interest started compounding faster than the income. Recoverable — but next run, kill the debt early.",
      color: "debt",
    };
  }
  if (score >= 70) {
    return {
      title: "Freedom Builder",
      emoji: "🚀",
      blurb:
        "Low debt, real skills, options everywhere. You're not rich yet — you're something better: free to choose.",
      color: "freedom",
    };
  }
  return {
    title: "Stable Strategist",
    emoji: "🧠",
    blurb:
      "No fireworks, no fires. You made boring, correct choices and boring, correct choices win the long game.",
    color: "cash",
  };
}
