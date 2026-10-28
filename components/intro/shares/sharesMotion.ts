/**
 * Era five's scroll beats (the VOC shares, 1602), as pure functions of the scene's progress (0 → 1),
 * so they can be read and tested without three.
 *
 *   0.00–0.12  dark: only the receipt and the silver in the coffer are lit (the hand-off from the last era)
 *   0.12–0.32  the quay comes up round them
 *   0.32–0.80  the plateau: the camera sways a little sideways and back, so the money ends where it began
 *   0.80–1.00  the quay goes dark round the money again (the hand-off to the next era)
 */

export function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export const LIGHT_UP = [0.12, 0.32] as const;
export const PLATEAU = [0.32, 0.8] as const;
export const GO_DARK = [0.82, 0.98] as const;

/** The dark the era sits in round its money: what the Blender transition frame uses (kit.dim). */
export const DARK = 0.04;

/** The quay's light, as a multiple of what the screen shows: DARK → 1 → DARK. */
export function eraLight(p: number) {
  const up = smoothstep(LIGHT_UP[0], LIGHT_UP[1], p);
  const down = smoothstep(GO_DARK[0], GO_DARK[1], p);
  return DARK + (1 - DARK) * up * (1 - down);
}

/** The plateau's sway, 0 → 1 → 0 as one slow half sine, so the camera is back on the money spot for
 * the hand-offs. */
export function sway(p: number) {
  const t = Math.min(1, Math.max(0, (p - PLATEAU[0]) / (PLATEAU[1] - PLATEAU[0])));
  return Math.sin(t * Math.PI);
}
