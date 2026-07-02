"use client";

import { motion, useReducedMotion } from "framer-motion";
import { assetReturn, macroEvent, sp500Return } from "@/lib/markets";

/**
 * Title attract ticker (Addendum A §6 / §13 #3). A hairline-bounded mono marquee
 * of REAL market history pulled straight from the `lib/markets` sim — S&P annual
 * returns, notable macro events, and a couple of asset moves. Never fabricated.
 * Compositor-only (a single translateX loop); static under reduced motion.
 */

type Tick =
  | { kind: "pct"; label: string; pct: number }
  | { kind: "event"; label: string };

// Curated real years — a spread of booms, busts, and named crises. The numbers
// come from lib/markets; only the year selection is authored.
const YEARS = [1958, 1962, 1974, 1980, 1987, 1995, 1999, 2000, 2008, 2009, 2013, 2020, 2021, 2022, 2024];

function buildTicks(): Tick[] {
  const ticks: Tick[] = [];
  for (const y of YEARS) {
    ticks.push({ kind: "pct", label: `S&P ${y}`, pct: sp500Return(y) });
    const ev = macroEvent(y);
    if (ev) ticks.push({ kind: "event", label: `${y} · ${ev.title.toUpperCase()}` });
  }
  ticks.push({ kind: "pct", label: "GOLD 1979", pct: assetReturn("gold", 1979) });
  ticks.push({ kind: "pct", label: "CRYPTO 2017", pct: assetReturn("crypto", 2017) });
  ticks.push({ kind: "pct", label: "CRYPTO 2022", pct: assetReturn("crypto", 2022) });
  return ticks;
}

const TICKS = buildTicks();

function TickItem({ t }: { t: Tick }) {
  if (t.kind === "event") {
    return (
      <span className="flex items-center gap-2.5">
        <span className="num text-tertiary">◇</span>
        <span className="eyebrow text-secondary" style={{ fontSize: "0.6rem", letterSpacing: "0.18em" }}>
          {t.label}
        </span>
      </span>
    );
  }
  const up = t.pct >= 0;
  return (
    <span className="flex items-baseline gap-2">
      <span className="eyebrow text-ink" style={{ fontSize: "0.6rem", letterSpacing: "0.14em" }}>{t.label}</span>
      <span className="num" style={{ fontSize: "0.64rem", color: up ? "var(--color-gain)" : "var(--color-loss)" }}>
        {up ? "+" : "−"}{Math.abs(t.pct).toFixed(1)}%
      </span>
    </span>
  );
}

function Row() {
  return (
    <div className="flex shrink-0 items-center gap-8 pr-8" aria-hidden>
      {TICKS.map((t, i) => (
        <TickItem key={`${t.label}-${i}`} t={t} />
      ))}
    </div>
  );
}

export function TitleTicker({ className = "" }: { className?: string }) {
  const reduce = useReducedMotion();

  return (
    <div
      className={`relative flex w-full items-center overflow-hidden border-y border-hairline py-2.5 ${className}`}
      role="marquee"
      aria-label="Live market history ticker"
    >
      {reduce ? (
        <div className="flex items-center gap-8 overflow-hidden px-1">
          <Row />
        </div>
      ) : (
        <motion.div
          className="flex w-max items-center"
          animate={{ x: ["0%", "-50%"] }}
          transition={{ duration: 48, repeat: Infinity, ease: "linear" }}
        >
          <Row />
          <Row />
        </motion.div>
      )}
    </div>
  );
}
