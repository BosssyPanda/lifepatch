import { FIRST_YEAR, LAST_YEAR } from "./markets";

export type ModeId = "story" | "infinite";

export type ModeConfig = {
  id: ModeId;
  name: string;
  tagline: string;
  startYear: number;
  endYear: number | null; // null = open-ended
  blurb: string;
  range: string;
};

export const MODES: Record<ModeId, ModeConfig> = {
  story: {
    id: "story",
    name: "Story",
    tagline: "1990 → 2010",
    startYear: 1990,
    endYear: 2010,
    range: "1990–2010",
    blurb:
      "Twenty years across the dot-com boom, the bust, and the 2008 crash. A tight, finite run with a final reckoning.",
  },
  infinite: {
    id: "infinite",
    name: "Infinite",
    tagline: "1957 → today",
    startYear: FIRST_YEAR,
    endYear: null,
    range: `${FIRST_YEAR}–${LAST_YEAR}`,
    blurb:
      "Start at the dawn of the modern S&P 500 and live a whole lifetime — until you retire, quit, or your number comes up. Autosaves every year.",
  },
};

export function getMode(id: ModeId): ModeConfig {
  return MODES[id];
}
