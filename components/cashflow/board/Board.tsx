"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { TileIcon } from "./TileIcon";

export type BoardSquareView = { index: number; type: string };

// LEDGER: money-in reads gain (green), money-out reads loss (red), opportunities
// read ink, everything else is secondary. No decorative palette.
const TILE_TINT: Record<string, string> = {
  deal: "var(--color-ink)",
  ftdeal: "var(--color-ink)",
  dream: "var(--color-ink)",
  payday: "var(--color-gain)",
  cashflowday: "var(--color-gain)",
  doodad: "var(--color-loss)",
  market: "var(--color-loss)",
  downsized: "var(--color-loss)",
  ftloss: "var(--color-loss)",
  charity: "var(--color-secondary)",
  baby: "var(--color-secondary)",
};
const tintOf = (t: string) => TILE_TINT[t] ?? "var(--color-secondary)";

// four L-shaped crop-ticks at the board frame corners (editorial print marks)
type CropTick = { top?: string; left?: string; right?: string; bottom?: string; v: "top" | "bottom"; h: "left" | "right" };
const CROP_TICKS: CropTick[] = [
  { top: "4.6%", left: "4.6%", v: "top", h: "left" },
  { top: "4.6%", right: "4.6%", v: "top", h: "right" },
  { bottom: "4.6%", left: "4.6%", v: "bottom", h: "left" },
  { bottom: "4.6%", right: "4.6%", v: "bottom", h: "right" },
];

/** Evenly space `n` points around a rectangle perimeter, in % coords. */
function perimeterPoints(n: number, pad: number) {
  const a = 100 - 2 * pad;
  const per = 4 * a;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const d = (i / n) * per;
    let x: number;
    let y: number;
    if (d < a) {
      x = pad + d;
      y = pad;
    } else if (d < 2 * a) {
      x = pad + a;
      y = pad + (d - a);
    } else if (d < 3 * a) {
      x = pad + a - (d - 2 * a);
      y = pad + a;
    } else {
      x = pad;
      y = pad + a - (d - 3 * a);
    }
    pts.push({ x, y });
  }
  return pts;
}

export function Board({
  squares,
  position,
  colorFor,
  labelFor,
  tokenLabel,
  title,
  children,
}: {
  squares: BoardSquareView[];
  position: number;
  colorFor: (type: string) => string;
  labelFor: (type: string) => string;
  tokenLabel: string;
  title: string;
  children?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const size = squares.length;
  const pad = 6;
  const pts = useMemo(() => perimeterPoints(size, pad), [size]);
  const prev = useRef(position);
  const [moving, setMoving] = useState(false);
  void colorFor; // superseded by the LEDGER tint map; kept for call-site compatibility

  // Build the hop path from the previous square to the current one.
  const path = useMemo(() => {
    const from = prev.current;
    const steps = (position - from + size) % size;
    const xs = [pts[from].x];
    const ys = [pts[from].y];
    for (let j = 1; j <= steps; j++) {
      const idx = (from + j) % size;
      xs.push(pts[idx].x);
      ys.push(pts[idx].y);
    }
    return { xs, ys, steps };
  }, [position, pts, size]);

  useEffect(() => {
    if (path.steps > 0) {
      setMoving(true);
      const t = setTimeout(() => setMoving(false), reduce ? 0 : path.steps * 165 + 250);
      prev.current = position;
      return () => clearTimeout(t);
    }
    prev.current = position;
  }, [position, path.steps, reduce]);

  const dur = reduce ? 0 : Math.max(0.35, path.steps * 0.165);

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[560px]">
      {/* flat board field — a terminal ledger spread, hairline double-rule frame */}
      <div className="absolute inset-[2%] border border-hairline bg-bg" />
      <div aria-hidden className="absolute inset-[3.6%] border border-hairline" />

      {/* newspaper corner crop-ticks */}
      {CROP_TICKS.map((c, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute h-3 w-3"
          style={{
            top: c.top,
            left: c.left,
            right: c.right,
            bottom: c.bottom,
            borderTop: c.v === "top" ? "1px solid var(--color-secondary)" : undefined,
            borderBottom: c.v === "bottom" ? "1px solid var(--color-secondary)" : undefined,
            borderLeft: c.h === "left" ? "1px solid var(--color-secondary)" : undefined,
            borderRight: c.h === "right" ? "1px solid var(--color-secondary)" : undefined,
          }}
        />
      ))}

      {/* center hub — a flat ledger panel (dice / roll live here via children) */}
      <div className="absolute inset-[16%] grid place-items-center border border-hairline bg-bg2 p-3 text-center">
        <div className="w-full">
          <p className="eyebrow text-secondary" style={{ fontSize: "0.58rem", letterSpacing: "0.24em" }}>
            {title}
          </p>
          {children}
        </div>
      </div>

      {/* squares — flat chips: type-accent top bar, inverted when you're on it */}
      {squares.map((sq) => {
        const p = pts[sq.index];
        const active = sq.index === position;
        const tint = tintOf(sq.type);
        const chipStyle: CSSProperties = {
          left: `${p.x}%`,
          top: `${p.y}%`,
          borderTop: `2px solid ${tint}`,
        };
        return (
          <motion.div
            key={sq.index}
            className={`absolute flex h-[10.5%] w-[10.5%] -translate-x-1/2 -translate-y-1/2 select-none flex-col items-center justify-center gap-[3%] border ${
              active ? "border-ink bg-ink" : "border-hairline bg-bg2"
            }`}
            style={chipStyle}
            animate={active && !reduce ? { scale: [1, 1.16, 1.09] } : { scale: 1 }}
            transition={{ duration: 0.4 }}
          >
            <TileIcon type={sq.type} className="h-[38%] w-auto" style={{ color: active ? "var(--color-bg)" : tint }} />
            <span
              className="num leading-none"
              style={{ color: active ? "var(--color-bg)" : "var(--color-secondary)", fontSize: "0.4rem", letterSpacing: "0.04em" }}
            >
              {labelFor(sq.type)}
            </span>
          </motion.div>
        );
      })}

      {/* player token — a flat ink stamp */}
      <motion.div
        className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
        initial={false}
        animate={reduce ? { left: `${pts[position].x}%`, top: `${pts[position].y}%` } : { left: path.xs.map((x) => `${x}%`), top: path.ys.map((y) => `${y}%`) }}
        transition={{ duration: dur, ease: "easeInOut" }}
        style={reduce ? undefined : { left: `${pts[prev.current].x}%`, top: `${pts[prev.current].y}%` }}
      >
        <motion.div
          className="grid h-7 w-7 place-items-center border border-ink bg-ink"
          animate={moving && !reduce ? { y: [0, -10, 0], scale: [1, 1.12, 1] } : {}}
          transition={{ duration: 0.33, repeat: moving ? Infinity : 0 }}
        >
          <span className="display-caps" style={{ color: "var(--color-bg)", fontSize: "0.7rem" }}>
            {tokenLabel}
          </span>
        </motion.div>
      </motion.div>
    </div>
  );
}
