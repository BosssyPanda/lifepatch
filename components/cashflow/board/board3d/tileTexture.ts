/**
 * Canvas → CanvasTexture factory for the top face of each board tile.
 *
 * Each tile face is painted once (cached by type+label) as a small editorial
 * "stamp": a tinted plate, a hairline inner keyline, a vector glyph, and the
 * short label set in the display typeface. This reads as a designed token at a
 * 3/4 camera angle instead of a flat tint.
 */

import * as THREE from "three";
import type { Glyph } from "./palette";

const SIZE = 256; // texture resolution per tile face
const cache = new Map<string, THREE.CanvasTexture>();

/** Mix a hex color toward white/black by `amt` (-1 dark … +1 light). */
function shade(hex: string, amt: number): string {
  const c = hex.replace("#", "");
  const full = c.length === 3 ? c.split("").map((x) => x + x).join("") : c;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const t = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  const mix = (ch: number) => Math.round((t - ch) * p + ch);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function withAlpha(hex: string, a: number): string {
  const c = hex.replace("#", "");
  const full = c.length === 3 ? c.split("").map((x) => x + x).join("") : c;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draw a compact vector glyph centered in a box at (cx, cy) of half-size hs. */
function drawGlyph(ctx: CanvasRenderingContext2D, glyph: Glyph, cx: number, cy: number, hs: number, ink: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = hs * 0.16;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  switch (glyph) {
    case "deal":
    case "invest": {
      // upward arrow / growth chevrons
      ctx.beginPath();
      ctx.moveTo(-hs, hs * 0.6);
      ctx.lineTo(-hs * 0.2, -hs * 0.2);
      ctx.lineTo(hs * 0.3, hs * 0.25);
      ctx.lineTo(hs, -hs * 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hs * 0.4, -hs * 0.7);
      ctx.lineTo(hs, -hs * 0.7);
      ctx.lineTo(hs, -hs * 0.1);
      ctx.stroke();
      break;
    }
    case "payday": {
      // coin with slot
      ctx.beginPath();
      ctx.arc(0, 0, hs * 0.78, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = `700 ${hs * 1.1}px Georgia, serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("$", 0, hs * 0.06);
      break;
    }
    case "doodad": {
      // shopping tag
      ctx.beginPath();
      ctx.moveTo(-hs * 0.2, -hs * 0.8);
      ctx.lineTo(hs * 0.8, -hs * 0.8);
      ctx.lineTo(hs * 0.8, hs * 0.2);
      ctx.lineTo(-hs * 0.1, hs * 0.9);
      ctx.lineTo(-hs * 0.8, hs * 0.1);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hs * 0.45, -hs * 0.45, hs * 0.13, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "charity": {
      // heart-hand / open hand with heart
      ctx.beginPath();
      const r = hs * 0.42;
      ctx.moveTo(0, hs * 0.7);
      ctx.bezierCurveTo(-hs * 1.1, -hs * 0.1, -hs * 0.2, -hs * 0.95, 0, -hs * 0.25);
      ctx.bezierCurveTo(hs * 0.2, -hs * 0.95, hs * 1.1, -hs * 0.1, 0, hs * 0.7);
      ctx.closePath();
      ctx.stroke();
      void r;
      break;
    }
    case "market": {
      // candlestick chart
      const bars = [-0.6, -0.1, 0.4];
      const heights = [0.5, 0.85, 0.65];
      bars.forEach((bx, i) => {
        const h = heights[i] * hs;
        ctx.beginPath();
        ctx.moveTo(bx * hs, -h);
        ctx.lineTo(bx * hs, h);
        ctx.stroke();
        ctx.fillRect(bx * hs - hs * 0.16, -h * 0.4, hs * 0.32, h * 0.8);
      });
      break;
    }
    case "baby": {
      // small head + body
      ctx.beginPath();
      ctx.arc(0, -hs * 0.4, hs * 0.35, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, hs * 0.55, hs * 0.55, Math.PI, 0);
      ctx.stroke();
      break;
    }
    case "downsized":
    case "loss": {
      // downward arrow
      ctx.beginPath();
      ctx.moveTo(-hs, -hs * 0.6);
      ctx.lineTo(-hs * 0.2, hs * 0.2);
      ctx.lineTo(hs * 0.3, -hs * 0.25);
      ctx.lineTo(hs, hs * 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hs * 0.4, hs * 0.7);
      ctx.lineTo(hs, hs * 0.7);
      ctx.lineTo(hs, hs * 0.1);
      ctx.stroke();
      break;
    }
    case "dream": {
      // star
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const ang = (Math.PI / 5) * i - Math.PI / 2;
        const rad = i % 2 === 0 ? hs : hs * 0.42;
        const px = Math.cos(ang) * rad;
        const py = Math.sin(ang) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      break;
    }
    default: {
      ctx.beginPath();
      ctx.arc(0, 0, hs * 0.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Build (and cache) a CanvasTexture for one tile face.
 * @param color resolved theme hex for this tile type
 * @param glyph which vector glyph to engrave
 * @param label short uppercase label (e.g. "DEAL")
 */
export function tileFaceTexture(color: string, glyph: Glyph, label: string): THREE.CanvasTexture {
  const key = `${color}|${glyph}|${label}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;

  // plate base — vertical gradient gives the face a lit, raised feel
  const grad = ctx.createLinearGradient(0, 0, 0, SIZE);
  grad.addColorStop(0, shade(color, 0.28));
  grad.addColorStop(0.55, shade(color, 0.02));
  grad.addColorStop(1, shade(color, -0.32));
  ctx.fillStyle = grad;
  roundRect(ctx, 6, 6, SIZE - 12, SIZE - 12, 26);
  ctx.fill();

  // engraved inner keyline
  ctx.strokeStyle = withAlpha("#000000", 0.32);
  ctx.lineWidth = 3;
  roundRect(ctx, 22, 22, SIZE - 44, SIZE - 44, 18);
  ctx.stroke();
  ctx.strokeStyle = shade(color, 0.45);
  ctx.lineWidth = 1.5;
  roundRect(ctx, 24, 24, SIZE - 48, SIZE - 48, 17);
  ctx.stroke();

  // glyph — light ink for legibility on the tinted plate
  const ink = shade(color, 0.6);
  drawGlyph(ctx, glyph, SIZE / 2, SIZE * 0.42, SIZE * 0.16, ink);

  // label in the display caps style with a soft drop for depth
  ctx.font = `600 ${SIZE * 0.13}px "Arial Narrow", Oswald, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = withAlpha("#000000", 0.4);
  ctx.fillText(label, SIZE / 2 + 1.5, SIZE * 0.78 + 1.5);
  ctx.fillStyle = shade(color, 0.72);
  ctx.fillText(label, SIZE / 2, SIZE * 0.78);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

/** Dispose every cached texture (call on board unmount). */
export function disposeTileTextures() {
  cache.forEach((t) => t.dispose());
  cache.clear();
}
