"use client";

import { useEffect, useRef } from "react";
import { PALETTE } from "@/lib/palette";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { familyOf } from "@/components/cinematic/canvasFont";

/**
 * ASCII-render title layer (Addendum §13 #6). The Phase G board-orbit loop,
 * re-rendered live as a block-glyph character grid behind the title hero at
 * ~20% opacity. LEDGER charset only; cells whose source pixel is red/green
 * dominant keep that accent (quantized to the exact loss/gain hexes), the rest
 * render in ink with luminance driving glyph density. The rAF loop runs only
 * while the layer is mounted, on-screen, and the tab is visible; reduced
 * motion renders a single static frame from the poster instead.
 */

const RAMP = [" ", "·", ":", "░", "▒", "▓", "█"] as const;
const CELL = 12; // css px per glyph cell
const FPS_MS = 50; // ~20fps — matches the 24fps source closely enough
const INK = PALETTE.ink;
const LOSS = PALETTE.loss;
const GAIN = PALETTE.gain;

export function TitleAscii() {
  const { reduced } = useMotionCtx();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const font = familyOf("num", "monospace");
    const sample = document.createElement("canvas");
    const sctx = sample.getContext("2d", { willReadFrequently: true });
    if (!sctx) return;

    let cols = 0;
    let rows = 0;
    let raf = 0;
    let last = 0;
    let onScreen = true;
    let disposed = false;

    const size = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cols = Math.max(24, Math.ceil(w / CELL));
      rows = Math.max(16, Math.ceil(h / CELL));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${CELL}px ${font}`;
      ctx.textBaseline = "top";
      sample.width = cols;
      sample.height = rows;
    };

    const paint = (source: CanvasImageSource, sw: number, sh: number) => {
      // cover-crop the source onto the cell grid
      const cw = host.clientWidth;
      const ch = host.clientHeight;
      if (cw === 0 || ch === 0 || sw === 0 || sh === 0) return;
      const scale = Math.max(cw / sw, ch / sh);
      const srcW = cw / scale;
      const srcH = ch / scale;
      sctx.drawImage(source, (sw - srcW) / 2, (sh - srcH) / 2, srcW, srcH, 0, 0, cols, rows);
      const px = sctx.getImageData(0, 0, cols, rows).data;

      ctx.clearRect(0, 0, cw, ch);
      let color = "";
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = (r * cols + c) * 4;
          const R = px[i];
          const G = px[i + 1];
          const B = px[i + 2];
          const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
          const glyph = RAMP[Math.min(RAMP.length - 1, Math.floor((lum / 255) * RAMP.length))];
          if (glyph === " ") continue;
          const next = R > 80 && R > G * 1.6 && R > B * 1.6 ? LOSS : G > 80 && G > R * 1.4 && G > B * 1.4 ? GAIN : INK;
          if (next !== color) {
            ctx.fillStyle = next;
            color = next;
          }
          ctx.fillText(glyph, c * CELL, r * CELL);
        }
      }
    };

    size();
    const ro = new ResizeObserver(size);
    ro.observe(host);

    // ── reduced motion: one static frame from the poster, no video, no loop ──
    if (reduced) {
      const img = new Image();
      img.onload = () => {
        if (!disposed) paint(img, img.naturalWidth, img.naturalHeight);
      };
      img.src = "/board3d/board-poster.jpg";
      return () => {
        disposed = true;
        ro.disconnect();
      };
    }

    // ── live path: hidden video → glyph grid at ~20fps ──
    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "none";
    const webm = document.createElement("source");
    webm.src = "/board3d/board-orbit.webm";
    webm.type = "video/webm";
    const mp4 = document.createElement("source");
    mp4.src = "/board3d/board-orbit.mp4";
    mp4.type = "video/mp4";
    video.append(webm, mp4);
    video.load();
    void video.play().catch(() => {});

    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
    });
    io.observe(host);

    const onVisibility = () => {
      if (document.hidden) video.pause();
      else void video.play().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisibility);

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (!onScreen || video.paused || video.readyState < 2) return;
      if (t - last < FPS_MS) return;
      last = t;
      paint(video, video.videoWidth, video.videoHeight);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      video.pause();
      video.removeAttribute("src");
    };
  }, [reduced]);

  return (
    <div ref={hostRef} aria-hidden className="absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} style={{ opacity: 0.2 }} />
    </div>
  );
}
