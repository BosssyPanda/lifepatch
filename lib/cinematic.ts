/** Cold-open kinetic-typography sequence. Each beat's accent fires a synced audio hit. */

export type AccentKind = "thump" | "hit" | "stab" | "riser" | "title";

export type ColdBeat = {
  id: string;
  text: string;
  emphasis?: string; // a word rendered in accent color
  accent: AccentKind;
  ms: number; // how long this beat holds before the next
  mascot?: boolean;
};

// No spoilers (no years / named events). Escalating accents → title resolve.
export const COLD_OPEN: ColdBeat[] = [
  { id: "c1", text: "The economy is rigged.", emphasis: "rigged", accent: "thump", ms: 1700 },
  { id: "c2", text: "Rent doesn't wait.", emphasis: "wait", accent: "thump", ms: 1450 },
  { id: "c3", text: "Scams don't sleep.", emphasis: "sleep", accent: "hit", ms: 1450 },
  { id: "c4", text: "The market doesn't care about you.", emphasis: "care", accent: "hit", ms: 1750 },
  { id: "c5", text: "Most people get financially cooked.", emphasis: "cooked", accent: "stab", ms: 1900 },
  { id: "c6", text: "But you'll still play. They always do.", accent: "riser", ms: 2100, mascot: true },
  { id: "c7", text: "LIFEPATCH", accent: "title", ms: 2600 },
];

export const COLD_OPEN_TOTAL = COLD_OPEN.reduce((t, b) => t + b.ms, 0);

/** Outro recap beat ids in order (visual + audio driven off the same timer). */
export type RecapKind = "open" | "years" | "networth" | "win" | "loss" | "mascot" | "verdict";

export type RecapBeat = { kind: RecapKind; ms: number };

export const RECAP_BEATS: RecapBeat[] = [
  { kind: "open", ms: 1700 },
  { kind: "years", ms: 1900 },
  { kind: "networth", ms: 2600 },
  { kind: "win", ms: 1700 },
  { kind: "loss", ms: 1700 },
  { kind: "mascot", ms: 1900 },
  { kind: "verdict", ms: 2800 },
];
