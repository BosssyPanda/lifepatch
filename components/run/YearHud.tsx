"use client";

import { motion } from "framer-motion";
import { AnimatedNumber } from "@/components/story/AnimatedNumber";
import { SaveIcon } from "@/components/icons";
import { currency } from "@/lib/format";
import { netWorth, type RunState, yearIndex } from "@/lib/runEngine";

export function YearHud({ run, saving }: { run: RunState; saving: boolean }) {
  const nw = netWorth(run);
  const nwHex = nw >= 0 ? "#7f8b52" : "#a33218";
  return (
    <motion.header
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 200, damping: 26 }}
      className="sticky top-0 z-40 border-b border-ink/12 bg-bg/85 backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-3 py-2.5 sm:gap-6 sm:px-5">
        <div className="shrink-0">
          <p className="eyebrow text-ink-dim" style={{ fontSize: "0.6rem" }}>Year</p>
          <p className="num text-2xl leading-none text-accent">{yearIndex(run)}</p>
        </div>
        <div className="hidden h-7 w-px shrink-0 bg-ink/15 sm:block" />

        <Stat label="Age" value={`${run.age}`} />
        <Stat label="Cash" value={currency(run.cash)} animated={run.cash} fmt={currency} />
        <div className="flex flex-1 flex-col items-end sm:items-start">
          <p className="eyebrow text-ink-dim" style={{ fontSize: "0.6rem" }}>Net worth</p>
          <p className="num text-lg sm:text-xl" style={{ color: nwHex }}>
            <AnimatedNumber value={nw} format={currency} />
          </p>
        </div>

        <motion.span
          aria-label={saving ? "Saving" : "Saved"}
          animate={saving ? { opacity: [0.4, 1, 0.4] } : { opacity: 0.5 }}
          transition={saving ? { duration: 1, repeat: Infinity } : {}}
          className="hidden shrink-0 items-center gap-1 text-ink-dim sm:flex"
        >
          <SaveIcon size={14} />
          <span className="eyebrow" style={{ fontSize: "0.58rem" }}>{saving ? "Saving" : "Saved"}</span>
        </motion.span>
      </div>
    </motion.header>
  );
}

function Stat({ label, value, animated, fmt }: { label: string; value: string; animated?: number; fmt?: (n: number) => string }) {
  return (
    <div className="flex flex-col">
      <p className="eyebrow text-ink-dim" style={{ fontSize: "0.6rem" }}>{label}</p>
      <p className="num text-base sm:text-lg text-ink">
        {animated !== undefined && fmt ? <AnimatedNumber value={animated} format={fmt} /> : value}
      </p>
    </div>
  );
}
