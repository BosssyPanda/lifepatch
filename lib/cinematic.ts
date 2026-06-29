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

/**
 * Reading-time floor so phrases never flash by: at least ~430ms per word plus
 * a base, and never less than the authored hold. Keeps the cold open readable.
 */
function hold(text: string, base: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(base, words * 430 + 1100);
}

// No spoilers (no years / named events). Escalating accents → title resolve.
// `ms` = how long the phrase holds on screen (slowed for comfortable reading).
export const COLD_OPEN: ColdBeat[] = [
  { id: "c1", text: "The economy is rigged.", emphasis: "rigged", accent: "thump", ms: hold("The economy is rigged.", 2600) },
  { id: "c2", text: "Rent doesn't wait.", emphasis: "wait", accent: "thump", ms: hold("Rent doesn't wait.", 2400) },
  { id: "c3", text: "Scams don't sleep.", emphasis: "sleep", accent: "hit", ms: hold("Scams don't sleep.", 2400) },
  { id: "c4", text: "The market doesn't care about you.", emphasis: "care", accent: "hit", ms: hold("The market doesn't care about you.", 2900) },
  { id: "c5", text: "Most people get financially cooked.", emphasis: "cooked", accent: "stab", ms: hold("Most people get financially cooked.", 3100) },
  { id: "c6", text: "But you'll still play. They always do.", accent: "riser", ms: hold("But you'll still play. They always do.", 3500), mascot: true },
  { id: "c7", text: "LIFEPATCH", accent: "title", ms: 4200 },
];

export const COLD_OPEN_TOTAL = COLD_OPEN.reduce((t, b) => t + b.ms, 0);

/** Outro recap beat ids in order (visual + audio driven off the same timer). */
export type RecapKind = "open" | "years" | "networth" | "win" | "loss" | "mascot" | "verdict";

export type RecapBeat = { kind: RecapKind; ms: number };

// Slowed so each recap card is readable (numbers/copy need a beat to land).
export const RECAP_BEATS: RecapBeat[] = [
  { kind: "open", ms: 2900 },
  { kind: "years", ms: 3100 },
  { kind: "networth", ms: 4000 }, // count-up needs time to climb
  { kind: "win", ms: 3000 },
  { kind: "loss", ms: 3000 },
  { kind: "mascot", ms: 3300 },
  { kind: "verdict", ms: 4200 },
];
