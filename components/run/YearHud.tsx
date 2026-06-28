"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { AnimatedNumber } from "@/components/story/AnimatedNumber";
import { ChevronDown, InfoIcon } from "@/components/icons";
import { currency } from "@/lib/format";
import { netWorth, type RunState, yearIndex } from "@/lib/runEngine";

function barHex(v: number) {
  return v >= 60 ? "#7f8b52" : v >= 35 ? "#c8861e" : "#a33218";
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
  const nwHex = nw >= 0 ? "#7f8b52" : "#a33218";

  return (
    <header className="sticky top-0 z-40 border-b border-ink/12 bg-bg/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-3 py-2.5 sm:gap-6 sm:px-5">
        <div className="shrink-0">
          <p className="eyebrow text-ink-dim" style={{ fontSize: "0.6rem" }}>Year</p>
          <p className="num text-2xl leading-none text-accent">{yearIndex(run)}</p>
        </div>
        <div className="hidden h-7 w-px shrink-0 bg-ink/15 sm:block" />

        <Stat label="Age" value={`${run.age}`} />
        <Stat label="Cash" animated={run.cash} fmt={currency} />
        <div className="flex flex-1 flex-col">
          <p className="eyebrow text-ink-dim" style={{ fontSize: "0.6rem" }}>Net worth</p>
          <p className="num text-lg sm:text-xl" style={{ color: nwHex }}>
            <AnimatedNumber value={nw} format={currency} />
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenAlmanac}
          className="hidden shrink-0 items-center gap-1 rounded-[3px] border border-ink/25 px-2.5 py-1.5 text-ink-dim transition-colors hover:border-accent hover:text-accent sm:flex"
        >
          <InfoIcon size={14} /><span className="eyebrow" style={{ fontSize: "0.58rem" }}>Learn</span>
        </button>
        <motion.span
          animate={saving ? { opacity: [0.4, 1, 0.4] } : { opacity: 0.5 }}
          transition={saving ? { duration: 1, repeat: Infinity } : {}}
          className="hidden shrink-0 eyebrow text-ink-dim md:inline"
          style={{ fontSize: "0.56rem" }}
        >
          {saving ? "Saving" : "Saved"}
        </motion.span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Toggle full stats"
          className="shrink-0 rounded-[3px] border border-ink/25 p-1.5 text-ink-dim transition-colors hover:border-accent hover:text-accent"
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
            className="overflow-hidden border-t border-ink/10 bg-bg2/60"
          >
            <div className="mx-auto grid max-w-5xl gap-3 px-3 py-3 sm:grid-cols-3 sm:px-5">
              <div className="space-y-2">
                <KV label="Salary" value={run.salary > 0 ? `${currency(run.salary)}/yr` : "Unemployed"} hex={run.salary > 0 ? "#e9e1cf" : "#a33218"} />
                <KV label="Debt" value={currency(run.debt)} hex={run.debt > 0 ? "#a33218" : "#7f8b52"} />
                <KV label="Job" value={run.salary > 0 ? run.job : "Looking for work"} hex="#a89f8c" />
              </div>
              <div className="space-y-2.5">
                <Bar label="Health" v={run.life.health} />
                <Bar label="Mood" v={run.life.happiness} />
              </div>
              <div className="space-y-2">
                <KV label="Status" value={run.life.partner ? "Married" : "Single"} hex="#a89f8c" />
                <KV label="Kids" value={`${run.life.kids}`} hex="#a89f8c" />
                <KV label="Home" value={run.life.housing === "owned" ? "Homeowner" : "Renting"} hex="#a89f8c" />
              </div>
              <button type="button" onClick={onOpenAlmanac} className="eyebrow text-accent sm:hidden">Open the Almanac →</button>
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
      <p className="eyebrow text-ink-dim" style={{ fontSize: "0.6rem" }}>{label}</p>
      <p className="num text-base sm:text-lg text-ink">
        {animated !== undefined && fmt ? <AnimatedNumber value={animated} format={fmt} /> : value}
      </p>
    </div>
  );
}

function KV({ label, value, hex }: { label: string; value: string; hex: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="eyebrow text-ink-dim">{label}</span>
      <span className="num text-sm" style={{ color: hex }}>{value}</span>
    </div>
  );
}

function Bar({ label, v }: { label: string; v: number }) {
  const hex = barHex(v);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="eyebrow text-ink-dim">{label}</span>
        <span className="num text-xs" style={{ color: hex }}>{Math.round(v)}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-black/40">
        <motion.div className="h-full rounded-full" style={{ background: hex }} animate={{ width: `${v}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
      </div>
    </div>
  );
}
