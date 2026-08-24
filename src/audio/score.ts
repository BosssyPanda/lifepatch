/**
 * "The Debtor's March" — the single source of musical truth for LifePatch.
 *
 * Everything the score is made of lives here as plain data: harmony, melody,
 * comping figures, bass, percussion grids, per-phase mix presets, intensity
 * rules, voice parameters and accent stingers. `AudioEngine` (browser, Tone.js)
 * and the offline preview renderer (Node, Tone.Offline) both build their graph
 * from THIS file, which is the only way a preview WAV can be trusted to sound
 * like the thing the game plays.
 *
 * ## Cue card (the per-cue metadata CLAUDE.md mandates)
 *
 * - cue id ............ `score.debtors-march`
 * - BPM ............... 108
 * - key ............... D minor (natural minor; raised 7th C# at every cadence)
 * - time signature .... 4/4
 * - bar count ......... 16 (8 harmonic segments x 2 bars)
 * - loop start / end .. 0.000000 s / 35.555556 s (bar 1 beat 1 -> bar 17 beat 1)
 * - sections .......... bars 1-8 "the state" (menace), bars 9-16 "the debtor"
 *                       (defiance); bar 16 is a V7 half-cadence so the restart
 *                       is WANTED rather than merely survived
 * - cue points ........ every 2 bars a segment boundary; bar 16 beat 4 the
 *                       carriage return (see `CARRIAGE_RETURN`)
 * - stems ............. see `STEM_IDS` (9)
 * - intensity layers .. see `INTENSITY_RULES`
 * - transition rules .. phase changes are gain crossfades only; the transport
 *                       never stops, so every transition is bar-agnostic and
 *                       seamless (see `PRESETS`)
 * - license / source .. 100% original material, composed for this project.
 *                       No existing song, beat, riff, drop or arrangement was
 *                       referenced or transcribed. Rendered live from synthesis
 *                       — there are no third-party samples anywhere in the cue.
 *
 * ## Why 108 BPM
 *
 * 44100 x 60 / 108 = 24,500 samples per beat, EXACTLY — an integer, so the bar
 * (98,000 samples) and the 16-bar loop (1,568,000 samples) are integers too.
 * Offline renders can therefore be trimmed to bit-exact loop points with no
 * fractional-sample fudge, which is the difference between a seam you cannot
 * hear and a seam that clicks once every 35 seconds forever.
 *
 * ## Hard constraints on this file (do not break these)
 *
 * - **Erasable syntax only.** The Node preview renderer imports this module
 *   through native TypeScript type-stripping, which deletes types without
 *   understanding them. No `enum`, no `namespace`, no parameter properties, no
 *   decorators, no `declare module`. Types are `type` / `interface` / `as const`
 *   / `satisfies` only.
 * - **No runtime imports.** Type-stripping resolves specifiers as plain ESM, so
 *   an extensionless `./tempo` import would fail there. This module therefore
 *   imports nothing at all and re-declares the tempo constants it needs (see
 *   `SCORE_BPM_REF`, which is paired with `SCORE_BPM` in `src/audio/tempo.ts`).
 * - **No Tone.js, no browser globals, no side effects.** Importing this file
 *   must be free: it allocates data and nothing else.
 */

// ---------------------------------------------------------------------------
// Primitive types
// ---------------------------------------------------------------------------

/**
 * A scientific-pitch note name, validated by the type system.
 *
 * Every pitch in this file is checked against this union at compile time via
 * `satisfies`, so a typo like "Bb44" or "H4" is a build error rather than a
 * silent rest at runtime (Tone would throw deep inside a scheduled callback,
 * i.e. in the worst possible place to notice it).
 */
export type Pitch = `${"A" | "B" | "C" | "D" | "E" | "F" | "G"}${"" | "#" | "b"}${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;

/** A slot on a rhythmic grid: a pitch to strike, or `null` for a rest. */
export type Slot = Pitch | null;

/** Tone.js transport-relative note values used by this score. */
export type NoteValue = "32n" | "16n" | "8n" | "8n." | "4n" | "2n" | "1m" | "2m";

/** Oscillator shapes used by the voice book. */
export type OscKind = "sine" | "triangle" | "square" | "sawtooth" | "pulse" | "fatsawtooth";

/** Noise colours used by the voice book. */
export type NoiseKind = "white" | "pink" | "brown";

/** Filter responses used by the voice book. */
export type FilterKind = "lowpass" | "highpass" | "bandpass";

/** A standard ADSR, in seconds (sustain is a 0..1 level, not a time). */
export interface EnvelopeSpec {
  readonly attack: number;
  readonly decay: number;
  readonly sustain: number;
  readonly release: number;
}

// ---------------------------------------------------------------------------
// Tempo and form
// ---------------------------------------------------------------------------

/**
 * The score tempo, restated here because this module cannot import anything.
 *
 * **Paired with `SCORE_BPM` in `src/audio/tempo.ts` — the two must stay equal.**
 * `tempo.ts` is the value the visual beat grid reads (it is deliberately tiny
 * and Tone-free so cinematic components can import it cheaply); this is the
 * value the music is written against. They describe the same clock.
 */
export const SCORE_BPM_REF = 108;

/** 4/4 throughout — a march that changes metre is not a march. */
export const BEATS_PER_BAR = 4;

/** One harmonic segment = 2 bars, and the cycle is 8 of them. */
export const BARS_PER_SEGMENT = 2;
export const SEGMENT_COUNT = 8;
export const BARS_PER_CYCLE = BARS_PER_SEGMENT * SEGMENT_COUNT; // 16

export const SECONDS_PER_BEAT = 60 / SCORE_BPM_REF; // 0.555556 s
export const SECONDS_PER_BAR = SECONDS_PER_BEAT * BEATS_PER_BAR; // 2.222222 s
export const CYCLE_SECONDS = SECONDS_PER_BAR * BARS_PER_CYCLE; // 35.555556 s

/**
 * Sample counts at 44.1 kHz. All three are integers at 108 BPM — that is the
 * whole reason the tempo is 108 and not 104 or 110 (see the header). The
 * offline renderer asserts these against its own arithmetic before it trusts a
 * loop point.
 */
export const SAMPLES_PER_BEAT_44K1 = 24_500;
export const SAMPLES_PER_BAR_44K1 = SAMPLES_PER_BEAT_44K1 * BEATS_PER_BAR; // 98,000
export const SAMPLES_PER_CYCLE_44K1 = SAMPLES_PER_BAR_44K1 * BARS_PER_CYCLE; // 1,568,000

/** Identity block for the cue. `public/audio/meta/*.music.json` is generated from this. */
export const SCORE_CUE = {
  id: "score.debtors-march",
  title: "The Debtor's March",
  bpm: SCORE_BPM_REF,
  key: "D minor",
  timeSignature: "4/4",
  bars: BARS_PER_CYCLE,
  loopStartSec: 0,
  loopEndSec: CYCLE_SECONDS,
  licenseNotes: "Original composition for LifePatch. No third-party material, no samples.",
} as const;

// ---------------------------------------------------------------------------
// Phases and stems
// ---------------------------------------------------------------------------

/**
 * The score phases.
 *
 * **Structurally identical to `ScorePhase` in `src/audio/AudioEngine.ts`.** The
 * engine keeps exporting its own union (it is part of its public API, imported
 * by ~25 components) and this module re-declares it so the two files do not
 * import each other. If one gains a member, so must the other.
 */
export type ScorePhaseId = "intro" | "title" | "menu" | "gameplay" | "recapGood" | "recapBad";

/**
 * The nine stems the bed is mixed from. Every one is always PLAYING; the phase
 * mix decides which are audible, so a phase change is a set of gain ramps and
 * never a re-scheduling — that is what makes the transitions seamless.
 *
 * - `bass` .... sine sub on the segment roots, doubled by the march "oom"
 * - `brass` ... the chord voicings, with the filter-envelope swell that reads
 *               as brass rather than as a pad
 * - `keys` .... compressed upright piano stamping the comping figures
 * - `snare` ... tight march snare (accents, ghosts, a ruff every 4th bar)
 * - `ticks` ... typewriter clacks on the offbeats: the march's "pah" is office
 *               machinery, which is the joke the whole score is built on
 * - `lead` .... the tune. Only fully open in `title` and `recapGood`
 * - `tension` . the m2 grind (D2 + Eb2). This is the ECONOMY's music, not the
 *               player's — it rises with financial stress, never with hope
 * - `air` ..... band-passed pink noise, always on at 0.06, the glue that stops
 *               the quiet phases sounding like a muted stream
 * - `counter` . the sustained countermelody, warmth for the wins
 */
export type StemId =
  | "bass"
  | "brass"
  | "keys"
  | "snare"
  | "ticks"
  | "lead"
  | "tension"
  | "air"
  | "counter";

/** Iteration order for the stems (stable, so mixes are comparable in logs). */
export const STEM_IDS = [
  "bass", "brass", "keys", "snare", "ticks", "lead", "tension", "air", "counter",
] as const satisfies readonly StemId[];

// ---------------------------------------------------------------------------
// Harmony
// ---------------------------------------------------------------------------

/**
 * The 16-bar harmonic cycle, one voicing per 2-bar segment, played by `brass`.
 *
 * Segments 1-4 are the state closing in: tonic, then the flat-VI major seventh
 * that makes the room feel wide and indifferent, then the subdominant minor,
 * then a MAJOR dominant. That A major is the signature: its C# is a raised
 * leading tone in a natural-minor context, and it is the sound of someone
 * grinning at a bailiff. Segments 5-8 are the debtor answering: tonic again,
 * then the relative-major pair F -> C (the only genuinely bright bars in the
 * cycle), then A7 as a half-cadence — the cycle ends UNRESOLVED on the dominant
 * so the loop restart is the resolution. That is what makes 35 seconds of
 * repetition feel like a march instead of a treadmill.
 *
 * These arrays are the literal voicings, low note first. They are voiced close
 * and mostly inside D3-F4 so the brass sits under the lead and over the bass
 * without either of them having to fight for the midrange.
 */
export const CHORDS = [
  ["D3", "A3", "D4", "F4"],   // 1. Dm      — home, open fifth + minor third on top
  ["Bb2", "F3", "A3", "D4"],  // 2. Bbmaj7  — the wide, indifferent institution
  ["G2", "D3", "G3", "Bb3"],  // 3. Gm      — the subdominant, pressure applied
  ["A2", "E3", "A3", "C#4"],  // 4. A       — THE GRIN: major V, C# on top
  ["D3", "A3", "D4", "F4"],   // 5. Dm      — home again, but now it is ours
  ["F3", "A3", "C4", "F4"],   // 6. F       — relative major, chin up
  ["C3", "G3", "C4", "E4"],   // 7. C       — the bVII lift, the only real daylight
  ["A2", "G3", "C#4", "E4"],  // 8. A7      — half-cadence; the seventh pulls us round
] as const satisfies readonly (readonly Pitch[])[];

/**
 * Sub-bass roots, one per segment, an octave (or two) under the voicings.
 * C2 for segment 7 rather than C1: below ~40 Hz the sine stops reading as a
 * pitch on laptop speakers and just eats headroom.
 */
export const ROOTS = [
  "D1", "Bb1", "G1", "A1", "D1", "F1", "C2", "A1",
] as const satisfies readonly Pitch[];

/**
 * The countermelody: one long tone per segment, sustained across both bars.
 *
 * It is the successor to the old `warmth` shimmer — same job (make the calm
 * phases feel held rather than empty) but now it is actually part of the piece.
 * Every tone is a chord tone or a colour of its segment: A4 = 5th of Dm,
 * F4 = 5th of Bbmaj7, G4 = root of Gm, E4 = 5th of A, F4 = b3 of Dm,
 * A4 = 3rd of F, G4 = 5th of C, C#5 = 3rd of A7.
 *
 * The cycle always ends on C#5 — the brand note. Whatever else is happening in
 * the mix, the last thing the countermelody says before the loop turns over is
 * the leading tone.
 */
export const COUNTER_LINE = [
  "A4", "F4", "G4", "E4", "F4", "A4", "G4", "C#5",
] as const satisfies readonly Pitch[];

/** Each counter tone is held for its whole segment. */
export const COUNTER_NOTE_VALUE: NoteValue = "2m";

// ---------------------------------------------------------------------------
// The tune
// ---------------------------------------------------------------------------

/**
 * LEAD_THEME — 128 slots on the 8th-note grid (16 bars x 8), range D4-E5.
 *
 * The hook is built from one rhythmic cell, "da-da-DAH — DAH": two pickup 8ths
 * into a held note on beat 2, answered on beat 3. It appears in bars 1, 3, 5, 9
 * and 13, which is what makes the tune singable back after one listen — the ear
 * only has to learn one gesture and then follow where it is transplanted.
 *
 * Two colour notes carry the whole identity. Every **C#** is the raised leading
 * tone: it is why this reads as a march with somewhere to go rather than a modal
 * drone sitting on D. The **B natural** in bar 7 is the raised 6th — Dorian
 * brightness smuggled into the middle of the dominant charge, so the climb feels
 * like nerve rather than menace.
 *
 * The seam is deliberate: bar 16 sits on A4 (the dominant), rests, and then the
 * last two 8ths restate "A4 A4" as an anacrusis straight into bar 1's "D4 D4".
 * The loop point is therefore inside a rhythmic gesture, not between two of
 * them, which glues 35.56 s of repetition shut.
 */
export const LEAD_THEME = [
  // bar 1 — stand up: the stamp-cell walks up the tonic triad
  "D4", "D4", "F4", null, "A4", null, null, null,
  // bar 2 — the sigh, made confident: falls Bb-A-F-D without apologising
  "Bb4", null, "A4", null, "F4", null, "D4", null,
  // bar 3 — again, higher: same cell, but it reaches Bb instead of A
  "D4", "D4", "F4", null, "Bb4", null, null, null,
  // bar 4 — first peak (C5), then steps down: the claim, then the arithmetic
  "C5", null, "Bb4", null, "A4", null, "F4", null,
  // bar 5 — the rubber stamp: G4 G4 G4, "DENIED-DENIED-DENIED"
  "G4", "G4", "G4", null, "Bb4", null, "A4", null,
  // bar 6 — regroup and climb back out of it
  "F4", null, "G4", null, "A4", null, null, null,
  // bar 7 — charge up the dominant; B4 is the Dorian 6th inside A major
  "A4", null, "A4", "B4", "C#5", null, "E5", null,
  // bar 8 — the grin: a 4-3 sigh onto C#5, the brand note
  "D5", null, "C#5", null, "A4", null, null, null,
  // bar 9 — declamation: three A4s, "we're still here"
  "A4", "A4", "A4", null, "G4", null, "F4", null,
  // bar 10 — stepwise descent home, G-F-E-D, nothing fancy, just arriving
  "G4", null, "F4", null, "E4", null, "D4", null,
  // bar 11 — chin up: straight up the F triad
  "F4", null, "A4", null, "C5", null, null, null,
  // bar 12 — reach (D5) and fall back, the reality check
  "D5", null, "C5", null, "A4", null, "F4", null,
  // bar 13 — stamp-cell on the stride: same gesture, now over C major
  "E4", "E4", "G4", null, "C5", null, null, null,
  // bar 14 — the long climb, C-D-E, the biggest open gesture in the tune
  "C5", null, "D5", null, "E5", null, null, null,
  // bar 15 — cadence descent through C#5, with B4 answering bar 7's Dorian 6th
  "E5", null, "C#5", null, "D5", null, "B4", null,
  // bar 16 — settle on the dominant; the last two 8ths are the anacrusis
  //          that dovetails straight into bar 1's "D4 D4"
  "A4", null, null, null, null, null, "A4", "A4",
] as const satisfies readonly Slot[];

// ---------------------------------------------------------------------------
// Comping
// ---------------------------------------------------------------------------

/**
 * KEYS_FIGURES — 128 slots on the 8th-note grid, the compressed upright piano.
 *
 * One rule, applied to all eight segments:
 *
 * - **first bar of the segment** — the stamp cell `[x x x . x . . .]` walking
 *   the chord ascending (root, root, 3rd, rest, 5th). It shares the lead's
 *   signature rhythm exactly, an octave down, so the piano reads as the tune's
 *   shadow rather than as a second, competing idea.
 * - **second bar of the segment** — a sparse answer `[. . x . . . x .]`, the
 *   5th on beat 2 and the root on beat 4. Two notes, no more: the second bar of
 *   every segment is where the lead does its falling gestures and the comp gets
 *   out of the way.
 *
 * Registers are chosen per segment so the top of each cell lands an octave (or
 * more) below whatever the lead is doing in that bar — Bb2 for segment 2 and C3
 * for segment 7 look like outliers on paper, but they are exactly what keeps the
 * comp from colliding in unison with the lead's Bb4/D4 and C5.
 *
 * This is written out rather than generated. It is data, not a program: a bug in
 * a generator is inaudible until it is embarrassing, and a table can be read.
 */
export const KEYS_FIGURES = [
  // seg 1 / bar 1 — Dm stamp cell
  "D3", "D3", "F3", null, "A3", null, null, null,
  // seg 1 / bar 2 — answer: 5th, root
  null, null, "A3", null, null, null, "D3", null,
  // seg 2 / bar 3 — Bbmaj7 stamp cell (low, to clear the lead's Bb4)
  "Bb2", "Bb2", "D3", null, "F3", null, null, null,
  // seg 2 / bar 4 — answer
  null, null, "F3", null, null, null, "Bb2", null,
  // seg 3 / bar 5 — Gm stamp cell, doubling the lead's "DENIED" an octave down
  "G3", "G3", "Bb3", null, "D4", null, null, null,
  // seg 3 / bar 6 — answer
  null, null, "D4", null, null, null, "G3", null,
  // seg 4 / bar 7 — A major stamp cell; C#4 puts the grin in the piano too
  "A3", "A3", "C#4", null, "E4", null, null, null,
  // seg 4 / bar 8 — answer
  null, null, "E4", null, null, null, "A3", null,
  // seg 5 / bar 9 — Dm stamp cell under the "we're still here" declamation
  "D3", "D3", "F3", null, "A3", null, null, null,
  // seg 5 / bar 10 — answer
  null, null, "A3", null, null, null, "D3", null,
  // seg 6 / bar 11 — F stamp cell, shadowing the lead's F triad climb
  "F3", "F3", "A3", null, "C4", null, null, null,
  // seg 6 / bar 12 — answer
  null, null, "C4", null, null, null, "F3", null,
  // seg 7 / bar 13 — C stamp cell (low, to clear the lead's C5)
  "C3", "C3", "E3", null, "G3", null, null, null,
  // seg 7 / bar 14 — answer
  null, null, "G3", null, null, null, "C3", null,
  // seg 8 / bar 15 — A7 stamp cell; the grin restated at the half-cadence
  "A3", "A3", "C#4", null, "E4", null, null, null,
  // seg 8 / bar 16 — answer, thinning out into the loop seam
  null, null, "E4", null, null, null, "A3", null,
] as const satisfies readonly Slot[];

/**
 * BASS_LINE — 32 slots on the half-note grid (16 bars x 2), the march "oom".
 *
 * Beat 1 is the segment root, beat 3 the fifth above it: the oldest bass figure
 * there is, and the reason a march walks. Octaves are picked to keep the whole
 * line inside A1-D3 — roughly a ninth — because a bass that leaps octaves to
 * chase roots stops sounding like footsteps and starts sounding like a synth
 * arpeggio. The sub (`ROOTS`) sits an octave below this and holds; this line is
 * the one you feel in your feet.
 */
export const BASS_LINE = [
  "D2", "A2", "D2", "A2",     // seg 1 — Dm
  "Bb1", "F2", "Bb1", "F2",   // seg 2 — Bbmaj7
  "G2", "D3", "G2", "D3",     // seg 3 — Gm
  "A1", "E2", "A1", "E2",     // seg 4 — A
  "D2", "A2", "D2", "A2",     // seg 5 — Dm
  "F2", "C3", "F2", "C3",     // seg 6 — F
  "C2", "G2", "C2", "G2",     // seg 7 — C
  "A1", "E2", "A1", "E2",     // seg 8 — A7
] as const satisfies readonly Pitch[];

// ---------------------------------------------------------------------------
// Percussion
// ---------------------------------------------------------------------------

/**
 * SNARE_PATTERN — 64 slots on the 16th grid (4 bars), repeated 4x per cycle.
 * Values are velocities in 0..1; `0` is a rest.
 *
 * Accents on beats 1 and 3 carry the march. The 0.3/0.35/0.45 values are ghost
 * notes on the "a" of beat 1, the "&" of beat 2 and the "&" of beat 4 — they are
 * what stops a two-accent pattern sounding like a metronome, and they are quiet
 * enough that you feel them rather than count them.
 *
 * Bar 4 replaces its last four 16ths with a crescendo ruff (0.4, 0.55, 0.7, 0.9)
 * into the next downbeat. Every fourth bar therefore *announces* itself, which
 * gives the 16-bar cycle an audible 4-bar pulse without any change of material.
 */
export const SNARE_PATTERN = [
  // bar 1
  1, 0, 0, 0.3, 0, 0, 0.35, 0, 0.85, 0, 0, 0.3, 0, 0, 0.45, 0,
  // bar 2
  1, 0, 0, 0.3, 0, 0, 0.35, 0, 0.85, 0, 0, 0.3, 0, 0, 0.45, 0,
  // bar 3
  1, 0, 0, 0.3, 0, 0, 0.35, 0, 0.85, 0, 0, 0.3, 0, 0, 0.45, 0,
  // bar 4 — ruff into the downbeat
  1, 0, 0, 0.3, 0, 0, 0.35, 0, 0.85, 0, 0, 0.3, 0.4, 0.55, 0.7, 0.9,
] as const satisfies readonly number[];

/**
 * TICKS_PATTERN — 16 slots on the 8th grid (2 bars), velocities in 0..1.
 *
 * The office-machinery layer. Every clack lands on an OFFBEAT 8th: in a march
 * the "pah" answers the "oom", and here the "pah" is a typewriter. The velocity
 * wobble (0.35-0.6) is deliberate — a perfectly even clack reads as a hi-hat
 * and the whole conceit collapses.
 */
export const TICKS_PATTERN = [
  // bar 1: the "&" of each beat
  0, 0.55, 0, 0.4, 0, 0.6, 0, 0.4,
  // bar 2: same figure, slightly different weighting so it does not lock
  0, 0.5, 0, 0.45, 0, 0.6, 0, 0.35,
] as const satisfies readonly number[];

/**
 * Bars (0-indexed within the 16-bar cycle) that get the low stamp-thock on
 * beat 1 — every fourth bar. Paired with the snare ruff that leads into them,
 * this is what marks the 4-bar phrase: something heavy lands, on schedule,
 * whether or not you are ready for it.
 */
export const TICK_STAMP_BARS = [0, 4, 8, 12] as const satisfies readonly number[];

/**
 * The once-per-cycle carriage return: a zip up the noise band and a bell ding,
 * on the last beat of the last bar.
 *
 * **Indices are 0-based.** `bar: 15` is the sixteenth bar; `beat: 3` is the
 * fourth beat of it. In seconds from the top of the cycle that is
 * `15 * SECONDS_PER_BAR + 3 * SECONDS_PER_BEAT` = 34.999 s, i.e. the last beat
 * before the loop turns over — the page finishing, right as the next one starts.
 */
export const CARRIAGE_RETURN = {
  bar: 15,
  beat: 3,
  /** E6 — the 5th of the bar-16 A7, so the bell is part of the half-cadence. */
  ding: "E6",
  /** Band-passed noise sweep: the carriage travelling back. */
  zip: { fromHz: 1600, toHz: 5200, durationSec: 0.18, volume: -26 },
} as const;

/**
 * Grid metadata, so the engine and the renderer schedule the same patterns the
 * same way instead of each hard-coding a subdivision next to its own sequence.
 */
export const GRIDS = {
  harmony: { subdivision: "2m", steps: SEGMENT_COUNT, bars: BARS_PER_CYCLE },
  lead: { subdivision: "8n", steps: 128, bars: BARS_PER_CYCLE },
  keys: { subdivision: "8n", steps: 128, bars: BARS_PER_CYCLE },
  bass: { subdivision: "2n", steps: 32, bars: BARS_PER_CYCLE },
  snare: { subdivision: "16n", steps: 64, bars: 4 },
  ticks: { subdivision: "8n", steps: 16, bars: 2 },
} as const;

// ---------------------------------------------------------------------------
// The mix: phase presets and intensity
// ---------------------------------------------------------------------------

/**
 * Target gain per stem per phase — the whole dramaturgy of the score in one
 * table. A phase change ramps these; nothing is ever started or stopped.
 *
 * - `intro` — the cold open. No tune at all (`lead: 0`): the theme has not been
 *   earned yet, so the player only gets machinery and dread. `tension` is the
 *   loudest it ever is outside a bad ending.
 * - `title` — the anthem. Lead wide open at 0.7, brass up, counter joining, no
 *   tension anywhere. This is the one moment the march is unambiguously heroic.
 * - `menu` — the same anthem heard from the next room. Lead drops to 0.15 and
 *   the piano takes the foreground; snare and ticks pull almost all the way back
 *   so nobody is being marched at while reading UI copy.
 * - `gameplay` — chill and focused by default: no tune (it would compete with
 *   the player's own thinking), piano forward, everything else waiting for
 *   `INTENSITY_RULES` to bring it in as financial stress rises.
 * - `recapGood` — hopeful: lead and counter both up, piano at its richest,
 *   tension gone.
 * - `recapBad` — dramatic: no tune, tension at 0.55, brass and bass carrying it.
 *   The march is still there; the player is just not the one leading it.
 *
 * `air` is 0.06 in every phase on purpose. It is the glue — the reason silence
 * in this game sounds like a room rather than like a dropped audio context.
 */
export const PRESETS = {
  intro:     { bass: 0.5,  brass: 0.45, keys: 0.15, snare: 0.45, ticks: 0.3,  lead: 0,    tension: 0.5,  air: 0.06, counter: 0    },
  title:     { bass: 0.5,  brass: 0.55, keys: 0.3,  snare: 0.5,  ticks: 0.3,  lead: 0.7,  tension: 0,    air: 0.06, counter: 0.25 },
  menu:      { bass: 0.35, brass: 0.3,  keys: 0.45, snare: 0.12, ticks: 0.12, lead: 0.15, tension: 0,    air: 0.06, counter: 0.15 },
  gameplay:  { bass: 0.36, brass: 0.25, keys: 0.42, snare: 0.12, ticks: 0.1,  lead: 0,    tension: 0,    air: 0.06, counter: 0    },
  recapGood: { bass: 0.45, brass: 0.5,  keys: 0.5,  snare: 0.35, ticks: 0.2,  lead: 0.55, tension: 0,    air: 0.06, counter: 0.5  },
  recapBad:  { bass: 0.5,  brass: 0.35, keys: 0.2,  snare: 0.3,  ticks: 0.1,  lead: 0,    tension: 0.55, air: 0.06, counter: 0    },
} as const satisfies Record<ScorePhaseId, Record<StemId, number>>;

/**
 * How one stem's gain responds to intensity within a phase.
 *
 * `value = clamp01(base + max(0, intensity - threshold) * perIntensity)`
 *
 * `base` is the gain at intensity 0 and MUST equal the phase's `PRESETS` entry,
 * otherwise the mix would jump the moment anything called `setIntensity`.
 * `perIntensity` may be negative (a stem that recedes as things get tense).
 * `threshold` delays the onset — a stem with a threshold is silent until the
 * situation actually warrants it, which is what stops the tension layer from
 * being a permanent low-level whine.
 */
export interface IntensityRamp {
  readonly base: number;
  readonly perIntensity: number;
  readonly threshold?: number;
}

/**
 * Per-phase intensity behaviour. Phases absent from this table ignore intensity
 * entirely and simply use their `PRESETS` row.
 *
 * **gameplay** is the adaptive core. As financial stress climbs: the bass gets
 * heavier, the piano recedes (the tune-ish element gets out of the way), the
 * snare and typewriters crowd in, and past 0.45 the economy's m2 grind starts to
 * bleed through. Nothing new is introduced at high intensity — it is the same
 * material leaning on the player harder, which is why it never feels like the
 * game changed soundtrack mid-thought.
 *
 * **intro** is here because the cold open is supposed to BUILD. `ColdOpen`
 * escalates intensity beat by beat; without these rows that escalation is
 * inaudible. (It has been inaudible: the engine's `setIntensity` used to return
 * early unless the phase was `gameplay`. The rule lives here so the engine and
 * the offline renderer cannot disagree about what the cold open does.)
 */
export const INTENSITY_RULES = {
  gameplay: {
    bass:    { base: 0.36, perIntensity: 0.18 },
    keys:    { base: 0.42, perIntensity: -0.15 },
    snare:   { base: 0.12, perIntensity: 0.3 },
    ticks:   { base: 0.1,  perIntensity: 0.25 },
    tension: { base: 0,    perIntensity: 1.1, threshold: 0.45 },
  },
  intro: {
    snare:   { base: 0.45, perIntensity: 0.3 },
    ticks:   { base: 0.3,  perIntensity: 0.22 },
    tension: { base: 0.5,  perIntensity: 0.3 },
  },
} as const satisfies Partial<Record<ScorePhaseId, Partial<Record<StemId, IntensityRamp>>>>;

/**
 * The canonical evaluation of an `IntensityRamp`.
 *
 * Exported as a function (the only one in this module) precisely because the
 * engine and the offline renderer must not each write their own arithmetic:
 * a preview that differs from the game by a rounding convention is worse than
 * no preview. Pure — no state, no allocation, no side effects.
 */
export function rampGain(ramp: IntensityRamp, intensity: number): number {
  const over = Math.max(0, intensity - (ramp.threshold ?? 0));
  const value = ramp.base + over * ramp.perIntensity;
  return Math.max(0, Math.min(1, value));
}

/**
 * Money-Brain glow: a slow, one-directional warming of the calm beds as the
 * player's understanding grows. It lifts the countermelody (the warmth carrier)
 * and nudges the brass, and only in the phases where there is room for it.
 */
export const BRAIN_GLOW = {
  phases: ["menu", "title", "recapGood"],
  perStem: { counter: 0.22, brass: 0.08 },
} as const satisfies { readonly phases: readonly ScorePhaseId[]; readonly perStem: Partial<Record<StemId, number>> };

/**
 * The stem a celebratory swell opens. `AudioEngine.swellWarmth()` keeps its
 * public name (components call it) but the warmth it swells is now the
 * countermelody, because that is where the warmth actually lives in this score.
 */
export const SWELL_STEM: StemId = "counter";

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------

/**
 * Instrument parameters for every stem, so the engine and the renderer build
 * bit-identical instruments from one description.
 *
 * The two decisions worth stating out loud:
 *
 * 1. `brass.filter` is not decoration. A `fatsawtooth` through a static
 *    low-pass is a pad; the same oscillator through a filter ENVELOPE that
 *    sweeps 380 Hz -> 1600 Hz in 50 ms and falls back over 350 ms is the "bwah"
 *    of a brass section leaning into a chord. That swell is the entire
 *    difference between "ledger orchestra" and "ambient wash".
 * 2. `lead` is two detuned oscillators (pulse + square, B up 7 cents) into a
 *    little drive and a tempo-synced delay. A single clean oscillator sounds
 *    like a bell-pluck; the beating between two slightly-apart waves is what
 *    makes a synth lead read as something being *blown*.
 */
export const VOICES = {
  /** Chord voicings. The filter envelope is the "bwah". */
  brass: {
    oscillator: { type: "fatsawtooth", count: 3, spread: 24 },
    envelope: { attack: 0.06, decay: 0.35, sustain: 0.75, release: 0.5 },
    volume: -13,
    filter: { type: "lowpass", base: 380, peak: 1600, envAttack: 0.05, envDecay: 0.35, Q: 1.2 },
  },

  /**
   * The compressed upright. FM with a harmonicity a hair off the octave-and-a-
   * fifth (3.01) and a fast, near-zero-sustain envelope: hammer, then decay,
   * which is what a stamp on a felt-worn upright actually sounds like.
   */
  keys: {
    harmonicity: 3.01,
    modulationIndex: 10,
    oscillator: { type: "sine" },
    modulation: { type: "sine" },
    envelope: { attack: 0.003, decay: 0.55, sustain: 0.05, release: 0.8 },
    modulationEnvelope: { attack: 0.002, decay: 0.25, sustain: 0.02, release: 0.4 },
    volume: -14,
  },

  /** The tune. Two oscillators, drive, tempo-synced delay. */
  lead: {
    a: { type: "pulse", width: 0.35, detune: 0 },
    b: { type: "square", detune: 7 },
    envelope: { attack: 0.008, decay: 0.3, sustain: 0.55, release: 0.35 },
    volume: -12,
    /** Light asymmetric drive — edge, not distortion. */
    drive: 0.12,
    delay: { time: "8n", feedback: 0.2, wet: 0.18 },
  },

  /** Sine sub on the segment roots. Long release so the low end never gaps. */
  subBass: {
    oscillator: { type: "sine" },
    envelope: { attack: 0.04, decay: 0.3, sustain: 0.9, release: 0.8 },
    volume: -8,
  },

  /**
   * The march "oom": a triangle for body blended with a saw for the string
   * buzz that lets it be heard on a phone speaker where the sub is simply gone.
   */
  marchBass: {
    a: { type: "triangle", gain: 0.75 },
    b: { type: "sawtooth", gain: 0.25 },
    envelope: { attack: 0.005, decay: 0.25, sustain: 0.4, release: 0.25 },
    volume: -14,
  },

  /**
   * Snare: a noise transient for the crack plus a short tuned body at 220 Hz for
   * the drum under it, both high-passed at 400 Hz so the low end stays the
   * bass's. Two layers rather than one because a noise-only snare is a "tss" and
   * a tone-only snare is a tom.
   */
  snare: {
    noise: { type: "white", decay: 0.09, volume: -18 },
    body: { type: "triangle", frequency: 220, decay: 0.12, volume: -24 },
    highpass: 400,
  },

  /**
   * The typewriter clack: a 12 ms noise click through a high-pass at 4800 Hz.
   * (The 4800 is the FILTER cutoff, not an oscillator pitch — the clack has no
   * pitch class, which is what keeps it out of the harmony.)
   */
  tick: {
    noise: { type: "white" },
    highpass: 4800,
    decay: 0.012,
    volume: -20,
  },

  /** The low stamp on every fourth downbeat. */
  stampThock: {
    note: "D2",
    pitchDecay: 0.04,
    octaves: 4,
    decay: 0.12,
    volume: -14,
  },

  /** The carriage-return bell. */
  carriageDing: {
    oscillator: { type: "triangle" },
    decay: 0.35,
    volume: -24,
  },

  /**
   * The economy. Two saws a minor second apart (D2 + Eb2) — the b2 of D minor,
   * the most institutionally unpleasant interval available — under a slow LFO
   * on the cutoff so it breathes instead of sitting still. Retuned from the old
   * A2/A#2 pair so it now grinds against the tonic rather than beside it.
   */
  tension: {
    a: { note: "D2", type: "sawtooth", volume: -14 },
    b: { note: "Eb2", type: "sawtooth", volume: -16 },
    filter: { type: "lowpass", frequency: 700 },
    lfo: { rate: 0.07, depth: 180 },
  },

  /** Always-on band-passed pink noise. The successor to the vinyl crackle. */
  air: {
    noise: { type: "pink" },
    filter: { type: "bandpass", frequency: 1200, Q: 0.6 },
    volume: -20,
  },

  /**
   * The countermelody: a triangle breathing through a slow tremolo.
   *
   * The rate is 6 / CYCLE_SECONDS rather than a round 0.18 Hz so that exactly
   * six breaths fit one 16-bar cycle. At 0.18 it fitted 6.4 times and so began
   * each cycle on a different part of its swell.
   *
   * Honesty about what this did and did not fix: it was tried as a cure for a
   * cycle-to-cycle envelope correlation of 0.84 and moved that number not at
   * all. The residual variation is the noise stems (`air`, and the per-hit
   * randomness of snare and ticks), which cannot repeat and are not supposed
   * to. The rate is kept anyway because a modulation that divides the loop is
   * the more defensible default, and the 0.011 Hz change is inaudible.
   */
  counter: {
    oscillator: { type: "triangle" },
    tremolo: { rate: 6 / CYCLE_SECONDS, depth: 0.45 },
    volume: -20,
  },
} as const;

/** The voice book's shape, for anything that wants to pass a voice around. */
export type VoiceBook = typeof VOICES;

// ---------------------------------------------------------------------------
// Accents (stingers)
// ---------------------------------------------------------------------------

/**
 * Accent kinds. **Structurally identical to `AccentKind` in
 * `src/audio/AudioEngine.ts`**, re-declared here for the same reason
 * `ScorePhaseId` is: no imports, no cycle. If one gains a member, so must the
 * other.
 */
export type AccentKindId =
  | "thump" | "hit" | "stab" | "riser" | "title"
  | "rise" | "thud" | "stampGood" | "stampBad"
  | "mastered" | "levelup" | "streak"
  | "consequence";

/**
 * The accents whose musical material lives in this file. `riser` and `rise` are
 * excluded: they are filtered-noise sweeps with no pitch material at all, so
 * there is nothing for a score to say about them and the engine keeps owning
 * them outright.
 */
export type StingerId = Exclude<AccentKindId, "riser" | "rise">;

/**
 * Pluck timbres. **Every one of these obeys `STINGER_ENVELOPE_CAP`** — that is
 * the point of collecting them here.
 */
export type StingerTimbre = "brassPluck" | "sawPluck" | "trianglePluck" | "keysPluck";

/** Offset from the accent instant, in seconds. Defaults to 0. */
interface LayerTiming {
  readonly atSec?: number;
}

/**
 * One layer of an accent. The engine switches on `kind` to wire the Tone nodes;
 * everything that decides how the accent SOUNDS — pitches, timings, levels — is
 * here, so retuning an accent is a data edit and never an engine edit.
 */
export type StingerLayer =
  /** Notes struck together. */
  | (LayerTiming & {
      readonly kind: "pluck";
      readonly notes: readonly Pitch[];
      readonly timbre: StingerTimbre;
      readonly duration: NoteValue;
      readonly volume: number;
      /** If present, double the whole layer one octave down at this volume. */
      readonly octaveDoubleVolume?: number;
    })
  /** Notes struck in sequence, `stepSec` apart. */
  | (LayerTiming & {
      readonly kind: "arp";
      readonly notes: readonly Pitch[];
      readonly timbre: StingerTimbre;
      readonly duration: NoteValue;
      readonly volume: number;
      readonly stepSec: number;
      readonly octaveDoubleVolume?: number;
    })
  /** Pitched low-end body: the stamp, the boom, the impact. */
  | (LayerTiming & {
      readonly kind: "membrane";
      readonly note: Pitch;
      readonly duration: NoteValue;
      readonly volume: number;
    })
  /** Filtered noise transient: paper, slap, the air a stamp displaces. */
  | (LayerTiming & {
      readonly kind: "noise";
      readonly durationSec: number;
      readonly highpassHz: number;
      readonly volume: number;
    })
  /** A snare ruff: velocities `stepSec` apart, running into the accent's weight. */
  | (LayerTiming & {
      readonly kind: "ruff";
      readonly velocities: readonly number[];
      readonly stepSec: number;
      readonly volume: number;
    });

export interface StingerSpec {
  /**
   * Total sounding length INCLUDING release, in seconds. Documented per accent
   * and asserted against `STINGER_MAX_SOUNDING_SEC`.
   */
  readonly soundingSec: number;
  readonly layers: readonly StingerLayer[];
}

/**
 * **The hard rule.** No accent voice may still be sounding one bar after it
 * fires — 2.222 s at 108 BPM, release included.
 *
 * This exists because of what it replaces. The previous score's accents were
 * PolySynth chord stacks held for a full measure at -6 dB, and the cold open
 * and the outro both fired them over a beating detuned-saw drone. The result
 * was the thing the player described as "loud beeping": not a mistake in any one
 * parameter, but sustained pitched material with nowhere to go, overlapping
 * itself. Plucks cannot do that. An accent may be loud, low, harsh, or all
 * three — it may not HANG.
 */
export const STINGER_MAX_SOUNDING_SEC = SECONDS_PER_BAR;

/**
 * The envelope ceiling every stinger timbre is checked against: attack <= 0.01,
 * decay <= 0.35, sustain <= 0.05, release <= 0.5. A voice inside these numbers
 * is physically incapable of the held-blast failure above.
 */
export const STINGER_ENVELOPE_CAP: EnvelopeSpec = {
  attack: 0.01,
  decay: 0.35,
  sustain: 0.05,
  release: 0.5,
};

/**
 * What every accent timbre must declare. The synth-specific extras (oscillator
 * shape, FM ratios) differ per timbre and are carried through by `as const`;
 * the two fields spelled out here are the ones the cap above is checked against.
 */
export interface StingerTimbreSpec {
  readonly envelope: EnvelopeSpec;
  readonly volume: number;
  readonly [param: string]: unknown;
}

/** The four accent timbres, all within `STINGER_ENVELOPE_CAP`. */
export const STINGER_TIMBRES = {
  /** Bright and blatty — the anthem stamp and anything ceremonial. */
  brassPluck: {
    oscillator: { type: "fatsawtooth", count: 2, spread: 18 },
    envelope: { attack: 0.008, decay: 0.3, sustain: 0.04, release: 0.4 },
    volume: -10,
  },
  /** Rough. Bad news, clusters, red ink. */
  sawPluck: {
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.004, decay: 0.26, sustain: 0.03, release: 0.35 },
    volume: -11,
  },
  /** Round and friendly. Wins, arps, celebrations. */
  trianglePluck: {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.004, decay: 0.32, sustain: 0.05, release: 0.45 },
    volume: -9,
  },
  /** The upright piano's percussive cousin, for accents that must read as paperwork. */
  keysPluck: {
    harmonicity: 3.01,
    modulationIndex: 8,
    oscillator: { type: "sine" },
    modulation: { type: "sine" },
    envelope: { attack: 0.003, decay: 0.3, sustain: 0.02, release: 0.4 },
    modulationEnvelope: { attack: 0.002, decay: 0.18, sustain: 0.02, release: 0.3 },
    volume: -12,
  },
} as const satisfies Record<StingerTimbre, StingerTimbreSpec>;

/**
 * The accent one-shots.
 *
 * `title`, `stampGood` and `stampBad` are the three that were the "beeping".
 * They are now made of the theme: `title` is literally the tune's cadence
 * (A4 -> C#5 -> D5, the grin resolving), `stampGood` is the picardy D major
 * with the F# that this score reserves for wins, and `stampBad` is the m2 grind
 * from the tension layer, stamped once and gone.
 */
export const STINGERS = {
  /**
   * The anthem stamp. Three crisp 8ths at 180 ms — a dotted-ish stride, not a
   * fanfare — doubled an octave down so it has chest, over a D2 boom and a
   * four-hit snare ruff. ~1.1 s, and then silence: the title card gets a
   * gesture, not a drone.
   */
  title: {
    soundingSec: 1.1,
    layers: [
      { kind: "arp", notes: ["A4", "C#5", "D5"], timbre: "brassPluck", duration: "8n", stepSec: 0.18, volume: -8, octaveDoubleVolume: -16 },
      { kind: "membrane", note: "D2", duration: "8n", volume: -4 },
      { kind: "ruff", velocities: [0.4, 0.6, 0.8, 1], stepSec: 0.045, volume: -12 },
    ],
  },

  /** "APPROVED". A staccato D major — the F# picardy wink is the win colour. */
  stampGood: {
    soundingSec: 0.9,
    layers: [
      // Levels are set from the offline render, not by ear: a four-note pluck
      // and a membrane landing on the same instant sum, and at -8/-3 this
      // stinger peaked at +1.2 dBFS — it was clipping at the exact moment a
      // player was told they had done well.
      { kind: "pluck", notes: ["D4", "F#4", "A4", "D5"], timbre: "trianglePluck", duration: "8n", volume: -10 },
      { kind: "membrane", note: "D2", duration: "8n", volume: -6 },
    ],
  },

  /** The red stamp. The tension layer's m2 (D-Eb) struck once, plus a slap. */
  stampBad: {
    soundingSec: 0.85,
    layers: [
      // Same clipping correction as `stampGood` (this one peaked at +0.4 dBFS).
      // A saw cluster is already the harshest timbre in the set; letting it
      // clip on top of that reads as a fault in the game, not as a verdict.
      { kind: "pluck", notes: ["D4", "Eb4", "A3"], timbre: "sawPluck", duration: "8n", volume: -13 },
      { kind: "membrane", note: "D1", duration: "8n", volume: -6 },
      { kind: "noise", durationSec: 0.15, highpassHz: 140, volume: -15 },
    ],
  },

  /**
   * The money consequence landing: impact, descent, settle. The descent
   * A4-G4-F4-D4 is the tune's own bar-10 figure, which is why a consequence
   * feels like part of the score rather than an interruption of it. The settle
   * is a half note ("2n" = 1.111 s), NOT the full measure it used to be — that
   * held chord was half the reason the outro sounded like an alarm.
   */
  consequence: {
    soundingSec: 1.85,
    layers: [
      { kind: "membrane", note: "D2", duration: "4n", volume: -3 },
      { kind: "noise", durationSec: 0.14, highpassHz: 160, volume: -14 },
      { kind: "arp", notes: ["A4", "G4", "F4", "D4"], timbre: "trianglePluck", duration: "8n", stepSec: 0.07, volume: -9 },
      { kind: "pluck", notes: ["D3", "A3", "D4"], timbre: "trianglePluck", duration: "2n", volume: -12, atSec: 0.28 },
    ],
  },

  /** Soft body blow. The cold open's punctuation. */
  thump: {
    soundingSec: 0.7,
    layers: [
      { kind: "membrane", note: "D1", duration: "4n", volume: -2 },
      { kind: "noise", durationSec: 0.12, highpassHz: 200, volume: -14 },
    ],
  },

  /** Harder, and up on the subdominant so it reads as a different blow, not a louder one. */
  hit: {
    soundingSec: 0.8,
    layers: [
      { kind: "membrane", note: "G1", duration: "4n", volume: 0 },
      { kind: "noise", durationSec: 0.2, highpassHz: 120, volume: -8 },
    ],
  },

  /** The lowest thing in the game. Weight without pitch information. */
  thud: {
    soundingSec: 0.75,
    layers: [
      { kind: "membrane", note: "A0", duration: "4n", volume: -4 },
      { kind: "noise", durationSec: 0.18, highpassHz: 90, volume: -16 },
    ],
  },

  /** A saw cluster on the b2 grind — the tension layer, stabbed. */
  stab: {
    soundingSec: 0.6,
    layers: [
      { kind: "pluck", notes: ["D3", "Eb3", "A3"], timbre: "sawPluck", duration: "8n", volume: -10 },
      { kind: "membrane", note: "D1", duration: "8n", volume: -4 },
    ],
  },

  /** Concept mastered: straight up the tonic triad, with a small crown on top. */
  mastered: {
    soundingSec: 1,
    layers: [
      { kind: "arp", notes: ["D4", "F4", "A4", "D5"], timbre: "trianglePluck", duration: "8n", stepSec: 0.075, volume: -8 },
      { kind: "membrane", note: "D2", duration: "4n", volume: -7 },
      { kind: "pluck", notes: ["D5", "F5"], timbre: "trianglePluck", duration: "4n", volume: -16, atSec: 0.3 },
    ],
  },

  /** Mastery level rose: the same idea from the relative major, higher and faster. */
  levelup: {
    soundingSec: 0.95,
    layers: [
      { kind: "arp", notes: ["F4", "A4", "D5", "F5"], timbre: "trianglePluck", duration: "8n", stepSec: 0.06, volume: -9 },
      { kind: "pluck", notes: ["A5", "D6"], timbre: "trianglePluck", duration: "4n", volume: -14, atSec: 0.24 },
    ],
  },

  /** Streak alive: a warm three-step over a soft kick — confidence, not fanfare. */
  streak: {
    soundingSec: 0.8,
    layers: [
      { kind: "membrane", note: "D1", duration: "4n", volume: -5 },
      { kind: "arp", notes: ["A3", "D4", "F4"], timbre: "trianglePluck", duration: "8n", stepSec: 0.05, volume: -9 },
    ],
  },
} as const satisfies Record<StingerId, StingerSpec>;

// ---------------------------------------------------------------------------
// Reveal stings
// ---------------------------------------------------------------------------

/**
 * `AudioEngine.playSting()` material, retuned into D minor.
 *
 * These are the outcome reveals, and they are the one place the rewrite is
 * deliberately conservative: the shapes, durations, envelopes and levels are the
 * originals to the digit, because players have already learned what they mean.
 * Only the pitches move.
 *
 * - `good` — the bright ascending triad, now D major (the same picardy F# as
 *   `stampGood`). Frequencies are given as well as note names because the
 *   engine's `blip()` primitive takes Hz; equal temperament at A4 = 440.
 * - `bad` — the low grind: a bare tritone-ish stack, now rooted on D, over a
 *   tonic thock two octaves down (the old pair was A3/D#4 over A1).
 * - `warning` — the mid two-note, now the m2 A4/Bb4: the 5th of the key rubbing
 *   against its b6. Unmistakably "careful", without being a klaxon.
 * - `neutral` — unchanged at 440 Hz. It is A4, the dominant of D minor, so it
 *   was already in the new key by accident and there is nothing to gain by
 *   moving it.
 */
export const STING_TONES = {
  good: {
    notes: ["D5", "F#5", "A5"],
    freqs: [587.33, 739.99, 880],
    wave: "triangle",
    stepSec: 0.06,
    durationSec: 0.5,
    volume: -10,
  },
  bad: {
    notes: ["D3", "Eb4"],
    wave: "sawtooth",
    durationSec: 0.6,
    volume: -10,
    thock: { note: "D1", volume: -4 },
  },
  warning: {
    notes: ["A4", "Bb4"],
    wave: "triangle",
    durationSec: 0.4,
    volume: -12,
  },
  neutral: {
    freq: 440,
    wave: "sine",
    durationSec: 0.35,
    volume: -14,
  },
} as const;
