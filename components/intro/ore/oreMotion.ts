/**
 * The ore scene's motion, as plain numbers so it can be checked without a browser.
 *
 * Angles are turns about the ore's upright axis, in radians. At 0 the crack (the mesh's +Z side)
 * faces +Z. The opening camera sits on +Z, so the scene opens on a half turn: the ore's back, with
 * the crack hidden. The user may drag it round any number of times; scrolling then takes over and
 * turns it the short way round until the crack faces the camera, and the camera dives in.
 */

/** Where scroll progress (0 at the top, 1 at the end of scene one) hands from one phase to the next. */
export const TURN_END = 0.3; // 0 → 0.3: the ore turns until the crack faces the camera
export const FADE_START = 0.78; // 0.78 → 1: the view inside the crack goes to warm white

/** The opening: the ore's back to the camera. */
export const OPENING_ANGLE = Math.PI;

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function smoothstep(a: number, b: number, x: number) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export function easeInOutCubic(t: number) {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** The signed turn from `from` to `to` that goes the short way round, in (-π, π]. */
export function shortestTurn(from: number, to: number) {
  const d = (to - from) % (2 * Math.PI);
  if (d > Math.PI) return d - 2 * Math.PI;
  if (d <= -Math.PI) return d + 2 * Math.PI;
  return d;
}

/**
 * The ore's angle for a scroll position. At the top it is wherever the user left it; through the
 * turn phase it eases the short way to `crackAngle`; after that it holds. Scrolling back up
 * retraces the same path, so the top gives the user's own angle back.
 */
export function oreAngle(userAngle: number, crackAngle: number, progress: number) {
  const k = easeInOutCubic(progress / TURN_END);
  return userAngle + shortestTurn(userAngle, crackAngle) * k;
}

/** How far the dive has gone, 0 → 1, for a scroll position. */
export function diveAmount(progress: number) {
  return easeInOutCubic((progress - TURN_END) / (1 - TURN_END));
}

/** Opacity of the warm-white sheet that ends the dive. */
export function whiteOut(progress: number) {
  return smoothstep(FADE_START, 1, progress);
}

/**
 * How much the crack faces the camera, from -1 (straight away) to 1 (straight at it), given the
 * ore's angle and the camera's direction round the ore.
 */
export function crackFacing(angle: number, cameraAngle: number) {
  return Math.cos(angle - cameraAngle);
}

/**
 * Drag momentum: after the pointer lets go the ore keeps turning and slows to a stop.
 * `velocity` is in radians per second; returns the new velocity after `dt` seconds.
 */
export const SPIN_SETTLE = 0.45; // seconds for the spin to lose about two thirds of its speed
export const MAX_SPIN = 9; // radians per second, so a hard flick cannot blur the ore
export function settle(velocity: number, dt: number) {
  const v = velocity * Math.exp(-dt / SPIN_SETTLE);
  return Math.abs(v) < 0.01 ? 0 : v;
}
