/**
 * The adaptive engine now lives in AudioEngine.ts (a full Tone.js
 * implementation). This module re-exports it for backwards-compatible imports.
 * @see ./AudioEngine
 */
export { AudioEngine, AudioEngine as AdaptiveMusicEngine } from "./AudioEngine";
export type { ScorePhase, AccentKind } from "./AudioEngine";
