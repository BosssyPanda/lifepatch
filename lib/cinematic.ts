/**
 * Cold-open intro film — a ~20s three-act cinematic (CINEMA plan, Phase P).
 * Each beat's accent fires a synced audio hit; `film` names a looping clip in
 * public/film/ (Act I backdrops), `scene` names a live WebGL backdrop (Act II).
 */

export type AccentKind = "thump" | "hit" | "stab" | "riser" | "title";

export type FilmClip = "ticker" | "paper" | "static";

export type ColdBeat = {
  id: string;
  act: 1 | 2 | 3;
  text: string;
  emphasis?: string; // a word rendered as a stamped plate
  accent: AccentKind;
  ms: number; // how long this beat holds before the next
  mascot?: boolean;
  film?: FilmClip; // Act I: looping webm backdrop (poster-first)
  scene?: "vortex"; // Act II: live BillVortex WebGL backdrop
};

/** Mono act eyebrows shown over the film (Act III is the title — unlabeled). */
export const ACT_LABELS: Record<1 | 2, string> = {
  1: "ACT I — THE THREAT",
  2: "ACT II — THE STAKES",
};

/**
 * Reading-time floor so phrases never flash by: at least ~400ms per word plus
 * a base, and never less than the authored hold. Keeps the film readable while
 * landing the whole sequence near the ~20s director's cut.
 */
function hold(text: string, base: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(base, words * 400 + 950);
}

// No spoilers (no years / named events). Escalating accents → title resolve.
// Act I = THREAT (film loops), Act II = STAKES (bill vortex), Act III = TITLE.
export const COLD_OPEN: ColdBeat[] = [
  { id: "c1", act: 1, text: "The economy is rigged.", emphasis: "rigged", accent: "thump", ms: hold("The economy is rigged.", 2400), film: "ticker" },
  { id: "c2", act: 1, text: "Rent doesn't wait.", emphasis: "wait", accent: "thump", ms: hold("Rent doesn't wait.", 2200), film: "paper" },
  { id: "c3", act: 1, text: "Scams don't sleep.", emphasis: "sleep", accent: "hit", ms: hold("Scams don't sleep.", 2200), film: "static" },
  { id: "c4", act: 2, text: "The market doesn't care about you.", emphasis: "care", accent: "hit", ms: hold("The market doesn't care about you.", 2600), scene: "vortex" },
  { id: "c5", act: 2, text: "Most people get financially cooked.", emphasis: "cooked", accent: "stab", ms: hold("Most people get financially cooked.", 2700), scene: "vortex" },
  { id: "c6", act: 2, text: "But you'll still play. They always do.", accent: "riser", ms: hold("But you'll still play. They always do.", 3000), mascot: true, scene: "vortex" },
  { id: "c7", act: 3, text: "LIFEPATCH", accent: "title", ms: 4200 },
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
