"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

/**
 * "Data Atlas" — the landing hero illustration. A kneeling Atlas (hand-built
 * SVG halftone, assembled from a limb skeleton driven through an alpha mask)
 * straining to hold up a wireframe globe of market data: candlesticks, orbital
 * labels, a %-axis, a live stat panel, a golden-ratio spiral and a blueprint
 * frame. Fully themed (CSS color vars) + animated. Reduced-motion → static.
 */

const G = { cx: 300, cy: 280, r: 188 }; // globe

// --- figure skeleton (limbs as round-capped strokes; joints as ellipses) ---
const LIMBS: [number, number, number, number, number][] = [
  [246, 580, 354, 580, 50], // shoulders
  [264, 584, 234, 520, 30], // L upper arm
  [234, 520, 246, 460, 23], // L forearm
  [336, 584, 366, 520, 30], // R upper arm
  [366, 520, 354, 460, 23], // R forearm
  [274, 708, 234, 770, 48], // L thigh
  [238, 768, 250, 838, 33], // L shin
  [326, 708, 366, 770, 48], // R thigh
  [362, 768, 350, 838, 33], // R shin
];
const JOINTS: [number, number, number, number][] = [
  [300, 548, 26, 30], // head
  [300, 642, 76, 92], // torso
  [300, 716, 64, 44], // pelvis
  [246, 458, 18, 17], // L hand
  [354, 458, 18, 17], // R hand
  [234, 770, 21, 21], // L knee
  [366, 770, 21, 21], // R knee
  [250, 838, 24, 13], // L foot
  [350, 838, 24, 13], // R foot
];

// deterministic ascending candlestick series (SSR-safe)
const MIDS = [322, 312, 318, 300, 308, 289, 277, 285, 264, 272, 250, 238, 246, 224, 208, 188];
const HALF = [11, 13, 9, 15, 10, 13, 11, 9, 14, 10, 13, 15, 10, 13, 11, 14];
const WICK = [15, 13, 18, 14, 17, 12, 15, 13, 18, 14, 17, 13, 16, 14, 18, 21];
const UP = [true, false, true, true, false, true, true, false, true, true, false, true, true, true, false, true];
const ACCENT = new Set([5, 10, 15]);
const CANDLES = MIDS.map((mid, i) => {
  const x = 168 + i * 18.2;
  return { x, top: mid - HALF[i], bot: mid + HALF[i], high: mid - WICK[i], low: mid + WICK[i], up: UP[i], accent: ACCENT.has(i) };
});

// orange trend as a 3D helix hugging the sphere surface (front bright, back dim)
function buildHelix() {
  const turns = 1.85, N = 220, amp = 0.95;
  const pts = Array.from({ length: N + 1 }, (_, i) => {
    const t = i / N;
    const y = G.cy + G.r * 0.74 * (1 - 2 * t); // bottom -> top
    const dy = y - G.cy;
    const rLat = Math.sqrt(Math.max(0, G.r * G.r - dy * dy)) * amp;
    const phase = t * Math.PI * 2 * turns + 0.5;
    return { x: G.cx + rLat * Math.sin(phase), y, front: Math.cos(phase) > 0 };
  });
  const front: string[] = [], back: string[] = [];
  let cur: typeof pts = [], curFront = pts[0].front;
  const flush = () => {
    if (cur.length >= 2) (curFront ? front : back).push("M" + cur.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L "));
    cur = [];
  };
  for (const p of pts) {
    if (p.front !== curFront) { const last = cur[cur.length - 1]; flush(); if (last) cur.push(last); curFront = p.front; }
    cur.push(p);
  }
  flush();
  const start = pts[0], end = pts[pts.length - 1];
  return { front, back, start, end };
}
const HELIX = buildHelix();

const LABELS: { t: string; x: number; y: number; a: "start" | "end" }[] = [
  { t: "MARKETS", x: 150, y: 118, a: "start" },
  { t: "RISK", x: 370, y: 118, a: "start" },
  { t: "DEBT", x: 120, y: 206, a: "start" },
  { t: "INFLATION", x: 360, y: 300, a: "start" },
  { t: "SAVINGS", x: 168, y: 436, a: "start" },
  { t: "INVEST", x: 320, y: 450, a: "start" },
];
const NODES = [[226, 138], [442, 138], [134, 214], [428, 286], [232, 418], [350, 432]];
const AXIS = [{ t: "+8%", y: 196 }, { t: "+4%", y: 268 }, { t: "0%", y: 340 }, { t: "−4%", y: 412 }];
const STATS0 = [
  { k: "CAP", up: true, v: 2.35 }, { k: "YLD", up: false, v: 1.12 },
  { k: "VOL", up: true, v: 3.07 }, { k: "GDP", up: true, v: 1.65 }, { k: "CPI", up: true, v: 2.81 },
];

export function DataAtlas({ className = "" }: { className?: string }) {
  const reduce = useReducedMotion();
  const [stats, setStats] = useState(STATS0);

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => {
      setStats((p) => p.map((s) => ({ ...s, v: Math.max(0.1, s.v + (Math.random() - 0.5) * 0.07) })));
    }, 1400);
    return () => clearInterval(id);
  }, [reduce]);

  const draw = (delay: number, dur = 1.6) =>
    reduce
      ? { initial: { pathLength: 1, opacity: 1 }, animate: { pathLength: 1, opacity: 1 } }
      : { initial: { pathLength: 0, opacity: 0 }, animate: { pathLength: 1, opacity: 1 }, transition: { pathLength: { duration: dur, delay, ease: "easeInOut" as const }, opacity: { duration: 0.4, delay } } };

  return (
    <svg viewBox="0 0 600 860" className={className} role="img" aria-label="Atlas holding a globe of market data" preserveAspectRatio="xMidYMid meet">
      <defs>
        <pattern id="da-dots" width="6.5" height="6.5" patternUnits="userSpaceOnUse">
          <circle cx="1.9" cy="1.9" r="1.25" fill="var(--color-paper)" />
        </pattern>
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
        {/* figure alpha mask built from the limb skeleton */}
        <mask id="da-figMask" maskUnits="userSpaceOnUse" x="0" y="0" width="600" height="860">
          <rect width="600" height="860" fill="black" />
          <g stroke="white" strokeLinecap="round" fill="white">
            {LIMBS.map(([x1, y1, x2, y2, w], i) => (
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={w} />
            ))}
            {JOINTS.map(([cx, cy, rx, ry], i) => (
              <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} />
            ))}
          </g>
        </mask>
        {/* darker toward the base for form */}
        <linearGradient id="da-figFade" x1="0" y1="0.2" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-bg)" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--color-bg)" stopOpacity="0.85" />
        </linearGradient>
        <radialGradient id="da-halo" cx="50%" cy="42%" r="62%">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.12" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx={G.cx} cy={G.cy} r={G.r + 30} fill="url(#da-halo)" />
      <BlueprintFrame />

      {/* ================= ATLAS FIGURE ================= */}
      <g mask="url(#da-figMask)">
        <rect x="180" y="440" width="240" height="420" fill="var(--color-bg2)" />
        <rect x="180" y="440" width="240" height="420" fill="url(#da-dots)" opacity="0.9" />
        <rect x="180" y="440" width="240" height="420" fill="url(#da-figFade)" />
        {/* shading hatch carved into the figure */}
        <g stroke="var(--color-bg)" strokeWidth="2" opacity="0.4">
          {Array.from({ length: 16 }).map((_, i) => (
            <line key={i} x1="150" y1={520 + i * 22} x2="470" y2={512 + i * 22} />
          ))}
        </g>
      </g>
      {/* accent rim-light on the lit (upper-left) edges */}
      <g fill="none" stroke="var(--color-accent)" strokeWidth="2.6" strokeLinecap="round" opacity="0.92">
        <path d="M246 460 L234 520 L262 584" />
        <path d="M274 708 L238 768" />
      </g>
      <path d="M246 460 L234 520 L262 584" fill="none" stroke="var(--color-accent-2)" strokeWidth="8" strokeLinecap="round" opacity="0.12" />

      {/* ================= GLOBE ================= */}
      <motion.g
        initial={reduce ? undefined : { opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.9, ease: "easeOut" }}
        style={{ transformBox: "view-box", transformOrigin: `${G.cx}px ${G.cy}px` }}
      >
        <circle cx={G.cx} cy={G.cy} r={G.r} fill="var(--color-bg)" fillOpacity="0.55" stroke="var(--color-ink)" strokeWidth="1.5" strokeOpacity="0.7" />
        {/* halftone data grid */}
        <g clipPath="url(#da-globeClip)" mask="url(#da-sphereMask)">
          <rect x={G.cx - G.r} y={G.cy - G.r} width={G.r * 2} height={G.r * 2} fill="url(#da-grid)" />
        </g>

        {/* rotating meridians */}
        <motion.g
          clipPath="url(#da-globeClip)" stroke="var(--color-ink-dim)" strokeWidth="1" fill="none" opacity="0.6"
          style={{ transformBox: "view-box", transformOrigin: `${G.cx}px ${G.cy}px` }}
          animate={reduce ? undefined : { rotate: 360 }} transition={{ duration: 80, repeat: Infinity, ease: "linear" }}
        >
          {[0.22, 0.45, 0.66, 0.85, 1].map((k, i) => <ellipse key={i} cx={G.cx} cy={G.cy} rx={G.r * k} ry={G.r} />)}
          <line x1={G.cx} y1={G.cy - G.r} x2={G.cx} y2={G.cy + G.r} />
        </motion.g>
        {/* latitudes */}
        <g clipPath="url(#da-globeClip)" stroke="var(--color-ink-dim)" strokeWidth="1" fill="none" opacity="0.5">
          {[-0.78, -0.55, -0.3, -0.05, 0.2, 0.45, 0.7].map((k, i) => <ellipse key={i} cx={G.cx} cy={G.cy + G.r * k} rx={G.r * Math.sqrt(Math.max(0.02, 1 - k * k))} ry={G.r * 0.3} />)}
        </g>
        {/* accent meridian pulse */}
        <motion.ellipse
          cx={G.cx} cy={G.cy} rx={G.r * 0.55} ry={G.r} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" clipPath="url(#da-globeClip)"
          animate={reduce ? undefined : { opacity: [0.4, 0.8, 0.4] }} transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* candlesticks */}
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

        {/* helical trend wrapping the globe + inflation wave */}
        <g clipPath="url(#da-globeClip)">
          {/* back half (occluded) */}
          {HELIX.back.map((d, i) => (
            <path key={`hb${i}`} d={d} fill="none" stroke="var(--color-accent)" strokeWidth="1.8" strokeLinecap="round" opacity="0.2" />
          ))}
          {/* inflation wave behind */}
          <motion.path d="M150 352 q 26 -15 52 0 t 52 0 t 52 0 t 52 0 t 52 0"
            fill="none" stroke="var(--color-ochre)" strokeWidth="1.7" opacity="0.7" {...draw(1.1, 1.6)} />
          {/* front half (bright, with glow) */}
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

      {/* orbital nodes + labels */}
      {NODES.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.6" fill="var(--color-brass)" />)}
      {LABELS.map((l) => (
        <text key={l.t} x={l.x} y={l.y} textAnchor={l.a} className="da-label" fill="var(--color-ink-dim)">{l.t}</text>
      ))}

      {/* %-axis */}
      <line x1="508" y1="182" x2="508" y2="426" stroke="var(--color-ink-dim)" strokeWidth="1" opacity="0.4" />
      {AXIS.map((a) => (
        <g key={a.t}>
          <line x1="502" y1={a.y} x2="514" y2={a.y} stroke="var(--color-ink-dim)" strokeWidth="1" opacity="0.5" />
          <text x="522" y={a.y + 4} className="da-axis" fill="var(--color-ink-dim)">{a.t}</text>
        </g>
      ))}

      {/* live stat panel (faint backdrop for legibility over the chart) */}
      <g transform="translate(96 250)">
        <rect x="-12" y="-17" width="116" height="105" rx="3" fill="var(--color-bg)" opacity="0.55" />
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

      {/* golden-ratio spiral */}
      <motion.g fill="none" stroke="var(--color-brass)" strokeWidth="1.3" opacity="0.6" {...draw(1.4, 2)}>
        <rect x="412" y="600" width="112" height="112" />
        <rect x="412" y="600" width="69" height="69" />
        <rect x="447" y="600" width="34" height="34" />
        <path d="M524 600 a112 112 0 0 0 -112 112 M412 669 a69 69 0 0 0 69 -69 M481 634 a34 34 0 0 0 -34 -34" stroke="var(--color-accent)" strokeWidth="1.6" />
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
  const x0 = 52, y0 = 64, x1 = 548, y1 = 820;
  const cross = (cx: number, cy: number) => (
    <g stroke="var(--color-ink-dim)" strokeWidth="1.2" opacity="0.55">
      <line x1={cx - 9} y1={cy} x2={cx + 9} y2={cy} /><line x1={cx} y1={cy - 9} x2={cx} y2={cy + 9} />
    </g>
  );
  return (
    <g>
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="none" stroke="var(--color-ink-dim)" strokeWidth="1" strokeDasharray="2 6" opacity="0.4" />
      <rect x={x0 + 9} y={y0 + 9} width={x1 - x0 - 18} height={y1 - y0 - 18} fill="none" stroke="var(--color-ink-dim)" strokeWidth="1" opacity="0.18" />
      {cross(x0, y0)}{cross(x1, y0)}{cross(x0, y1)}{cross(x1, y1)}{cross(x0, (y0 + y1) / 2)}{cross(x1, (y0 + y1) / 2)}
    </g>
  );
}
