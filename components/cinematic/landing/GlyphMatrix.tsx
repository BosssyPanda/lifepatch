"use client";

import { useEffect, useRef } from "react";
import { useMotionCtx } from "@/src/motion/MotionProvider";

/**
 * Phase N — low-opacity ledger-glyph backdrop (canvas). A sparse grid of mono
 * numerals/currency marks where a few cells flicker per tick. Costs almost
 * nothing: repaints only mutated cells, pauses off-screen and on hidden tabs,
 * and renders a single static frame under reduced motion. Color and font come
 * from the element's computed styles, so palette/typeface stay token-driven.
 */

const GLYPHS = "0123456789$%¢=+−";
const CELL = 22; // grid pitch (px)
const TICK_MS = 120; // flicker cadence
const MUTATIONS_PER_TICK = 3;
const FILL_ODDS = 0.45; // fraction of cells holding a glyph at any moment

export function GlyphMatrix({ className = "", opacity = 0.14 }: { className?: string; opacity?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { reduced } = useMotionCtx();

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let cols = 0;
    let rows = 0;
    let grid: string[][] = [];
    let raf = 0;
    let last = 0;
    let onScreen = true;

    const style = () => {
      const cs = getComputedStyle(canvas);
      ctx.fillStyle = cs.color;
      ctx.font = `${11 * dpr}px ${cs.fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
    };

    const pick = () => (Math.random() < FILL_ODDS ? GLYPHS[(Math.random() * GLYPHS.length) | 0] : "");

    const paintCell = (r: number, c: number) => {
      const x = c * CELL * dpr;
      const y = r * CELL * dpr;
      ctx.clearRect(x, y, CELL * dpr, CELL * dpr);
      const ch = grid[r][c];
      if (ch) ctx.fillText(ch, x + (CELL * dpr) / 2, y + (CELL * dpr) / 2);
    };

    const paintAll = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) paintCell(r, c);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      cols = Math.ceil(rect.width / CELL);
      rows = Math.ceil(rect.height / CELL);
      grid = Array.from({ length: rows }, () => Array.from({ length: cols }, pick));
      style();
      paintAll();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    if (reduced) return () => ro.disconnect(); // static frame only

    const step = (t: number) => {
      raf = requestAnimationFrame(step);
      if (!onScreen || document.hidden || t - last < TICK_MS) return;
      last = t;
      for (let i = 0; i < MUTATIONS_PER_TICK; i++) {
        if (!rows || !cols) return;
        const r = (Math.random() * rows) | 0;
        const c = (Math.random() * cols) | 0;
        grid[r][c] = pick();
        paintCell(r, c);
      }
    };
    raf = requestAnimationFrame(step);

    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
    });
    io.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [reduced]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none font-mono text-ink-dim ${className}`}
      style={{ opacity }}
    />
  );
}
