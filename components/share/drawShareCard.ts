import QRCode from "qrcode";
import { sparkGlyphs } from "@/components/ui/BlockSpark";

/**
 * Canvas-rendered LEDGER share card (Addendum A §7.2). Palette-locked "printed
 * statement": wordmark, STATEMENT NO. doc code, the verdict word (in its archetype
 * hue), net-worth figure + sparkline, years survived, one stat, and a scannable
 * ink-on-paper QR to the game. Two formats: story (1080×1920) and og (1200×630).
 * All values are passed in from real run data — nothing fabricated here.
 */

export type ShareFormat = "story" | "og";
export const FORMATS: Record<ShareFormat, { w: number; h: number }> = {
  story: { w: 1080, h: 1920 },
  og: { w: 1200, h: 630 },
};

export type ShareCardData = {
  verdict: string;
  verdictHex: string;
  netWorth: number;
  netWorthText: string;
  years: number;
  runId: string;
  history: number[]; // net-worth series
  statLabel: string;
  statValue: string;
  url: string;
};

const BG = "#0e0e0c";
const INK = "#f2f1ea";
const DIM = "#8f8e85";
const HAIR = "#2a2a25";
const GAIN = "#2bd576";
const LOSS = "#ff3b30";

/** Resolve the actual loaded font-family for a LEDGER class (next/font names are hashed). */
function fontFamily(kind: "anton" | "mono"): string {
  if (typeof document === "undefined") return kind === "anton" ? "Anton, sans-serif" : "monospace";
  const el = document.createElement("span");
  el.className = kind === "anton" ? "font-anton" : "num";
  el.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
  document.body.appendChild(el);
  const ff = getComputedStyle(el).fontFamily;
  el.remove();
  return ff || (kind === "anton" ? "Anton, sans-serif" : "monospace");
}

function drawSparkline(ctx: CanvasRenderingContext2D, values: number[], x: number, y: number, w: number, h: number) {
  if (values.length < 2) return;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = max - min || 1;
  const zeroY = y + h - ((0 - min) / range) * h;
  ctx.strokeStyle = DIM;
  ctx.globalAlpha = 0.5;
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, zeroY);
  ctx.lineTo(x + w, zeroY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  const up = values[values.length - 1] >= (values[0] ?? 0);
  ctx.strokeStyle = up ? GAIN : LOSS;
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.beginPath();
  values.forEach((v, i) => {
    const px = x + (i / (values.length - 1)) * w;
    const py = y + h - ((v - min) / range) * h;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
}

async function drawQR(ctx: CanvasRenderingContext2D, url: string, x: number, y: number, size: number) {
  // ink-on-paper: dark modules on a light quiet-zone panel — maximally scannable
  const dataUrl = await QRCode.toDataURL(url, { margin: 2, width: size, color: { dark: BG, light: INK }, errorCorrectionLevel: "M" });
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  ctx.drawImage(img, x, y, size, size);
}

export async function drawShareCard(format: ShareFormat, data: ShareCardData): Promise<HTMLCanvasElement> {
  if (typeof document !== "undefined" && document.fonts?.ready) {
    try { await document.fonts.ready; } catch {}
  }
  const { w, h } = FORMATS[format];
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const anton = fontFamily("anton");
  const mono = fontFamily("mono");

  // ground + hairline frame
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  const pad = format === "story" ? 56 : 40;
  ctx.strokeStyle = HAIR;
  ctx.lineWidth = 2;
  ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);

  const left = pad + (format === "story" ? 44 : 40);
  const right = w - pad - (format === "story" ? 44 : 40);

  const label = (t: string, x: number, y: number, size: number, color = DIM, align: CanvasTextAlign = "left") => {
    ctx.font = `600 ${size}px ${mono}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(t.toUpperCase(), x, y);
  };

  // ---- top rail: wordmark + doc code ----
  ctx.font = `${format === "story" ? 44 : 40}px ${anton}`;
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("LIFEPATCH", left, pad + (format === "story" ? 96 : 78));
  label(`STATEMENT NO. ${data.runId}`, right, pad + (format === "story" ? 92 : 74), format === "story" ? 22 : 20, DIM, "right");
  const railY = pad + (format === "story" ? 128 : 104);
  ctx.strokeStyle = HAIR;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left, railY);
  ctx.lineTo(right, railY);
  ctx.stroke();

  if (format === "story") {
    label("FINAL VERDICT", left, 512, 26, DIM);
    let vsize = 150;
    ctx.font = `${vsize}px ${anton}`;
    while (ctx.measureText(data.verdict.toUpperCase()).width > right - left && vsize > 60) {
      vsize -= 6;
      ctx.font = `${vsize}px ${anton}`;
    }
    ctx.fillStyle = data.verdictHex;
    ctx.textAlign = "left";
    ctx.fillText(data.verdict.toUpperCase(), left, 700);

    label("NET WORTH", left, 900, 26, DIM);
    ctx.font = `120px ${anton}`;
    ctx.fillStyle = data.netWorth >= 0 ? GAIN : LOSS;
    ctx.fillText(data.netWorthText, left, 1010);
    drawSparkline(ctx, data.history, left, 1060, right - left, 200);
    if (data.history.length > 1) {
      // block-glyph strip (§13 #7) — the same series as text, departure-mono flavored
      ctx.font = `36px ${mono}`;
      ctx.fillStyle = data.history[data.history.length - 1] >= data.history[0] ? GAIN : LOSS;
      ctx.textAlign = "left";
      ctx.fillText(sparkGlyphs(data.history), left, 1330);
    }

    const rowY = 1420;
    const drawRow = (lab: string, val: string, y: number) => {
      ctx.font = `600 30px ${mono}`;
      ctx.textAlign = "left";
      ctx.fillStyle = INK;
      const labU = lab.toUpperCase();
      ctx.fillText(labU, left, y);
      ctx.textAlign = "right";
      ctx.fillText(val, right, y);
      const lw = ctx.measureText(val).width;
      ctx.textAlign = "left";
      const lx = left + ctx.measureText(labU).width + 20;
      ctx.strokeStyle = "#3a3a33";
      ctx.setLineDash([2, 8]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(lx, y - 8);
      ctx.lineTo(right - lw - 20, y - 8);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    drawRow("Years survived", String(data.years), rowY);
    drawRow(data.statLabel, data.statValue, rowY + 60);

    const qr = 300;
    const qx = left;
    const qy = h - pad - qr - 60;
    await drawQR(ctx, data.url, qx, qy, qr);
    label("SCAN TO PLAY", qx + qr + 40, qy + 90, 26, INK);
    label("SURVIVE THE", qx + qr + 40, qy + 140, 22, DIM);
    label("INTERNET ECONOMY", qx + qr + 40, qy + 172, 22, DIM);
    label(data.url.replace(/^https?:\/\//, ""), qx + qr + 40, qy + qr - 6, 18, DIM);
  } else {
    label("FINAL VERDICT", left, 220, 22, DIM);
    let vsize = 96;
    ctx.font = `${vsize}px ${anton}`;
    const maxV = w * 0.58 - left;
    while (ctx.measureText(data.verdict.toUpperCase()).width > maxV && vsize > 44) {
      vsize -= 4;
      ctx.font = `${vsize}px ${anton}`;
    }
    ctx.fillStyle = data.verdictHex;
    ctx.textAlign = "left";
    ctx.fillText(data.verdict.toUpperCase(), left, 320);

    label("NET WORTH", left, 410, 22, DIM);
    ctx.font = `64px ${anton}`;
    ctx.fillStyle = data.netWorth >= 0 ? GAIN : LOSS;
    ctx.fillText(data.netWorthText, left, 470);
    drawSparkline(ctx, data.history, left, 500, w * 0.5, 80);

    const qr = 240;
    const qx = right - qr;
    const qy = pad + 120;
    await drawQR(ctx, data.url, qx, qy, qr);
    label("SCAN TO PLAY", qx, qy + qr + 34, 20, INK);
  }

  return canvas;
}
