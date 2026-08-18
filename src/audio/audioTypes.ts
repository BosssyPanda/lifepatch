/**
 * Shared types for the game-music stack.
 *
 * `TimeSignature` is live code (tempo.ts / BeatClock.ts). `MusicCueMeta` and the
 * shapes under it are the SCHEMA for the cue documents in
 * public/audio/meta/*.music.json — the required per-cue metadata (bpm, key, bars,
 * loop points, sections, cue points, stems, intensity layers, transitions,
 * license notes) that CLAUDE.md mandates for every cue. Nothing fetches those
 * files at runtime: `AudioEngine` renders the score procedurally in Tone.js, so
 * the JSON is documentation of what it plays, and this is what validates it.
 */

export type TimeSignature = `${number}/${number}`;

export interface MusicSection {
  name: string;
  startBar: number;
  endBar: number;
  startSec: number;
  endSec: number;
}

export interface CuePoint {
  name: string;
  bar: number;
  sec: number;
}

export interface MusicStem {
  id: string;
  file: string;
  role: "ambience" | "rhythm" | "bass" | "harmony" | "melody" | "tension" | "danger" | "boss" | "fx";
  defaultGain: number; // 0..1
}

export interface IntensityLayer {
  level: number; // 0 = calmest
  activeStems: string[]; // stem ids active at this intensity
}

export interface TransitionRule {
  from: string; // section name or "*"
  to: string; // section name or "*"
  quantize: "beat" | "bar" | "2bars" | "4bars" | "8bars";
  type: "cut" | "crossfade" | "stinger";
  fadeBars?: number;
  stingerId?: string;
}

export interface MusicCueMeta {
  id: string;
  title: string;
  bpm: number;
  key: string;
  timeSignature: TimeSignature;
  bars: number;
  loopStartBar: number;
  loopEndBar: number;
  loopStartSec: number;
  loopEndSec: number;
  sections: MusicSection[];
  cuePoints: CuePoint[];
  stems: MusicStem[];
  intensityLayers: IntensityLayer[];
  transitions: TransitionRule[];
  licenseNotes: string;
  sourceNotes: string;
  generatedBy: string;
  humanReviewRequired: boolean;
}
