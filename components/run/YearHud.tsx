"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatedNumber } from "@/components/story/AnimatedNumber";
import { BlockSpark } from "@/components/ui/BlockSpark";
import { ChevronDown, InfoIcon } from "@/components/icons";
import { currency } from "@/lib/format";
import { netWorth, type RunState, yearIndex } from "@/lib/runEngine";

// LEDGER: meters read gain (green) high, secondary (grey) mid, loss (red) low.
function barVar(v: number) {
  return v >= 60 ? "var(--color-gain)" : v >= 35 ? "var(--color-secondary)" : "var(--color-loss)";
}

/**
 * HUD micro-interaction (Addendum A §8.2): when a tracked value changes, its
 * numeral gets a one-shot background tint flash in gain/loss color — the same
 * pulse the consequence beat's net-worth rail uses. Compositor-only, ≤600ms.
 */
function FlashValue({ value, children }: { value: number; children: ReactNode }) {
  const prev = useRef(value);
  const [flash, setFlash] = useState<"gain" | "loss" | null>(null);
  useEffect(() => {
    if (value === prev.current) return;
    setFlash(value > prev.current ? "gain" : "loss");
    prev.current = value;
    const id = window.setTimeout(() => setFlash(null), 650);
    return () => window.clearTimeout(id);
  }, [value]);
  const tint = flash === "gain" ? "rgba(43,213,118,0.16)" : "rgba(255,59,48,0.16)";
  return (
    <motion.span
      className="-mx-1 inline-block px-1"
      animate={flash ? { backgroundColor: ["rgba(0,0,0,0)", tint, "rgba(0,0,0,0)"] } : { backgroundColor: "rgba(0,0,0,0)" }}
      transition={{ duration: 0.55 }}
    >
      {children}
    </motion.span>
  );
}

export function YearHud({
  run,
  saving,
  onOpenAlmanac,
}: {
  run: RunState;
  saving: boolean;
  onOpenAlmanac: () => void;
}) {
  const [open, setOpen] = useState(false);
  const nw = netWorth(run);
  const nwVar = nw >= 0 ? "var(--color-gain)" : "var(--color-loss)";

  return (
    <header className="sticky top-8 z-40 border-b border-hairline bg-bg">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-3 py-2.5 sm:gap-6 sm:px-5">
        <div className="shrink-0">
          <p className="eyebrow text-secondary" style={{ fontSize: "0.6rem" }}>Year</p>
          <p className="num text-2xl leading-none text-ink">{yearIndex(run)}</p>
        </div>
        <div className="hidden h-7 w-px shrink-0 bg-hairline sm:block" />

        <Stat label="Age" value={`${run.age}`} />
        <Stat label="Cash" animated={run.cash} fmt={currency} />
        <div className="flex flex-1 flex-col">
          <p className="eyebrow text-secondary" style={{ fontSize: "0.6rem" }}>Net worth</p>
          <p className="num text-lg sm:text-xl" style={{ color: nwVar }}>
            <FlashValue value={nw}>
              <AnimatedNumber value={nw} format={currency} />
            </FlashValue>
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenAlmanac}
          className="hidden shrink-0 items-center gap-1 border border-ink/25 px-2.5 py-1.5 text-ink-dim transition-colors hover:border-ink hover:text-ink sm:flex"
        >
          <InfoIcon size={14} /><span className="eyebrow" style={{ fontSize: "0.58rem" }}>Learn</span>
        </button>
        <motion.span
          animate={saving ? { opacity: [0.4, 1, 0.4] } : { opacity: 0.5 }}
          transition={saving ? { duration: 1, repeat: Infinity } : {}}
          className="hidden shrink-0 eyebrow text-secondary md:inline"
          style={{ fontSize: "0.56rem" }}
        >
          {saving ? "Saving" : "Saved"}
        </motion.span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Toggle full stats"
          className="shrink-0 border border-ink/25 p-1.5 text-ink-dim transition-colors hover:border-ink hover:text-ink"
        >
          <motion.span animate={{ rotate: open ? 180 : 0 }} className="block"><ChevronDown size={16} /></motion.span>
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-hairline bg-bg2"
          >
            <div className="mx-auto grid max-w-5xl gap-3 px-3 py-3 sm:grid-cols-3 sm:px-5">
              <div className="space-y-2">
                <KV label="Salary" value={run.salary > 0 ? `${currency(run.salary)}/yr` : "Unemployed"} colorVar={run.salary > 0 ? "var(--color-ink)" : "var(--color-loss)"} />
                <KV label="Debt" value={currency(run.debt)} colorVar={run.debt > 0 ? "var(--color-loss)" : "var(--color-gain)"} />
                <KV label="Job" value={run.salary > 0 ? run.job : "Looking for work"} colorVar="var(--color-secondary)" />
                {run.history.length > 1 && (
                  <div className="flex items-baseline justify-between">
                    <span className="eyebrow text-secondary">Trend</span>
                    <BlockSpark values={run.history.map((h) => h.netWorth)} />
                  </div>
                )}
              </div>
              <div className="space-y-2.5">
                <Bar label="Health" v={run.life.health} />
                <Bar label="Mood" v={run.life.happiness} />
              </div>
              <div className="space-y-2">
                <KV label="Status" value={run.life.partner ? "Married" : "Single"} colorVar="var(--color-secondary)" />
                <KV label="Kids" value={`${run.life.kids}`} colorVar="var(--color-secondary)" />
                <KV label="Home" value={run.life.housing === "owned" ? "Homeowner" : "Renting"} colorVar="var(--color-secondary)" />
              </div>
              <button type="button" onClick={onOpenAlmanac} className="eyebrow text-ink sm:hidden">Open the Almanac →</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

function Stat({ label, value, animated, fmt }: { label: string; value?: string; animated?: number; fmt?: (n: number) => string }) {
  return (
    <div className="flex flex-col">
      <p className="eyebrow text-secondary" style={{ fontSize: "0.6rem" }}>{label}</p>
      <p className="num text-base sm:text-lg text-ink">
        {animated !== undefined && fmt ? (
          <FlashValue value={animated}>
            <AnimatedNumber value={animated} format={fmt} />
          </FlashValue>
        ) : (
          value
        )}
      </p>
    </div>
  );
}

function KV({ label, value, colorVar }: { label: string; value: string; colorVar: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="eyebrow text-secondary">{label}</span>
      <span className="num text-sm" style={{ color: colorVar }}>{value}</span>
    </div>
  );
}

function Bar({ label, v }: { label: string; v: number }) {
  const colorVar = barVar(v);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="eyebrow text-secondary">{label}</span>
        <span className="num text-xs" style={{ color: colorVar }}>
          <FlashValue value={v}>{Math.round(v)}</FlashValue>
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden bg-hairline">
        <motion.div className="h-full" style={{ background: colorVar }} animate={{ width: `${v}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
      </div>
    </div>
  );
}
