import type { MusicCueMeta } from "./audioTypes";

/**
 * The score's cue metadata, one entry per phase group the engine actually plays.
 * Files live under public/audio/meta/*.music.json and are fetched at runtime, so
 * the (large, human-readable) cue data never enters the bundle.
 *
 * These three ARE the shipped score — `AudioEngine` renders them procedurally in
 * Tone.js rather than streaming audio files, so each cue's `stems` name synth
 * voices instead of stem files. The manifest used to point only at
 * `example-track`, a schema sample that nothing plays; the real cues existed on
 * disk but were unreachable from code.
 *
 * `phases` maps each cue to the `ScorePhase` values it covers, so a caller can go
 * from "what is playing right now" to "what is its bar grid" without a lookup
 * table living somewhere else.
 */
export const MUSIC_MANIFEST: { id: string; metaUrl: string; phases: string[] }[] = [
  { id: "score-intro", metaUrl: "/audio/meta/score-intro.music.json", phases: ["intro", "title"] },
  { id: "score-gameplay", metaUrl: "/audio/meta/score-gameplay.music.json", phases: ["menu", "gameplay"] },
  { id: "score-recap", metaUrl: "/audio/meta/score-recap.music.json", phases: ["recapGood", "recapBad"] },
];

export function metaUrlFor(id: string): string | null {
  return MUSIC_MANIFEST.find((m) => m.id === id)?.metaUrl ?? null;
}

/** The cue covering a score phase (e.g. "gameplay" → "score-gameplay"). */
export function cueIdForPhase(phase: string): string | null {
  return MUSIC_MANIFEST.find((m) => m.phases.includes(phase))?.id ?? null;
}

/** Fetch + parse a cue's metadata (browser/runtime only). */
export async function loadCueMeta(id: string): Promise<MusicCueMeta | null> {
  const url = metaUrlFor(id);
  if (!url || typeof fetch === "undefined") return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as MusicCueMeta;
  } catch {
    return null;
  }
}
