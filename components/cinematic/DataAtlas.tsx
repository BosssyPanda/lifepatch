"use client";

import { motion, useMotionValue, useReducedMotion, useTransform, type MotionValue } from "framer-motion";
import { useEffect, useState } from "react";

/**
 * "Data Atlas" — the landing hero. A real engraved Atlas (CC0 Met bronze,
 * isolated + duotone-tinted to the palette — see public/img/atlas-engraving.*)
 * holds up a live wireframe globe of market data: candlesticks, a 3D helix
 * trend, orbital labels, a %-axis, a live stat panel, a golden-ratio spiral and
 * a blueprint frame. Themed (CSS color vars) + animated; reduced-motion → static.
 *
 * `px`/`py` are normalized pointer springs (−0.5..0.5) from the Gate; layers
 * translate by different factors for a "living" parallax depth.
 */

const G = { cx: 300, cy: 280, r: 188 }; // data globe (sits over the statue's globe)

const MIDS = [322, 312, 318, 300, 308, 289, 277, 285, 264, 272, 250, 238, 246, 224, 208, 188];
const HALF = [11, 13, 9, 15, 10, 13, 11, 9, 14, 10, 13, 15, 10, 13, 11, 14];
const WICK = [15, 13, 18, 14, 17, 12, 15, 13, 18, 14, 17, 13, 16, 14, 18, 21];
const UP = [true, false, true, true, false, true, true, false, true, true, false, true, true, true, false, true];
const ACCENT = new Set([5, 10, 15]);
const CANDLES = MIDS.map((mid, i) => ({
  x: 168 + i * 18.2, top: mid - HALF[i], bot: mid + HALF[i], high: mid - WICK[i], low: mid + WICK[i], up: UP[i], accent: ACCENT.has(i),
}));

function buildHelix() {
  const turns = 1.85, N = 220, amp = 0.95;
  const pts = Array.from({ length: N + 1 }, (_, i) => {
    const t = i / N;
    const y = G.cy + G.r * 0.74 * (1 - 2 * t);
    const dy = y - G.cy;
    const rLat = Math.sqrt(Math.max(0, G.r * G.r - dy * dy)) * amp;
    const phase = t * Math.PI * 2 * turns + 0.5;
    return { x: G.cx + rLat * Math.sin(phase), y, front: Math.cos(phase) > 0 };
  });
  const front: string[] = [], back: string[] = [];
  let cur: typeof pts = [], curFront = pts[0].front;
  const flush = () => { if (cur.length >= 2) (curFront ? front : back).push("M" + cur.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L ")); cur = []; };
  for (const p of pts) { if (p.front !== curFront) { const last = cur[cur.length - 1]; flush(); if (last) cur.push(last); curFront = p.front; } cur.push(p); }
  flush();
  return { front, back, start: pts[0], end: pts[pts.length - 1] };
}
const HELIX = buildHelix();

const LABELS: { t: string; x: number; y: number }[] = [
  { t: "MARKETS", x: 150, y: 118 }, { t: "RISK", x: 370, y: 118 },
  { t: "DEBT", x: 120, y: 206 }, { t: "INFLATION", x: 360, y: 300 },
  { t: "SAVINGS", x: 168, y: 436 }, { t: "INVEST", x: 320, y: 450 },
];
const NODES = [[226, 138], [442, 138], [134, 214], [428, 286], [232, 418], [350, 432]];
const AXIS = [{ t: "+8%", y: 196 }, { t: "+4%", y: 268 }, { t: "0%", y: 340 }, { t: "−4%", y: 412 }];
const STATS0 = [
  { k: "CAP", up: true, v: 2.35 }, { k: "YLD", up: false, v: 1.12 },
  { k: "VOL", up: true, v: 3.07 }, { k: "GDP", up: true, v: 1.65 }, { k: "CPI", up: true, v: 2.81 },
];

export function DataAtlas({ className = "", px, py }: { className?: string; px?: MotionValue<number>; py?: MotionValue<number> }) {
  const reduce = useReducedMotion();
  const [stats, setStats] = useState(STATS0);

  // pointer springs (fall back to static if not provided)
  const fx = useMotionValue(0), fy = useMotionValue(0);
  const mx = px ?? fx, my = py ?? fy;
  // per-layer parallax depth (figure least → frame most)
  const figX = useTransform(mx, [-0.5, 0.5], [-6, 6]);
  const figY = useTransform(my, [-0.5, 0.5], [-5, 5]);
  const globeX = useTransform(mx, [-0.5, 0.5], [-13, 13]);
  const globeY = useTransform(my, [-0.5, 0.5], [-10, 10]);
  const frameX = useTransform(mx, [-0.5, 0.5], [-20, 20]);
  const frameY = useTransform(my, [-0.5, 0.5], [-16, 16]);
  const glowX = useTransform(mx, [-0.5, 0.5], [-90, 90]);
  const glowY = useTransform(my, [-0.5, 0.5], [-70, 70]);

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setStats((p) => p.map((s) => ({ ...s, v: Math.max(0.1, s.v + (Math.random() - 0.5) * 0.07) }))), 1400);
    return () => clearInterval(id);
  }, [reduce]);

  const draw = (delay: number, dur = 1.6) =>
    reduce
      ? { initial: { pathLength: 1, opacity: 1 }, animate: { pathLength: 1, opacity: 1 } }
      : { initial: { pathLength: 0, opacity: 0 }, animate: { pathLength: 1, opacity: 1 }, transition: { pathLength: { duration: dur, delay, ease: "easeInOut" as const }, opacity: { duration: 0.4, delay } } };

  return (
    <svg viewBox="0 0 600 1200" className={className} role="img" aria-label="Atlas holding a globe of market data" preserveAspectRatio="xMidYMid meet">
      <defs>
        <pattern id="da-grid" width="6.4" height="6.4" patternUnits="userSpaceOnUse">
          <rect x="1.2" y="1.2" width="1.7" height="1.7" fill="var(--color-brass)" />
        </pattern>
        <radialGradient id="da-sphereFade" cx="42%" cy="34%" r="70%">
          <stop offset="0%" stopColor="white" stopOpacity="0.85" />
          <stop offset="60%" stopColor="white" stopOpacity="0.4" />
          <stop offset="100%" stopColor="white" stopOpacity="0.05" />
        </radialGradient>
        <mask id="da-sphereMask"><circle cx={G.cx} cy={G.cy} r={G.r} fill="url(#da-sphereFade)" /></mask>
        <clipPath id="da-globeClip"><circle cx={G.cx} cy={G.cy} r={G.r} /></clipPath>
        <radialGradient id="da-halo" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="da-figGlow" cx="50%" cy="60%" r="60%">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.10" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </radialGradient>
        <filter id="da-blur" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="34" /></filter>
      </defs>

      {/* ---------- layer C: blueprint frame (parallax most) ---------- */}
      <motion.g style={{ x: frameX, y: frameY }}><BlueprintFrame /></motion.g>

      {/* ---------- layer A: figure (parallax least) + breathing ---------- */}
      <motion.g style={{ x: figX, y: figY }}>
        {/* cursor-following warm glow */}
        <motion.ellipse cx={300} cy={660} rx={150} ry={210} fill="var(--color-accent)" opacity="0.12" filter="url(#da-blur)" style={{ x: glowX, y: glowY }} />
        <rect x="120" y="520" width="360" height="560" fill="url(#da-figGlow)" />
        <motion.g animate={reduce ? undefined : { y: [0, -5, 0] }} transition={{ duration: 6.5, repeat: Infinity, ease: "easeInOut" }}>
          <image href="/img/atlas-engraving.png" x={-53} y={48} width={569} height={1153} preserveAspectRatio="xMidYMid meet" />
        </motion.g>
      </motion.g>

      {/* ---------- layer B: globe + data (parallax mid) ---------- */}
      <motion.g style={{ x: globeX, y: globeY }}>
        {/* lift + shrink the whole data-globe as one unit so it clears Atlas's head */}
        <g transform={`translate(${G.cx} ${G.cy}) scale(0.84) translate(${-G.cx} ${-G.cy}) translate(0 -74)`}>
        <circle cx={G.cx} cy={G.cy} r={G.r + 34} fill="url(#da-halo)" />

        <motion.g
          initial={reduce ? undefined : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, ease: "easeOut" }}
          style={{ transformBox: "view-box", transformOrigin: `${G.cx}px ${G.cy}px` }}
        >
          <circle cx={G.cx} cy={G.cy} r={G.r} fill="var(--color-bg)" stroke="var(--color-ink)" strokeWidth="1.5" strokeOpacity="0.8" />
          <g clipPath="url(#da-globeClip)" mask="url(#da-sphereMask)">
            <rect x={G.cx - G.r} y={G.cy - G.r} width={G.r * 2} height={G.r * 2} fill="url(#da-grid)" />
          </g>

          <motion.g
            clipPath="url(#da-globeClip)" stroke="var(--color-ink-dim)" strokeWidth="1" fill="none" opacity="0.6"
            style={{ transformBox: "view-box", transformOrigin: `${G.cx}px ${G.cy}px` }}
            animate={reduce ? undefined : { rotate: 360 }} transition={{ duration: 80, repeat: Infinity, ease: "linear" }}
          >
            {[0.22, 0.45, 0.66, 0.85, 1].map((k, i) => <ellipse key={i} cx={G.cx} cy={G.cy} rx={G.r * k} ry={G.r} />)}
            <line x1={G.cx} y1={G.cy - G.r} x2={G.cx} y2={G.cy + G.r} />
          </motion.g>
          <g clipPath="url(#da-globeClip)" stroke="var(--color-ink-dim)" strokeWidth="1" fill="none" opacity="0.5">
            {[-0.78, -0.55, -0.3, -0.05, 0.2, 0.45, 0.7].map((k, i) => <ellipse key={i} cx={G.cx} cy={G.cy + G.r * k} rx={G.r * Math.sqrt(Math.max(0.02, 1 - k * k))} ry={G.r * 0.3} />)}
          </g>
          <motion.ellipse
            cx={G.cx} cy={G.cy} rx={G.r * 0.55} ry={G.r} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" clipPath="url(#da-globeClip)"
            animate={reduce ? undefined : { opacity: [0.4, 0.8, 0.4] }} transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
          />

          <motion.g clipPath="url(#da-globeClip)" initial="hide" animate="show"
            variants={{ show: { transition: { staggerChildren: reduce ? 0 : 0.05, delayChildren: 0.5 } } }}>
            {CANDLES.map((c, i) => {
              const color = c.accent ? "var(--color-accent)" : c.up ? "var(--color-paper)" : "var(--color-brick)";
              return (
                <motion.g key={i}
                  variants={{ hide: { opacity: 0, scaleY: reduce ? 1 : 0 }, show: { opacity: 1, scaleY: 1 } }}
                  transition={{ duration: 0.4, ease: "backOut" }}
                  style={{ transformBox: "fill-box", transformOrigin: "center bottom" }}>
                  <line x1={c.x} y1={c.high} x2={c.x} y2={c.low} stroke={color} strokeWidth="1.3" />
                  <rect x={c.x - 4.4} y={c.top} width="8.8" height={Math.max(3, c.bot - c.top)}
                    fill={c.up && !c.accent ? "var(--color-bg)" : color} stroke={color} strokeWidth="1.4" />
                </motion.g>
              );
            })}
          </motion.g>

          <g clipPath="url(#da-globeClip)">
            {HELIX.back.map((d, i) => <path key={`hb${i}`} d={d} fill="none" stroke="var(--color-accent)" strokeWidth="1.8" strokeLinecap="round" opacity="0.2" />)}
            <motion.path d="M150 352 q 26 -15 52 0 t 52 0 t 52 0 t 52 0 t 52 0" fill="none" stroke="var(--color-ochre)" strokeWidth="1.7" opacity="0.7" {...draw(1.1, 1.6)} />
            {HELIX.front.map((d, i) => (
              <g key={`hf${i}`}>
                <path d={d} fill="none" stroke="var(--color-accent-2)" strokeWidth="7" strokeLinecap="round" opacity="0.12" />
                <motion.path d={d} fill="none" stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round" {...draw(0.6 + i * 0.12, 1.3)} />
              </g>
            ))}
          </g>
          <circle cx={HELIX.start.x} cy={HELIX.start.y} r="3.6" fill="var(--color-accent)" />
          <circle cx={HELIX.end.x} cy={HELIX.end.y} r="4" fill="var(--color-accent)" />
        </motion.g>

        {NODES.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.6" fill="var(--color-brass)" />)}
        {LABELS.map((l) => <text key={l.t} x={l.x} y={l.y} className="da-label" fill="var(--color-ink-dim)">{l.t}</text>)}

        <line x1="508" y1="182" x2="508" y2="426" stroke="var(--color-ink-dim)" strokeWidth="1" opacity="0.4" />
        {AXIS.map((a) => (
          <g key={a.t}>
            <line x1="502" y1={a.y} x2="514" y2={a.y} stroke="var(--color-ink-dim)" strokeWidth="1" opacity="0.5" />
            <text x="522" y={a.y + 4} className="da-axis" fill="var(--color-ink-dim)">{a.t}</text>
          </g>
        ))}

        <g transform="translate(96 250)">
          <rect x="-12" y="-17" width="116" height="105" rx="3" fill="var(--color-bg)" opacity="0.6" />
          <rect x="-12" y="-17" width="116" height="105" rx="3" fill="none" stroke="var(--color-ink-dim)" strokeWidth="0.75" opacity="0.3" />
          {stats.map((s, i) => {
            const col = s.up ? "var(--color-olive)" : "var(--color-brick)";
            const y = i * 19;
            return (
              <g key={s.k}>
                <text x="0" y={y} className="da-stat" fill="var(--color-ink-dim)">{s.k}</text>
                <path d={s.up ? `M40 ${y - 3} l4 -6 l4 6 z` : `M40 ${y - 7} l4 6 l4 -6 z`} fill={col} />
                <text x="54" y={y} className="da-stat" fill="var(--color-ink)">{s.v.toFixed(2)}</text>
              </g>
            );
          })}
        </g>

        <motion.g fill="none" stroke="var(--color-brass)" strokeWidth="1.3" opacity="0.55" {...draw(1.4, 2)}>
          <rect x="430" y="980" width="112" height="112" />
          <rect x="430" y="980" width="69" height="69" />
          <rect x="465" y="980" width="34" height="34" />
          <path d="M542 980 a112 112 0 0 0 -112 112 M430 1049 a69 69 0 0 0 69 -69 M499 1014 a34 34 0 0 0 -34 -34" stroke="var(--color-accent)" strokeWidth="1.6" />
        </motion.g>
        </g>
      </motion.g>

      <style>{`
        .da-label { font-family: var(--font-display); font-size: 12.5px; letter-spacing: 0.2em; text-transform: uppercase; }
        .da-axis { font-family: var(--font-display); font-size: 12.5px; letter-spacing: 0.05em; }
        .da-stat { font-family: var(--font-display); font-size: 13.5px; letter-spacing: 0.04em; font-variant-numeric: tabular-nums; }
      `}</style>
    </svg>
  );
}

function BlueprintFrame() {
  const x0 = 52, y0 = 64, x1 = 548, y1 = 1150;
  const cross = (cx: number, cy: number) => (
    <g stroke="var(--color-ink-dim)" strokeWidth="1.2" opacity="0.5">
      <line x1={cx - 9} y1={cy} x2={cx + 9} y2={cy} /><line x1={cx} y1={cy - 9} x2={cx} y2={cy + 9} />
    </g>
  );
  return (
    <g>
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="none" stroke="var(--color-ink-dim)" strokeWidth="1" strokeDasharray="2 6" opacity="0.4" />
      <rect x={x0 + 9} y={y0 + 9} width={x1 - x0 - 18} height={y1 - y0 - 18} fill="none" stroke="var(--color-ink-dim)" strokeWidth="1" opacity="0.16" />
      {cross(x0, y0)}{cross(x1, y0)}{cross(x0, y1)}{cross(x1, y1)}{cross(x0, (y0 + y1) / 2)}{cross(x1, (y0 + y1) / 2)}
    </g>
  );
}
