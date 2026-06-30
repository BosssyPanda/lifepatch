"use client";

import { useMemo } from "react";

/**
 * The LifePatch seal — an engraved, banknote-style emblem built from layered
 * hypotrochoid (guilloché) curves, concentric rules, and a radial tick bezel.
 * All stroke, no fills, no glow: it reads as fine intaglio line-work, not a
 * "simple shape". Pure SVG math (no assets, no WebGL). Inherits `currentColor`;
 * callers tint the layers.
 */

const C = 100; // center

/** Classic guilloché: a hypotrochoid traced until it closes. */
function guilloche(R: number, r: number, d: number, steps = 1800): string {
  // closes after `r / gcd(R,r)` revolutions
  const g = gcd(R, r);
  const turns = r / g;
  const diff = R - r;
  let path = "";
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * turns * 2 * Math.PI;
    const x = C + diff * Math.cos(t) + d * Math.cos((diff / r) * t);
    const y = C + diff * Math.sin(t) - d * Math.sin((diff / r) * t);
    path += (i === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2);
  }
  return path + "Z";
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Evenly spaced radial ticks between two radii (the engraved bezel). */
function ticks(count: number, r1: number, r2: number): string {
  let p = "";
  for (let i = 0; i < count; i++) {
    const a = (i / count) * 2 * Math.PI;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    p += `M${(C + r1 * ca).toFixed(2)} ${(C + r1 * sa).toFixed(2)}L${(C + r2 * ca).toFixed(2)} ${(C + r2 * sa).toFixed(2)}`;
  }
  return p;
}

export function Emblem({ size = 240, className }: { size?: number; className?: string }) {
  const outer = useMemo(() => guilloche(62, 11, 30), []);
  const mid = useMemo(() => guilloche(46, 7, 22), []);
  const core = useMemo(() => guilloche(26, 5, 16), []);
  const bezel = useMemo(() => ticks(72, 80, 88), []);
  const bezelFine = useMemo(() => ticks(144, 84, 88), []);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      className={className}
      role="img"
      aria-label="LifePatch seal"
    >
      {/* concentric rules */}
      <circle cx={C} cy={C} r="93" stroke="currentColor" strokeWidth="1" opacity="0.6" />
      <circle cx={C} cy={C} r="88" stroke="currentColor" strokeWidth="2.6" opacity="1" />
      <circle cx={C} cy={C} r="80" stroke="currentColor" strokeWidth="1.1" opacity="0.7" />
      <circle cx={C} cy={C} r="70" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
      <circle cx={C} cy={C} r="34" stroke="currentColor" strokeWidth="1.1" opacity="0.7" />
      <circle cx={C} cy={C} r="30" stroke="var(--color-accent)" strokeWidth="2.2" opacity="1" />

      {/* engraved tick bezel */}
      <path d={bezelFine} stroke="currentColor" strokeWidth="0.55" opacity="0.45" />
      <path d={bezel} stroke="currentColor" strokeWidth="1.1" opacity="0.8" />

      {/* guilloché bands */}
      <path d={outer} stroke="currentColor" strokeWidth="0.8" opacity="0.8" />
      <path d={mid} stroke="var(--color-accent)" strokeWidth="1" opacity="0.95" />
      <path d={core} stroke="currentColor" strokeWidth="0.9" opacity="1" />

      {/* center mark: an upward intaglio rule (the "rising" motif) */}
      <g stroke="currentColor" opacity="1">
        <path d="M86 111 L97 98 L104 104 L114 88" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M114 88 l-7 0 m7 0 l0 7" strokeWidth="2.2" strokeLinecap="round" />
      </g>
    </svg>
  );
}
