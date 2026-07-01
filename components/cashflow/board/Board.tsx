"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TileIcon } from "./TileIcon";

export type BoardSquareView = { index: number; type: string };

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
      {/* inner frame */}
      <div className="absolute inset-[7%] rounded-[14px] border border-ink/12 bg-bg2/40" />

      {/* center hub */}
      <div className="absolute inset-[16%] grid place-items-center rounded-[12px] border border-ink/10 bg-bg2/60 p-3 text-center backdrop-blur-[1px]">
        <div className="w-full">
          <p className="eyebrow text-accent" style={{ fontSize: "0.58rem" }}>
            {title}
          </p>
          {children}
        </div>
      </div>

      {/* squares */}
      {squares.map((sq) => {
        const p = pts[sq.index];
        const active = sq.index === position;
        return (
          <motion.div
            key={sq.index}
            className={`absolute flex h-[10.5%] w-[10.5%] -translate-x-1/2 -translate-y-1/2 select-none flex-col items-center justify-center gap-[4%] rounded-[6px] border text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.09),inset_0_-2px_5px_rgba(0,0,0,0.4)] ${colorFor(sq.type)} ${active ? "ring-1 ring-inset ring-current" : ""}`}
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
            animate={active && !reduce ? { scale: [1, 1.16, 1.08] } : { scale: 1 }}
            transition={{ duration: 0.4 }}
          >
            <TileIcon type={sq.type} className="h-[40%] w-auto opacity-90" />
            <span className="num leading-none opacity-80" style={{ fontSize: "0.42rem", letterSpacing: "0.03em" }}>
              {labelFor(sq.type)}
            </span>
          </motion.div>
        );
      })}

      {/* player token */}
      <motion.div
        className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
        initial={false}
        animate={reduce ? { left: `${pts[position].x}%`, top: `${pts[position].y}%` } : { left: path.xs.map((x) => `${x}%`), top: path.ys.map((y) => `${y}%`) }}
        transition={{ duration: dur, ease: "easeInOut" }}
        style={reduce ? undefined : { left: `${pts[prev.current].x}%`, top: `${pts[prev.current].y}%` }}
      >
        <motion.div
          className="grid h-7 w-7 place-items-center rounded-full border-2 border-paper bg-accent text-bg shadow-[0_0_18px_2px_rgba(212,84,30,0.6)]"
          animate={moving && !reduce ? { y: [0, -10, 0], scale: [1, 1.12, 1] } : {}}
          transition={{ duration: 0.33, repeat: moving ? Infinity : 0 }}
        >
          <span className="display-caps" style={{ fontSize: "0.7rem" }}>
            {tokenLabel}
          </span>
        </motion.div>
      </motion.div>
    </div>
  );
}
