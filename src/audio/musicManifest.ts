import type { MusicCueMeta } from "./audioTypes";

/**
 * References cue metadata files under public/audio/meta/*.music.json.
 * Add cue ids here as they are authored; metadata is fetched at runtime
 * (keep music data out of the bundle).
 */
export const MUSIC_MANIFEST: { id: string; metaUrl: string }[] = [
  { id: "example-track", metaUrl: "/audio/meta/example-track.music.json" },
];

export function metaUrlFor(id: string): string | null {
  return MUSIC_MANIFEST.find((m) => m.id === id)?.metaUrl ?? null;
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
