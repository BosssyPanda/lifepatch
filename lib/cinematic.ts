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

/**
 * Outro recap film scenes (CINEMA Phase Q) — authored base durations; the
 * "years" scene is computed at runtime from run length (per-year flips +
 * milestone holds) and CAPPED at its ms here so 40-year lives still replay
 * in ~5s. "swing" is THE WIN or THE HIT (symmetric — every run gets one).
 */
export type RecapSceneKind = "closed" | "years" | "swing" | "line" | "verdict";

export type RecapScene = { kind: RecapSceneKind; ms: number };

export const RECAP_SCENES: RecapScene[] = [
  { kind: "closed", ms: 2200 }, // RUN CLOSED slam + statement stamp
  { kind: "years", ms: 5000 }, // cap — actual = years × flip + milestones × hold
  { kind: "swing", ms: 3000 }, // THE WIN / THE HIT plate
  { kind: "line", ms: 3800 }, // net worth drawn full-bleed
  { kind: "verdict", ms: 4200 }, // giant split-flap → settle into receipt
];

/** Scene-2 pacing atoms (flip-all-years, pause-on-milestones — director's pick). */
export const YEARS_FLIP_MS = 140;
export const YEARS_HOLD_MS = 600;
export const YEARS_MIN_MS = 1600;
