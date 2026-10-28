/**
 * The cave scene's motion, as plain numbers so it can be checked without a browser.
 *
 * Scroll progress runs 0 → 1 through scene two. It opens where scene one ended, on warm white: the
 * white thins to the fire's own glow while the camera pulls back from the flames to the scene's
 * shot. The shot then holds, easing in a little. At the end everything but the gold goes dark, the
 * transition frame every era ends on.
 */

import { clamp01, easeInOutCubic, smoothstep } from "../ore/oreMotion";

/** Where scroll progress hands from one phase to the next. */
export const WHITE_END = 0.12; // 0 → 0.12: the white from scene one thins away
export const PULL_END = 0.32; // 0 → 0.32: the camera pulls back from the fire to the shot
export const DIM_START = 0.8; // 0.8 → 1: the cave goes dark round its gold
export const DIM_FLOOR = 0.025; // how much light is left at the end (Blender's transition frames)

/** Opacity of the white laid over the canvas. */
export function whiteIn(p: number) {
  return 1 - smoothstep(0, WHITE_END, p);
}

/** How far the camera has pulled back from the fire, 0 → 1. */
export function pullBack(p: number) {
  return easeInOutCubic(p / PULL_END);
}

/** The slow push in while the shot holds, 0 → 1. */
export function drift(p: number) {
  return smoothstep(PULL_END, 1, p);
}

/** The light left on everything but the gold. */
export function caveLight(p: number) {
  const t = smoothstep(DIM_START, 1, p);
  return 1 - (1 - DIM_FLOOR) * t;
}

/**
 * The fire's flicker at time t (s): a few incommensurate waves, so it never visibly repeats,
 * about ±6% round 1.
 */
export function flicker(t: number) {
  const w = 0.5 * Math.sin(t * 7.3) + 0.3 * Math.sin(t * 12.9 + 1.7) + 0.2 * Math.sin(t * 3.1 + 0.4);
  return 1 + 0.06 * w;
}

export { clamp01, smoothstep };
