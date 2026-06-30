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

const SIZE = 512; // texture resolution per tile face (high so glyph/label stay crisp at the oblique camera angle)
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

/**
 * Draw a compact vector glyph centered in a box at (cx, cy) of half-size hs.
 * `weight` scales the stroke (a darker "shadow" pass uses a heavier weight so the
 * bright ink pass reads as a haloed engraving from the camera angle).
 */
function drawGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: Glyph,
  cx: number,
  cy: number,
  hs: number,
  ink: string,
  weight = 0.22,
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = hs * weight;
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
  const S = (n: number) => n * (SIZE / 256); // scale helper: tuned at 256, rendered at SIZE

  // plate base — vertical gradient gives the face a lit, raised feel
  const grad = ctx.createLinearGradient(0, 0, 0, SIZE);
  grad.addColorStop(0, shade(color, 0.3));
  grad.addColorStop(0.55, shade(color, 0.04));
  grad.addColorStop(1, shade(color, -0.34));
  ctx.fillStyle = grad;
  roundRect(ctx, S(6), S(6), SIZE - S(12), SIZE - S(12), S(26));
  ctx.fill();

  // engraved inner keyline
  ctx.strokeStyle = withAlpha("#000000", 0.32);
  ctx.lineWidth = S(3);
  roundRect(ctx, S(22), S(22), SIZE - S(44), SIZE - S(44), S(18));
  ctx.stroke();
  ctx.strokeStyle = shade(color, 0.5);
  ctx.lineWidth = S(1.5);
  roundRect(ctx, S(24), S(24), SIZE - S(48), SIZE - S(48), S(17));
  ctx.stroke();

  // ── recessed contrast plate ──────────────────────────────────────────────
  // A semi-opaque dark panel behind the glyph + label so bright ink reads at
  // the 3/4 camera regardless of how light/saturated the tile tint is. This is
  // the fix for "tiles read as plain colored blocks" — the legend now sits on
  // its own surface with depth instead of floating on the tint.
  const plateX = S(34);
  const plateY = S(70);
  const plateW = SIZE - S(68);
  const plateH = SIZE - S(104);
  // soft drop under the plate for a raised-legend feel
  ctx.fillStyle = withAlpha("#000000", 0.34);
  roundRect(ctx, plateX, plateY + S(4), plateW, plateH, S(20));
  ctx.fill();
  // the plate itself — dark, slightly warm so it sits in the palette
  const plateGrad = ctx.createLinearGradient(0, plateY, 0, plateY + plateH);
  plateGrad.addColorStop(0, withAlpha("#161109", 0.78));
  plateGrad.addColorStop(1, withAlpha("#0c0906", 0.86));
  ctx.fillStyle = plateGrad;
  roundRect(ctx, plateX, plateY, plateW, plateH, S(20));
  ctx.fill();
  // bright tint keyline frames the plate and ties it back to the tile color
  ctx.strokeStyle = shade(color, 0.6);
  ctx.lineWidth = S(2);
  roundRect(ctx, plateX + S(1), plateY + S(1), plateW - S(2), plateH - S(2), S(19));
  ctx.stroke();

  // ── glyph — large, bright, with a dark halo pass for separation ──────────
  const glyphCx = SIZE / 2;
  const glyphCy = SIZE * 0.4;
  const glyphHs = SIZE * 0.2; // up from 0.16 → noticeably larger at the camera
  // dark halo first (heavier weight)
  drawGlyph(ctx, glyph, glyphCx, glyphCy, glyphHs, withAlpha("#000000", 0.9), 0.34);
  // bright ink on top — near-paper so it pops off the dark plate
  const ink = shade(color, 0.86);
  drawGlyph(ctx, glyph, glyphCx, glyphCy, glyphHs, ink, 0.2);

  // ── label — big, high-contrast, real outline (not just a soft drop) ──────
  const labelY = SIZE * 0.78;
  ctx.font = `700 ${SIZE * 0.16}px "Arial Narrow", Oswald, sans-serif`; // up from 0.13
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // dark stroke outline behind the fill for legibility on any tint
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.strokeStyle = withAlpha("#000000", 0.92);
  ctx.lineWidth = S(6);
  ctx.strokeText(label, glyphCx, labelY);
  // near-white fill
  ctx.fillStyle = "#f3ecd9";
  ctx.fillText(label, glyphCx, labelY);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16; // oblique angle → max anisotropic filtering keeps text crisp
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  cache.set(key, tex);
  return tex;
}

/** Dispose every cached texture (call on board unmount). */
export function disposeTileTextures() {
  cache.forEach((t) => t.dispose());
  cache.clear();
}
