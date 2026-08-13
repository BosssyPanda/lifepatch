/**
 * The score's tempo, named once.
 *
 * `AudioEngine` runs the whole adaptive score at this BPM and quantizes every
 * cinematic accent to the transport's 8th-note grid. Visual ceremonies have to
 * quantize to the SAME grid or the picture and the music only agree by accident,
 * so the number lives here (Tone-free, bundle-cheap) and both sides import it.
 *
 * 76 BPM in 4/4 → beat = 789.47ms, 8th = 394.74ms, bar = 3157.89ms.
 */
import type { TimeSignature } from "./audioTypes";

export const SCORE_BPM = 76;
export const SCORE_TIME_SIGNATURE: TimeSignature = "4/4";
export const SCORE_BEATS_PER_BAR = 4;

/** Milliseconds per beat / bar at the score tempo. */
export const MS_PER_BEAT = 60_000 / SCORE_BPM;
export const MS_PER_BAR = MS_PER_BEAT * SCORE_BEATS_PER_BAR;

/**
 * How early a quantized accent must be REQUESTED for it to land on the grid
 * point you meant. `AudioEngine.accent()` rounds up to the transport's next 8th,
 * so asking for one exactly on a boundary buys the boundary after it (a whole
 * half-beat late). Callers that want an accent to coincide with a visual beat
 * fire the request this far ahead of it; the engine's own quantization then
 * resolves it onto the intended instant.
 */
export const ACCENT_PREROLL_MS = 120;
