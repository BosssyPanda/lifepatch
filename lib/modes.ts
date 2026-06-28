import { FIRST_YEAR } from "./markets";

export type ModeId = "story" | "infinite";

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
  story: {
    id: "story",
    name: "Story",
    tagline: "A tight run with a reckoning.",
    meta: "Finite · has an ending",
    startYear: 1990,
    endYear: 2010,
    blurb:
      "A fixed-length life with a definite end and a full final report. Booms, busts, and a crash or two land when you least expect them.",
  },
  infinite: {
    id: "infinite",
    name: "Infinite",
    tagline: "Live a whole lifetime.",
    meta: "Open-ended · autosaves",
    startYear: FIRST_YEAR,
    endYear: null,
    blurb:
      "Open-ended. Live year after year, autosaving as you go, until you retire, quit, or your number finally comes up.",
  },
};

export function getMode(id: ModeId): ModeConfig {
  return MODES[id];
}
