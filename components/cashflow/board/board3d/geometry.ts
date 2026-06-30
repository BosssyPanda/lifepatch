/**
 * 3D layout math for the Rat Race board ring.
 *
 * Ports the 2D rounded-rectangle perimeter spacing from the original
 * `Board.tsx` (`perimeterPoints`) onto a flat XZ plane so the same data
 * contract drives both the 24-tile rat ring and the 16-tile fast track.
 *
 * The board lies on the y=0 plane; the camera looks down at a 3/4 angle.
 * Coordinates are in world units centered on the origin.
 */

/** Half-extent of the square ring in world units (the ring spans [-RING, RING]). */
export const RING = 5;

/** Per-tile footprint. Kept just under the corner pitch so tiles never overlap. */
export const TILE_W = 1.18;
export const TILE_D = 1.18;
export const TILE_H = 0.34;
export const TILE_BEVEL = 0.05;

/** How far the active tile lifts along +Y when it becomes the player's square. */
export const ACTIVE_LIFT = 0.22;
/** How far a tile lifts on hover. */
export const HOVER_LIFT = 0.08;

/** Token hop tuning. */
export const TOKEN_RADIUS = 0.3;
export const TOKEN_REST_Y = TILE_H / 2 + 0.34;
export const HOP_HEIGHT = 0.95;

export type TilePoint = {
  /** world X */
  x: number;
  /** world Z */
  z: number;
  /** facing yaw (radians) so tiles/labels orient toward the board center */
  yaw: number;
};

/**
 * Evenly distribute `n` points around the square ring perimeter, matching the
 * original 2D algorithm's edge-walking (top → right → bottom → left). Returns
 * world XZ positions plus a yaw that turns each tile's "up" edge toward center.
 */
export function ringPoints(n: number): TilePoint[] {
  const a = 2 * RING; // side length of the ring square
  const per = 4 * a; // full perimeter
  const pts: TilePoint[] = [];

  for (let i = 0; i < n; i++) {
    const d = (i / n) * per;
    let x: number;
    let z: number;
    let yaw: number;

    if (d < a) {
      // top edge: left → right
      x = -RING + d;
      z = -RING;
      yaw = 0;
    } else if (d < 2 * a) {
      // right edge: top → bottom
      x = RING;
      z = -RING + (d - a);
      yaw = -Math.PI / 2;
    } else if (d < 3 * a) {
      // bottom edge: right → left
      x = RING - (d - 2 * a);
      z = RING;
      yaw = Math.PI;
    } else {
      // left edge: bottom → top
      x = -RING;
      z = RING - (d - 3 * a);
      yaw = Math.PI / 2;
    }

    pts.push({ x, z, yaw });
  }

  return pts;
}

/**
 * Quadratic-bezier arc sample for a single hop between two tiles. `t` in [0,1].
 * Peaks at `HOP_HEIGHT * height` so longer multi-step jumps can scale the arc.
 */
export function hopArc(
  from: TilePoint,
  to: TilePoint,
  t: number,
  height = HOP_HEIGHT,
): { x: number; y: number; z: number } {
  const ease = t;
  const x = from.x + (to.x - from.x) * ease;
  const z = from.z + (to.z - from.z) * ease;
  // parabola: 0 at the ends, 1 at the middle
  const y = TOKEN_REST_Y + Math.sin(Math.PI * t) * height;
  return { x, y, z };
}
