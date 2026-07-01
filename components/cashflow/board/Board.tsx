"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { TileIcon } from "./TileIcon";

export type BoardSquareView = { index: number; type: string };

// warm editorial palette — the game's newspaper-almanac world (paper, ink, ochre).
// A warm-dark board lit from center, cream paper chips, ochre/ink accents.
const PAPER = "#e7dfc9";
const INK = "#211c16";
const OCHRE = "#c8861e";

// per-type accent (top edge + glyph tint) — the game's muted semantic set
const TILE_TINT: Record<string, string> = {
  deal: "#c8861e",
  ftdeal: "#b8801f",
  doodad: "#a33218",
  charity: "#5f7480",
  payday: "#7f8b52",
  cashflowday: "#7f8b52",
  market: "#a33218",
  baby: "#b07d2a",
  downsized: "#8a2a12",
  dream: "#bf6a22",
  ftloss: "#8a2a12",
};
const tintOf = (t: string) => TILE_TINT[t] ?? "#8a7f66";

// four L-shaped crop-ticks at the board frame corners (editorial print marks)
type CropTick = { top?: string; left?: string; right?: string; bottom?: string; v: "top" | "bottom"; h: "left" | "right" };
const CROP_TICKS: CropTick[] = [
  { top: "4.6%", left: "4.6%", v: "top", h: "left" },
  { top: "4.6%", right: "4.6%", v: "top", h: "right" },
  { bottom: "4.6%", left: "4.6%", v: "bottom", h: "left" },
  { bottom: "4.6%", right: "4.6%", v: "bottom", h: "right" },
];

/** Evenly space `n` points around a rounded-rectangle perimeter, in % coords. */
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
  void colorFor; // superseded by the tabletop tint map; kept for call-site compatibility

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
      {/* warm-dark board — a lit nighttime newspaper spread */}
      <div
        className="absolute inset-[2%] rounded-[18px]"
        style={{
          background:
            "radial-gradient(120% 120% at 50% 28%, #241d15 0%, #14110e 55%, #0d0a07 100%)",
          boxShadow:
            "0 24px 60px -20px rgba(0,0,0,0.9), inset 0 0 90px 22px rgba(0,0,0,0.5), inset 0 1px 0 rgba(233,225,207,0.05)",
          border: `1px solid ${OCHRE}3d`,
        }}
      />
      {/* engraved double-rule frame + ledger inset */}
      <div
        aria-hidden
        className="absolute inset-[3.6%] rounded-[13px]"
        style={{ border: `1px solid ${OCHRE}26`, boxShadow: "inset 0 2px 12px rgba(0,0,0,0.55)" }}
      />
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
            borderTop: c.v === "top" ? `1px solid ${OCHRE}66` : undefined,
            borderBottom: c.v === "bottom" ? `1px solid ${OCHRE}66` : undefined,
            borderLeft: c.h === "left" ? `1px solid ${OCHRE}66` : undefined,
            borderRight: c.h === "right" ? `1px solid ${OCHRE}66` : undefined,
          }}
        />
      ))}

      {/* warm "table light" pooled behind the hub — atmosphere */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-[10%] rounded-full"
        style={{ background: "radial-gradient(circle at 50% 42%, rgba(200,134,30,0.16) 0%, rgba(200,134,30,0.05) 40%, transparent 70%)" }}
      />

      {/* center hub — an ink ledger medallion (dice / roll live here via children) */}
      <div
        className="absolute inset-[16%] grid place-items-center rounded-[14px] p-3 text-center"
        style={{
          background: "radial-gradient(120% 120% at 50% 25%, #211c15 0%, #14100a 100%)",
          border: `1px solid ${OCHRE}40`,
          boxShadow:
            "inset 0 2px 14px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(233,225,207,0.03), 0 0 34px -12px rgba(200,134,30,0.25)",
        }}
      >
        <div className="w-full">
          <p className="eyebrow" style={{ color: OCHRE, fontSize: "0.58rem", letterSpacing: "0.24em" }}>
            {title}
          </p>
          {children}
        </div>
      </div>

      {/* squares — beveled ivory chips with a type accent + engraved glyph */}
      {squares.map((sq) => {
        const p = pts[sq.index];
        const active = sq.index === position;
        const tint = tintOf(sq.type);
        const chipStyle: CSSProperties = {
          left: `${p.x}%`,
          top: `${p.y}%`,
          background: `linear-gradient(180deg, #efe8d4 0%, ${PAPER} 55%, #d8cfb6 100%)`,
          borderTop: `2px solid ${tint}`,
          boxShadow: active
            ? `inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -2px 3px rgba(0,0,0,0.2), 0 0 0 1.5px ${OCHRE}, 0 0 14px -1px rgba(200,134,30,0.6), 0 8px 16px -4px rgba(0,0,0,0.7)`
            : "inset 0 1px 0 rgba(255,255,255,0.75), inset 0 -2px 3px rgba(0,0,0,0.18), 0 0 0 1px rgba(33,28,22,0.14), 0 3px 7px -2px rgba(0,0,0,0.55)",
        };
        return (
          <motion.div
            key={sq.index}
            className="absolute flex h-[10.5%] w-[10.5%] -translate-x-1/2 -translate-y-1/2 select-none flex-col items-center justify-center gap-[3%] rounded-[6px]"
            style={chipStyle}
            animate={active && !reduce ? { scale: [1, 1.16, 1.09], y: [0, -2, -1] } : { scale: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <TileIcon type={sq.type} className="h-[38%] w-auto" style={{ color: tint }} />
            <span
              className="num leading-none"
              style={{ color: INK, opacity: 0.72, fontSize: "0.4rem", letterSpacing: "0.04em" }}
            >
              {labelFor(sq.type)}
            </span>
          </motion.div>
        );
      })}

      {/* player token — an ink wax-seal stamp piece */}
      <motion.div
        className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
        initial={false}
        animate={reduce ? { left: `${pts[position].x}%`, top: `${pts[position].y}%` } : { left: path.xs.map((x) => `${x}%`), top: path.ys.map((y) => `${y}%`) }}
        transition={{ duration: dur, ease: "easeInOut" }}
        style={reduce ? undefined : { left: `${pts[prev.current].x}%`, top: `${pts[prev.current].y}%` }}
      >
        <motion.div
          className="grid h-7 w-7 place-items-center rounded-full"
          style={{
            background: "radial-gradient(circle at 35% 30%, #3a322a 0%, #211c16 55%, #17130d 100%)",
            border: `1.5px solid ${OCHRE}`,
            boxShadow: `inset 0 1px 1px rgba(233,225,207,0.18), inset 0 -1px 2px rgba(0,0,0,0.6), 0 0 0 1px ${OCHRE}33, 0 5px 10px -3px rgba(0,0,0,0.85)`,
          }}
          animate={moving && !reduce ? { y: [0, -10, 0], scale: [1, 1.12, 1] } : {}}
          transition={{ duration: 0.33, repeat: moving ? Infinity : 0 }}
        >
          <span className="display-caps" style={{ color: "#e9e1cf", fontSize: "0.7rem" }}>
            {tokenLabel}
          </span>
        </motion.div>
      </motion.div>
    </div>
  );
}
