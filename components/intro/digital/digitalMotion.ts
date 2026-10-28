/**
 * Scene 07's scroll beats, as pure functions of the scene's progress (0 → 1), so they can be read
 * and tested without three.
 *
 *   0.00–0.12  dark: only the phone on its stand is lit (the hand-off from the vault)
 *   0.12–0.34  the board lights row by row, then the room comes up with it
 *   0.34–0.80  the plateau: the camera drifts slowly across the floor; the tape keeps running
 *   0.80–1.00  the room goes dark round the number and the camera pulls back past the floor
 */

export function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export const LIGHT_UP = [0.12, 0.34] as const;
export const PLATEAU = [0.34, 0.8] as const;
export const PULL = [0.8, 1.0] as const;

// Light levels are multiples of what the screen shows (not of the light), so 0.5 reads as half as bright.

/** The dark the scene sits in before it lights: about what the overview's dimmed frames show. */
export const DARK = 0.04;
/** How lit the room stays while the camera pulls back past it: enough to read the diorama. */
export const PULL_LIGHT = 0.55;

/** How far down the board its lamps are lit, 0 (none) → 1 (all rows): the board leads the room. */
export function boardReveal(p: number) {
  return smoothstep(LIGHT_UP[0], LIGHT_UP[0] + 0.14, p);
}

/** The room's light, DARK → 1 → PULL_LIGHT, as a multiple of the baked light. */
export function roomLight(p: number) {
  const up = smoothstep(LIGHT_UP[0] + 0.06, LIGHT_UP[1], p);
  const down = smoothstep(PULL[0], PULL[0] + 0.08, p);
  const lit = DARK + (1 - DARK) * up;
  return lit + (PULL_LIGHT - lit) * down;
}

/** The plateau's drift, 0 → 1, eased at both ends. */
export function drift(p: number) {
  return smoothstep(PLATEAU[0] - 0.1, PLATEAU[1], p);
}

/** The pull-back from the plateau camera to the wide one, 0 → 1. */
export function pull(p: number) {
  return smoothstep(PULL[0] + 0.03, PULL[1], p);
}
