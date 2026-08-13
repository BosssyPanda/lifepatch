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

  // Intensities are READ, never depended on. This effect owns the whole canvas
  // pipeline (noise tile, vignette pre-render, rAF loop), and Outro flips `grain`
  // from 0.6 → 0.22 the moment the recap settles — which used to tear the entire
  // pipeline down and rebuild it mid-transition. Through a ref, a level change is
  // just a different number on the next frame.
  const levels = useRef({ grain, flicker, vignette });
  levels.current = { grain, flicker, vignette };

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
    /** Vignette level the current pre-render was built for (−1 = none built yet). */
    let vigFor = -1;

    const buildVignette = (w: number, h: number, level: number) => {
      vigFor = level;
      if (level <= 0) { vig = null; return; }
      vig = document.createElement("canvas");
      vig.width = w;
      vig.height = h;
      const vctx = vig.getContext("2d")!;
      const r = Math.hypot(w, h) / 2;
      const g = vctx.createRadialGradient(w / 2, h / 2, r * 0.45, w / 2, h / 2, r);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${Math.min(0.6, level * 0.55)})`);
      vctx.fillStyle = g;
      vctx.fillRect(0, 0, w, h);
    };

    const resize = () => {
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w;
      canvas.height = h;
      buildVignette(w, h, levels.current.vignette);
    };

    // Debounced: a ResizeObserver on a full-bleed canvas fires continuously through
    // a mobile URL-bar collapse, and each fire used to re-run the whole radial
    // pre-render. Re-sizing the backing store also clears it, so the loop repaints
    // on the next frame anyway; a settle window costs nothing visible.
    let resizeTimer = 0;
    const scheduleResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 120);
    };

    const drawFrame = () => {
      const w = canvas.width;
      const h = canvas.height;
      const { grain: g, flicker: f, vignette: v } = levels.current;
      // level changes are picked up here instead of remounting the pipeline
      if (v !== vigFor) buildVignette(w, h, v);
      ctx.clearRect(0, 0, w, h);
      if (g > 0) {
        rollTile();
        ctx.globalAlpha = Math.min(0.14, g * 0.11);
        ctx.globalCompositeOperation = "overlay";
        const pat = ctx.createPattern(tile, "repeat");
        if (pat) { ctx.fillStyle = pat; ctx.fillRect(0, 0, w, h); }
        ctx.globalCompositeOperation = "source-over";
      }
      if (f > 0) {
        // per-frame random dim — reads as projector flutter
        ctx.globalAlpha = Math.random() * f * 0.07;
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
    const ro = new ResizeObserver(scheduleResize);
    ro.observe(canvas);

    if (reduced) {
      drawFrame(); // one static faint frame
      return () => { window.clearTimeout(resizeTimer); ro.disconnect(); };
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
      window.clearTimeout(resizeTimer);
      document.removeEventListener("visibilitychange", onVis);
      ro.disconnect();
    };
    // grain / flicker / vignette are read from `levels` per frame — depending on them
    // here would rebuild the entire canvas pipeline mid-transition (see above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

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
