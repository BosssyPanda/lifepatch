"use client";

import { animate, motion, useAnimationControls, useMotionValue, useMotionValueEvent } from "framer-motion";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { TileIcon } from "./TileIcon";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { DUR, EASE } from "@/src/motion/tokens";

/**
 * The token's landing: squash-and-stretch, the same shape the dice already use
 * when they come to rest (`scaleX` opposed to `scaleY`, settling over four
 * decreasing rebounds). A thing that stops moving without deforming reads as a
 * thing that was never moving.
 *
 * It runs on the token's INNER element. The outer node's `transform` is written
 * by hand every frame by `writeToken` below (that is how the hop stays
 * compositor-only), so anything that also wanted the transform would be
 * overwritten mid-flight — the squash composes with it instead of fighting it.
 */
const LAND_SQUASH = {
  scaleX: [1, 1.14, 0.96, 1.05, 0.99, 1],
  scaleY: [1, 0.82, 1.06, 0.95, 1.02, 1],
};
const LAND_TIMES = [0, 0.32, 0.52, 0.72, 0.88, 1];

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
  labelFor,
  tokenLabel,
  title,
  onLand,
  paydayFlash = 0,
  children,
}: {
  squares: BoardSquareView[];
  position: number;
  labelFor: (type: string) => string;
  tokenLabel: string;
  title: string;
  /** Fires when the token settles on its destination square (post-hop), with the square's % coords. */
  onLand?: (type: string, at: { xPct: number; yPct: number }) => void;
  /** Bump this counter to ink-flash the payday squares (a payday was passed). */
  paydayFlash?: number;
  children?: ReactNode;
}) {
  const { reduced: reduce } = useMotionCtx();
  const size = squares.length;
  const pad = 6;
  const pts = useMemo(() => perimeterPoints(size, pad), [size]);
  const prev = useRef(position);
  const [moving, setMoving] = useState(false);
  const onLandRef = useRef(onLand);
  onLandRef.current = onLand;

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
      const t = setTimeout(() => {
        setMoving(false);
        const sq = squares[position];
        if (sq) onLandRef.current?.(sq.type, { xPct: pts[position].x, yPct: pts[position].y });
      }, reduce ? 0 : path.steps * 165 + 250);
      prev.current = position;
      return () => clearTimeout(t);
    }
    prev.current = position;
  }, [position, path.steps, reduce, pts, squares]);

  const dur = reduce ? 0 : Math.max(0.35, path.steps * 0.165);

  // ── token transport (compositor-only) ──────────────────────────────────────
  // This used to animate `left`/`top` percentage KEYFRAME ARRAYS across the whole
  // path — up to ~2s of continuous layout + paint on the busiest screen in the
  // game, while the board also ran a scale pulse and the token an infinite bob.
  // DESIGN.md § Motion bans width/height/top/left outright, so the hop now rides a
  // single px `translate3d`: the board is measured with a ResizeObserver, one
  // framer tween drives a progress value through the tile indices (keyframes
  // [0…steps] with per-segment easeInOut — the exact cadence the left/top keyframe
  // array produced), and each frame resolves the %-path to px against the *current*
  // board width and writes one transform. Consequences:
  //   • the final keyframe IS the destination tile's % coord, so the token lands
  //     pixel-exact at every board size;
  //   • a resize mid-move only re-reads the width and re-writes at the same
  //     progress — the hop keeps running instead of restarting or drifting;
  //   • zero React re-renders during the move (the writer touches the DOM node).
  const boardRef = useRef<HTMLDivElement | null>(null);
  const tokenRef = useRef<HTMLDivElement | null>(null);
  const boardPx = useRef(0);
  const pathRef = useRef(path);
  pathRef.current = path;
  const progress = useMotionValue(0);

  /** Resolve the %-path at fractional tile index `p` and stamp it as a transform. */
  const writeToken = useCallback((p: number) => {
    const el = tokenRef.current;
    if (!el) return;
    const { xs, ys } = pathRef.current;
    const last = xs.length - 1;
    const i = Math.min(last, Math.max(0, Math.floor(p)));
    const j = Math.min(last, i + 1);
    const t = p - i;
    const s = boardPx.current;
    const px = ((xs[i] + (xs[j] - xs[i]) * t) / 100) * s;
    const py = ((ys[i] + (ys[j] - ys[i]) * t) / 100) * s;
    // the -50% pair is the old `-translate-x-1/2 -translate-y-1/2` centering,
    // folded into the same transform so nothing fights over the property.
    el.style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -50%)`;
  }, []);

  useMotionValueEvent(progress, "change", writeToken);

  // Measure before first paint, and re-resolve (never restart) on every resize.
  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const read = () => {
      boardPx.current = el.getBoundingClientRect().width;
      writeToken(progress.get());
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [progress, writeToken]);

  // ── token bob + landing squash ─────────────────────────────────────────────
  const hop = useAnimationControls();
  const wasMoving = useRef(false);

  useEffect(() => {
    if (reduce) {
      hop.set({ y: 0, scaleX: 1, scaleY: 1 });
      wasMoving.current = false;
      return;
    }
    if (moving) {
      wasMoving.current = true;
      void hop.start(
        { y: [0, -10, 0], scaleX: [1, 1.12, 1], scaleY: [1, 1.12, 1] },
        { duration: 0.33, repeat: Infinity, ease: EASE },
      ).catch(() => {});
      return;
    }
    if (!wasMoving.current) return;
    wasMoving.current = false;
    // plant it, then let the squash play out from a settled y
    hop.set({ y: 0 });
    void hop
      .start(LAND_SQUASH, { duration: DUR.slow, times: LAND_TIMES, ease: "easeOut" })
      .catch(() => {});
  }, [moving, reduce, hop]);

  // The hop itself. Reduced motion keeps its old duty: jump straight to the end.
  useEffect(() => {
    const steps = path.steps;
    if (reduce || steps <= 0) {
      progress.jump(steps > 0 ? steps : 0);
      writeToken(steps > 0 ? steps : 0);
      return;
    }
    progress.jump(0);
    writeToken(0);
    const frames = Array.from({ length: steps + 1 }, (_, k) => k);
    const controls = animate(progress, frames, { duration: dur, ease: "easeInOut" });
    return () => controls.stop();
    // `path` is rebuilt whenever `position` changes; keying off both is redundant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, path.steps, reduce, dur]);

  return (
    <div ref={boardRef} className="relative mx-auto aspect-square w-full max-w-[560px]">
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

      {/* squares — flat chips: type-ink top bar, inverted when you're on it */}
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
            transition={{ duration: DUR.base }}
          >
            <TileIcon type={sq.type} className="h-[38%] w-auto" style={{ color: active ? "var(--color-bg)" : tint }} />
            <span
              className="num leading-none"
              style={{ color: active ? "var(--color-bg)" : "var(--color-secondary)", fontSize: "0.4rem", letterSpacing: "0.04em" }}
            >
              {labelFor(sq.type)}
            </span>
            {/* payday-passed blink: one ink flash per bump, payday squares only */}
            {paydayFlash > 0 && !reduce && (sq.type === "payday" || sq.type === "cashflowday") && (
              <motion.span
                key={paydayFlash}
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-ink"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.9, 0] }}
                transition={{ duration: 0.28, times: [0, 0.3, 1] }}
              />
            )}
          </motion.div>
        );
      })}

      {/* player token — a flat ink stamp. Position lives entirely in `transform`
          (written by `writeToken`); `left/top` stay pinned at the board origin. */}
      <div
        ref={tokenRef}
        className="absolute left-0 top-0 z-20"
        style={{ willChange: moving ? "transform" : undefined }}
      >
        <motion.div
          className="grid h-7 w-7 place-items-center border border-ink bg-ink"
          animate={hop}
          style={{ transformOrigin: "center bottom" }}
        >
          <span className="display-caps" style={{ color: "var(--color-bg)", fontSize: "0.7rem" }}>
            {tokenLabel}
          </span>
        </motion.div>
      </div>
    </div>
  );
}
