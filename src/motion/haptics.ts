/**
 * Impact haptics (Addendum A §13 extra #11). A thin guard around
 * `navigator.vibrate` for the two impact moments (consequence-beat land, verdict
 * resolve). Android-only by platform support (iOS Safari has no vibrate API —
 * silently no-ops there). Tied to the audio mute switch: muted play = no buzz.
 */
export function buzz(pattern: number | number[], muted: boolean): void {
  if (muted) return;
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* unsupported / blocked — never throw from a decoration */
  }
}

/** House patterns — short and dry, matching the stamp/thud audio accents. */
export const BUZZ = {
  land: 30,
  verdict: [40, 60, 40] as number[],
} as const;
