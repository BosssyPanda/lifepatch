import { FIRST_YEAR } from "./markets";

export type ModeId = "story" | "infinite" | "cashflow";

export type ModeConfig = {
  id: ModeId;
  name: string;
  tagline: string;
  meta: string; // non-spoiler gameplay distinction (no years)
  blurb: string;
  startYear: number;
  endYear: number | null; // null = open-ended
};

// Note: the real start/end years are intentionally hidden from the player and
// only revealed in the end report. Never surface startYear/endYear in the UI.
export const MODES: Record<ModeId, ModeConfig> = {
  // Phase-3 tester note: selection copy was too wordy — keep it plain and short.
  story: {
    id: "story",
    name: "Story",
    tagline: "One life, with an ending.",
    meta: "Short run · has an ending",
    startYear: 1990,
    endYear: 2010,
    blurb:
      "Play a set number of years, survive the booms and crashes, and get a final report on how you did.",
  },
  infinite: {
    id: "infinite",
    name: "Infinite",
    tagline: "Keep going as long as you last.",
    meta: "No end date · autosaves",
    startYear: FIRST_YEAR,
    endYear: null,
    blurb:
      "No end date. Play year after year — it autosaves — until you retire, quit, or your luck runs out.",
  },
  cashflow: {
    id: "cashflow",
    name: "Rat Race",
    tagline: "Escape the 9-to-5.",
    meta: "Board game",
    startYear: 0,
    endYear: null,
    blurb:
      "A money board game. Pick a job, buy assets that pay you every month, and escape when that income covers your bills.",
  },
};

export function getMode(id: ModeId): ModeConfig {
  return MODES[id];
}
