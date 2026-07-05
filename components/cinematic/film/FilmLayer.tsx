"use client";

import { motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { useMotionCtx } from "@/src/motion/MotionProvider";

/**
 * FilmLayer — the sanctioned "film exception" overlay (DESIGN.md § Film
 * Exception; allowed ONLY inside Gate / ColdOpen / Outro / hero). One
 * full-bleed canvas composites grain + flicker + vignette; a DOM overlay
 * handles one-shot flash frames. Everything else in the app stays strict
 * LEDGER — do not mount this outside the cinematics.
 *
 * Grain is a 128px noise tile re-rolled at ~12fps and pattern-filled; the
 * vignette is pre-rendered once per resize onto an offscreen canvas (canvas
 * radial, not CSS gradient); flicker is a per-frame random dim pass. Reduced
 * motion → a single static faint frame, no rAF.
 */
export function FilmLayer({
  grain = 0.5,
  flicker = 0,
  vignette = 0,
  flashKey = null,
  flashTone = "ink",
  className = "",
}: {
  grain?: number;
  flicker?: number;
  vignette?: number;
  flashKey?: string | number | null;
  flashTone?: "ink" | "loss";
  className?: string;
}) {
  const { reduced } = useMotionCtx();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const TILE = 128;
    const GRAIN_FPS = 12;
    const tile = document.createElement("canvas");
    tile.width = TILE;
    tile.height = TILE;
    const tctx = tile.getContext("2d")!;
    const noise = tctx.createImageData(TILE, TILE);

    const rollTile = () => {
      const d = noise.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        d[i] = v; d[i + 1] = v; d[i + 2] = v;
        d[i + 3] = 255;
      }
      tctx.putImageData(noise, 0, 0);
    };

    let vig: HTMLCanvasElement | null = null;
    const resize = () => {
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      canvas.width = w;
      canvas.height = h;
      if (vignette > 0) {
        vig = document.createElement("canvas");
        vig.width = w;
        vig.height = h;
        const vctx = vig.getContext("2d")!;
        const r = Math.hypot(w, h) / 2;
        const g = vctx.createRadialGradient(w / 2, h / 2, r * 0.45, w / 2, h / 2, r);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, `rgba(0,0,0,${Math.min(0.6, vignette * 0.55)})`);
        vctx.fillStyle = g;
        vctx.fillRect(0, 0, w, h);
      }
    };

    const drawFrame = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      if (grain > 0) {
        rollTile();
        ctx.globalAlpha = Math.min(0.14, grain * 0.11);
        ctx.globalCompositeOperation = "overlay";
        const pat = ctx.createPattern(tile, "repeat");
        if (pat) { ctx.fillStyle = pat; ctx.fillRect(0, 0, w, h); }
        ctx.globalCompositeOperation = "source-over";
      }
      if (flicker > 0) {
        // per-frame random dim — reads as projector flutter
        ctx.globalAlpha = Math.random() * flicker * 0.07;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
      }
      if (vig) {
        ctx.globalAlpha = 1;
        ctx.drawImage(vig, 0, 0);
      }
      ctx.globalAlpha = 1;
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    if (reduced) {
      drawFrame(); // one static faint frame
      return () => ro.disconnect();
    }

    let raf = 0;
    let last = 0;
    let running = true;
    const loop = (t: number) => {
      if (!running) return;
      if (t - last >= 1000 / GRAIN_FPS) { last = t; drawFrame(); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onVis = () => {
      running = document.visibilityState === "visible";
      if (running) { raf = requestAnimationFrame(loop); }
      else cancelAnimationFrame(raf);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      ro.disconnect();
    };
  }, [grain, flicker, vignette, reduced]);

  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 ${className}`}>
      <canvas ref={canvasRef} className="h-full w-full" />
      {flashKey != null && !reduced && (
        <motion.div
          key={flashKey}
          initial={{ opacity: 0.85 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: "linear" }}
          className="absolute inset-0"
          style={{ background: flashTone === "loss" ? "var(--color-loss)" : "var(--color-ink)" }}
        />
      )}
    </div>
  );
}
