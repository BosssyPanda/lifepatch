"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { currency } from "@/lib/format";
import { macroEvent, sp500Return } from "@/lib/markets";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { EASE } from "@/src/motion/tokens";

/**
 * Phase M3 — the annotated net-worth line for a finished run (antimetal's
 * annotated-chart language, MarketSection's SVG grammar). LINEAR scale with a
 * dashed zero baseline (net worth can go negative). Every annotation is
 * derived from recorded data only: the biggest rise and fall from the series'
 * own deltas, plus real macro events (lib/markets) for calendar years the run
 * actually lived through — never a guessed event→year pairing.
 *
 * Stage 4c — the labels are now PLACED, not positioned. Three separate collisions
 * were shipping: the rise/fall callouts drew straight through the plotted line,
 * two macro callouts could land on the same row on top of each other, and the
 * final net-worth plate and the BEST callout printed over one another whenever
 * the best year sat near the end of the run (measured at 1440px: "BEST 2008 +$70"
 * and "−$86,157" overlapped by 62px). Everything below is one small solver:
 * candidate boxes are scored against the line, against each other, and against
 * the frame, and the cheapest one wins.
 */

/**
 * Squeezed into a phone column this chart rendered its callouts at roughly four real pixels:
 * present, unreadable, and overlapping each other. Two things fix that, and they are separate
 * problems. LAYOUT is a geometry swap — a phone gets a narrower, taller frame carrying fewer
 * macro callouts, and labels drop the event title (the part that overflows) for year + market
 * return. TYPE SIZE is solved back from the measured width against a real pixel target,
 * because a fixed unit size renders at whatever the container makes it.
 */
type Geom = {
  W: number;
  H: number;
  PAD: { top: number; right: number; bottom: number; left: number };
  maxMacro: number;
};

/**
 * Target sizes in REAL pixels, not viewBox units. SVG text scales with the viewBox, so a
 * fixed unit size renders at whatever the container happens to make it — 8px in the run
 * report, 4px on a phone. Sizes are solved back from the measured width instead, so a
 * callout is the same physical size everywhere the chart appears.
 */
const TARGET_PX = { anno: 11, axis: 10, final: 15 };

/**
 * IBM Plex Mono's advance width, in em. It is exact for every label drawn here because they
 * are all `.num`, whose `letter-spacing: 0` wins over an SVG `letterSpacing` presentation
 * attribute (presentation attributes cascade below every author rule). The labels used to
 * carry `letterSpacing="0.08em"` as well — it never rendered, but it made `halfW` read 13%
 * short of the truth. If a label ever does get real tracking, it has to be added here too,
 * or the clamp under-reserves and the viewBox clips the front of the string.
 */
const MONO_ADVANCE_EM = 0.6;

const WIDE: Geom = {
  W: 960,
  H: 400,
  PAD: { top: 64, right: 26, bottom: 44, left: 26 },
  maxMacro: 3,
};

// A phone column can hold two callouts at a readable size, not three — and the taller aspect
// keeps the line from flattening into a horizon once the labels claim their band.
const COMPACT: Geom = {
  W: 480,
  H: 340,
  PAD: { top: 56, right: 14, bottom: 38, left: 14 },
  maxMacro: 2,
};

/** Below this container width the wide geometry stops being readable. */
const COMPACT_BELOW = 520;

export type LifePoint = { year: number; netWorth: number };

type Plotted = LifePoint & { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };

/**
 * Both series are solved in ONE domain. A ghost that ends higher than the run — the
 * common case for a counterfactual that indexed everything — would otherwise be
 * plotted against the run's own min/max and drawn straight out of the top of the
 * frame. The x-mapping still comes from `points`, so a ghost whose life ended first
 * simply stops short rather than being stretched to fit.
 */
function plot(
  points: LifePoint[],
  g: Geom,
  topPad: number,
  ghost?: LifePoint[],
): { pts: Plotted[]; ghostPts: Plotted[] | null; zeroY: number | null } {
  const { W, H, PAD } = g;
  const values = [...points.map((p) => p.netWorth), ...(ghost ?? []).map((p) => p.netWorth)];
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const span = max - min || 1;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - topPad - PAD.bottom;
  const x0 = points[0].year;
  const x1 = points[points.length - 1].year || x0 + 1;
  const at = (p: LifePoint): Plotted => ({
    ...p,
    x: PAD.left + ((p.year - x0) / Math.max(1, x1 - x0)) * innerW,
    y: topPad + (1 - (p.netWorth - min) / span) * innerH,
  });
  const zeroY = min < 0 ? topPad + (1 - (0 - min) / span) * innerH : null;
  return { pts: points.map(at), ghostPts: ghost?.length ? ghost.map(at) : null, zeroY };
}

// ── the label solver ────────────────────────────────────────────────────────
function overlapArea(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ix * iy;
}

/** Does the segment p→q cut through the box? Liang–Barsky, clipped to the rect. */
function segmentHitsBox(p: { x: number; y: number }, q: { x: number; y: number }, b: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const tests: [number, number][] = [
    [-dx, p.x - b.x],
    [dx, b.x + b.w - p.x],
    [-dy, p.y - b.y],
    [dy, b.y + b.h - p.y],
  ];
  for (const [pp, qq] of tests) {
    if (pp === 0) {
      if (qq < 0) return false;
      continue;
    }
    const r = qq / pp;
    if (pp < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}

function lineHitsBox(pts: Plotted[], b: Box): boolean {
  for (let i = 1; i < pts.length; i++) if (segmentHitsBox(pts[i - 1], pts[i], b)) return true;
  return false;
}

type ChartModel = {
  pts: Plotted[];
  zeroY: number | null;
  d: string;
  ghostD: string | null;
  rise: { p: Plotted; delta: number; label: string; box: Box } | null;
  fall: { p: Plotted; delta: number; label: string; box: Box } | null;
  final: { label: string; box: Box };
  macro: { p: Plotted; label: string; tone: string; labelY: number; x: number }[];
} | null;

export function AnnotatedLifeChart({
  points,
  ghost,
  ghostLabel = "every spare dollar in the index",
  ghostKind = "counterfactual",
  className = "",
}: {
  points: LifePoint[];
  /** A counterfactual line drawn under the run's own. Derived in `lib/replay`. */
  ghost?: LifePoint[];
  ghostLabel?: string;
  /**
   * What the dashed line IS, for the screen-reader description.
   *
   * `counterfactual` (the default) is the index ghost: the same life with the
   * money moved differently, which is what the sighted legend implies too. A seed
   * challenge passes `rival`, because that line is a DIFFERENT PLAYER'S life on
   * the same world — describing it as "the same life was worth with maria_k"
   * is both broken English and a false statement about whose life it is.
   */
  ghostKind?: "counterfactual" | "rival";
  className?: string;
}) {
  const { reduced } = useMotionCtx();

  // Measure the container rather than the viewport: this chart appears in the run report, the
  // Rat Race report and the public /r/[id] statement, each at a different max-width, so a
  // viewport breakpoint would be wrong in at least one of them.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setPx(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const compact = px > 0 && px < COMPACT_BELOW;
  const g = compact ? COMPACT : WIDE;
  const { W, H, PAD } = g;

  // Solve unit sizes back from the measured width so type lands on TARGET_PX. Before the
  // first measurement (SSR, first paint) assume the geometry's own width, which is what the
  // old fixed sizes effectively assumed.
  const unit = (targetPx: number) => Math.round(targetPx * (W / (px || W)) * 10) / 10;
  const fs = unit(TARGET_PX.anno);
  const fsAxis = unit(TARGET_PX.axis);
  const fsFinal = unit(TARGET_PX.final);
  const row = fs + 6;

  const model = useMemo((): ChartModel => {
    if (points.length < 2) return null;

    const halfW = (text: string, size: number) => (text.length * MONO_ADVANCE_EM * size) / 2;
    const clampX = (x: number, text: string, size: number) => {
      const h = Math.min(halfW(text, size), W / 2);
      return Math.min(W - h, Math.max(h, x));
    };
    /** A centred label's box. `baseline` is the SVG text baseline. */
    const boxOf = (cx: number, baseline: number, text: string, size: number): Box => ({
      x: cx - halfW(text, size),
      y: baseline - size,
      w: halfW(text, size) * 2,
      h: size * 1.3,
    });

    // ── pass 1: x positions and the macro row packing (neither depends on top pad) ──
    const first = plot(points, g, PAD.top, ghost);
    const scan = first.pts;

    let bestI = -1;
    let worstI = -1;
    let riseDelta = 0;
    let fallDelta = 0;
    for (let i = 1; i < scan.length; i++) {
      const d = scan[i].netWorth - scan[i - 1].netWorth;
      if (d > riseDelta) { riseDelta = d; bestI = i; }
      if (d < fallDelta) { fallDelta = d; worstI = i; }
    }

    const taken = new Set([scan[bestI]?.year, scan[worstI]?.year]);
    const macroPts = scan
      .filter((p) => !taken.has(p.year) && macroEvent(p.year))
      .sort((a, b) => Math.abs(sp500Return(b.year)) - Math.abs(sp500Return(a.year)))
      .slice(0, g.maxMacro)
      .sort((a, b) => a.x - b.x);

    /**
     * Greedy left-to-right row packing. The old code used `(i % 2) * row`, which
     * alternates rows by INDEX and knows nothing about width — two long callouts
     * whose years sit close together landed on the same row on top of each other,
     * and clamping them both away from the frame edge could push them into the same
     * place from opposite directions. Sorted by x, a label takes the first row whose
     * last occupant ends before it starts.
     */
    const GAP = fs * 0.8;
    const rowEnds: number[] = [];
    const macro = macroPts.map((p) => {
      const e = macroEvent(p.year)!;
      const move = `${sp500Return(p.year) > 0 ? "+" : "−"}${Math.abs(sp500Return(p.year)).toFixed(0)}%`;
      const long = `${p.year} — ${e.title.toUpperCase()} · ${move}`;
      const short = `${p.year} · ${move}`;
      const label = !compact && halfW(long, fs) <= W / 2 ? long : short;
      const x = clampX(p.x, label, fs);
      const left = x - halfW(label, fs);
      const right = x + halfW(label, fs);
      let r = 0;
      while (r < rowEnds.length && left < rowEnds[r] + GAP) r++;
      rowEnds[r] = right;
      const tone = e.tone === "bad" ? "var(--color-loss)" : e.tone === "good" ? "var(--color-gain)" : "var(--color-ink-dim)";
      return { p, label, tone, row: r, x };
    });

    // ── pass 2: re-plot with exactly the top band the callouts need ──
    const rows = Math.max(1, rowEnds.length);
    const topPad = Math.max(PAD.top, fs + 6 + rows * row + 14);
    const { pts, ghostPts, zeroY } = plot(points, g, topPad, ghost);
    const zeroY0 = zeroY;
    const path = (ps: Plotted[]) => ps.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const d = path(pts);
    const ghostD = ghostPts ? path(ghostPts) : null;
    const macroPlaced = macro.map((m) => ({
      p: pts[scan.indexOf(m.p)] ?? m.p,
      label: m.label,
      tone: m.tone,
      x: m.x,
      labelY: fs + 6 + m.row * row,
    }));

    const last = pts[pts.length - 1];

    // Boxes already claimed before any callout is placed: the packed macro band and
    // the frame's own furniture — the two axis years and the $0 tick. Leaving the
    // axis out is how "RISE 2008 +$70" ended up printed through "2010".
    const axisY = H - PAD.bottom + fsAxis + 10;
    const placed: Box[] = [
      ...macroPlaced.map((m) => boxOf(m.x, m.labelY, m.label, fs)),
      { x: pts[0].x, y: axisY - fsAxis, w: halfW(String(pts[0].year), fsAxis) * 2, h: fsAxis * 1.3 },
      {
        x: W - PAD.right - halfW(String(last.year), fsAxis) * 2,
        y: axisY - fsAxis,
        w: halfW(String(last.year), fsAxis) * 2,
        h: fsAxis * 1.3,
      },
    ];
    if (zeroY0 !== null) {
      placed.push({ x: W - PAD.right - halfW("$0", fsAxis) * 2, y: zeroY0 - 6 - fsAxis, w: halfW("$0", fsAxis) * 2, h: fsAxis * 1.3 });
    }

    /**
     * Place one callout: try above the point, then below, at increasing offsets, and
     * take the cheapest box. Cost = drawing over the plotted line (which is what made
     * "WORST 2000 −$15,301" unreadable) + area shared with anything already placed +
     * a small pull toward the point so a clean box near the marker beats a clean box
     * far from it.
     */
    const place = (p: Plotted, label: string, size: number): Box => {
      const cx = clampX(p.x, label, size);
      const offsets = [12, 20, 28, 38, 50, 64];
      let best: { box: Box; cost: number } | null = null;
      for (const dir of [-1, 1] as const) {
        for (const off of offsets) {
          const baseline = dir < 0 ? p.y - off : p.y + off + size;
          const box = boxOf(cx, baseline, label, size);
          // Inside the plotting frame only: above it is the macro band, below it is
          // the year axis, and a callout in either reads as belonging to that band.
          if (box.y < size + 2 || box.y + box.h > H - PAD.bottom - 2) continue;
          // Both lines, at the same price. A callout printed through the ghost is
          // the same bug this solver exists to prevent, and it is harder to spot
          // because the ghost is the fainter of the two.
          let cost = lineHitsBox(pts, box) ? 10_000 : 0;
          if (ghostPts && lineHitsBox(ghostPts, box)) cost += 10_000;
          for (const q of placed) cost += overlapArea(box, q) * 4;
          cost += off * 2;
          if (!best || cost < best.cost) best = { box, cost };
        }
      }
      const fallback = boxOf(cx, Math.min(H - PAD.bottom - 4, Math.max(size + 4, p.y - 12)), label, size);
      const box = best ? best.box : fallback;
      placed.push(box);
      return box;
    };

    // The final plate goes first — it is the figure the whole chart exists to deliver,
    // so it gets first refusal on the space around the last point.
    const finalLabel = `${last.netWorth < 0 ? "−" : ""}${currency(Math.abs(last.netWorth))}`;
    const finalBox = place(last, finalLabel, fsFinal);

    const bestP = bestI > 0 ? pts[bestI] : null;
    const worstP = worstI > 0 ? pts[worstI] : null;
    const riseLabel = bestP ? `RISE ${bestP.year} +${currency(riseDelta)}` : "";
    const fallLabel = worstP ? `FALL ${worstP.year} −${currency(Math.abs(fallDelta))}` : "";
    const rise = bestP && riseDelta > 0 && bestP.year !== last.year
      ? { p: bestP, delta: riseDelta, label: riseLabel, box: place(bestP, riseLabel, fs) }
      : null;
    const fall = worstP && fallDelta < 0 && worstP.year !== last.year
      ? { p: worstP, delta: fallDelta, label: fallLabel, box: place(worstP, fallLabel, fs) }
      : null;

    return { pts, zeroY, d, ghostD, rise, fall, final: { label: finalLabel, box: finalBox }, macro: macroPlaced };
  }, [points, ghost, g, compact, fs, fsAxis, fsFinal, row, W, H, PAD.top, PAD.right, PAD.bottom]);

  if (!model) return null;
  const { pts, zeroY, d, ghostD, rise, fall, final, macro } = model;
  const ghostFinal = ghost?.length ? ghost[ghost.length - 1].netWorth : null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const up = last.netWorth >= 0;

  /** Where a solved box's text baseline sits. */
  const baseline = (b: Box, size: number) => b.y + size;
  const centre = (b: Box) => b.x + b.w / 2;

  // `amount` was 0.4, which on a phone column asks for 40% of a tall dotted-leader
  // group before anything fades in; a chart glimpsed at the edge of the viewport
  // could sit there fully drawn with every annotation still at opacity 0.
  const anno = { initial: reduced ? false : { opacity: 0 }, whileInView: { opacity: 1 }, viewport: { once: true, amount: 0.1 } } as const;

  return (
    <div ref={wrapRef} className={`border border-hairline bg-bg2 p-3 sm:p-4 ${className}`}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Net worth by year, ${first.year} to ${last.year}, ending at ${final.label}.${
          rise ? ` Biggest one-year rise ${rise.p.year}, ${currency(rise.delta)}.` : ""
        }${fall ? ` Biggest one-year fall ${fall.p.year}, ${currency(Math.abs(fall.delta))}.` : ""}${
          ghostFinal !== null
            ? ghostKind === "rival"
              ? ` A dashed second line shows ${ghostLabel}'s run on the same world, ending at ${currency(ghostFinal)}.`
              : ` A dashed second line shows what the same life was worth with ${ghostLabel}, ending at ${currency(ghostFinal)}.`
            : ""
        } Marked years are real market events the run lived through.`}
      >
        {/* frame + zero baseline */}
        <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} stroke="var(--color-hairline)" />
        {zeroY !== null && (
          <>
            <line x1={PAD.left} y1={zeroY} x2={W - PAD.right} y2={zeroY} stroke="var(--color-ink-dim)" strokeDasharray="2 5" opacity="0.6" />
            <text x={W - PAD.right} y={zeroY - 6} textAnchor="end" className="num" fontSize={fsAxis} fill="var(--color-tertiary)">$0</text>
          </>
        )}

        {/* The counterfactual, UNDER the life line — the run is the subject and has to
            read as it. Dashed `--color-ink-dim`: no new hex, 6.05:1 on this chart's
            bg2 ground, and structurally non-semantic. The other tokens are all spoken
            for and would say the wrong thing — accent means "here, you, do this",
            chartreuse is a reward, and gain/loss mean money, which would GRADE the
            counterfactual. The dash carries it without colour, and it is distinct
            from both the macro leaders (1 4) and the zero baseline (2 5). It is not
            drawn in: one line arriving is a ceremony, two racing is a scoreboard. */}
        {ghostD && (
          <path
            d={ghostD}
            fill="none"
            stroke="var(--color-ink-dim)"
            strokeWidth="2"
            strokeDasharray="6 5"
            strokeLinejoin="round"
          />
        )}

        {/* the life line */}
        <motion.path
          d={d}
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth="2"
          strokeLinejoin="round"
          initial={reduced ? false : { pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true, amount: 0.1 }}
          transition={{ duration: reduced ? 0 : 1.5, ease: EASE }}
          style={reduced ? { pathLength: 1 } : undefined}
        />

        {/* macro events actually crossed — dotted leaders to the packed top band */}
        {macro.map((m, i) => (
          <motion.g key={m.p.year} {...anno} transition={{ delay: reduced ? 0 : 0.7 + i * 0.15 }}>
            <line x1={m.p.x} y1={m.labelY + 6} x2={m.p.x} y2={m.p.y - 5} stroke={m.tone} strokeDasharray="1 4" opacity="0.8" />
            <circle cx={m.p.x} cy={m.p.y} r="3.5" fill={m.tone} />
            <text x={m.x} y={m.labelY} textAnchor="middle" className="num" fontSize={fs} fill={m.tone}>
              {m.label}
            </text>
          </motion.g>
        ))}

        {/* the run's own biggest one-year moves, in NET WORTH — a different figure
            from the two cards below the chart, which report the market's effect on
            the portfolio alone. Both are labelled so they can't read as a
            contradiction. */}
        {rise && (
          <motion.g {...anno} transition={{ delay: reduced ? 0 : 1.0 }}>
            <circle cx={rise.p.x} cy={rise.p.y} r="4" fill="var(--color-gain)" />
            <text x={centre(rise.box)} y={baseline(rise.box, fs)} textAnchor="middle" className="num" fontSize={fs} fill="var(--color-gain)">
              {rise.label}
            </text>
          </motion.g>
        )}
        {fall && (
          <motion.g {...anno} transition={{ delay: reduced ? 0 : 1.1 }}>
            <circle cx={fall.p.x} cy={fall.p.y} r="4" fill="var(--color-loss)" />
            <text x={centre(fall.box)} y={baseline(fall.box, fs)} textAnchor="middle" className="num" fontSize={fs} fill="var(--color-loss)">
              {fall.label}
            </text>
          </motion.g>
        )}

        {/* start / final plates */}
        <motion.g {...anno} transition={{ delay: reduced ? 0 : 1.2 }}>
          <text x={first.x} y={H - PAD.bottom + fsAxis + 10} textAnchor="start" className="num" fontSize={fsAxis} fill="var(--color-tertiary)">
            {first.year}
          </text>
          <text x={W - PAD.right} y={H - PAD.bottom + fsAxis + 10} textAnchor="end" className="num" fontSize={fsAxis} fill="var(--color-tertiary)">
            {last.year}
          </text>
          <circle cx={last.x} cy={last.y} r="4.5" fill={up ? "var(--color-gain)" : "var(--color-loss)"} />
          <text
            x={centre(final.box)}
            y={baseline(final.box, fsFinal)}
            textAnchor="middle"
            className="num"
            fontSize={fsFinal}
            fontWeight="700"
            fill={up ? "var(--color-gain)" : "var(--color-loss)"}
          >
            {final.label}
          </text>
        </motion.g>
      </svg>
      {ghostD && (
        <p className="num mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.7rem] text-secondary">
          <span className="inline-flex items-center gap-1.5">
            {/* The swatches are the same primitive as the lines they stand for, so they
                cannot drift from them — and a dashed rule drawn as SVG rather than as a
                repeating gradient keeps the ban on decorative gradients intact. */}
            <svg aria-hidden width="22" height="4" viewBox="0 0 22 4" className="shrink-0">
              <line x1="0" y1="2" x2="22" y2="2" stroke="var(--color-ink)" strokeWidth="2" />
            </svg>
            you
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg aria-hidden width="22" height="4" viewBox="0 0 22 4" className="shrink-0">
              <line x1="0" y1="2" x2="22" y2="2" stroke="var(--color-ink-dim)" strokeWidth="2" strokeDasharray="6 5" />
            </svg>
            {ghostLabel}
          </span>
        </p>
      )}
      <p className="mt-2 font-body text-[0.78rem] leading-snug text-secondary">
        Net worth: everything you own minus everything you owe. RISE and FALL mark the biggest
        single-year moves in that line.
      </p>
    </div>
  );
}
