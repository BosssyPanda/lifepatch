"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect } from "react";
import { AnimatedNumber } from "@/components/story/AnimatedNumber";
import { FreedomIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/NeonButton";
import { useAudio } from "@/hooks/useAudio";
import { passiveIncome, totalExpenses } from "@/lib/cashflow/selectors";
import { currency } from "@/lib/format";
import type { CashflowState } from "@/lib/cashflow/types";

export function EscapeSequence({ s, onDone }: { s: CashflowState; onDone: () => void }) {
  const audio = useAudio();
  const reduce = useReducedMotion();

  useEffect(() => {
    audio.accent("stampGood");
    audio.swellWarmth();
    audio.setPhase("recapGood", 1.2);
    audio.setIntensity(0.2);
  }, [audio]);

  const passive = passiveIncome(s);
  const expenses = totalExpenses(s);

  return (
    <div className="relative grid min-h-[100svh] place-items-center overflow-hidden px-5 text-center">
      {/* radiant backdrop */}
      <motion.div
        className="pointer-events-none absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        style={{ background: "radial-gradient(60% 50% at 50% 40%, rgba(127,139,82,0.25), transparent 70%)" }}
      />
      {/* particles */}
      {!reduce &&
        Array.from({ length: 18 }).map((_, i) => (
          <motion.span
            key={i}
            className="absolute h-2 w-2 rounded-full bg-accent"
            style={{ left: `${(i * 53) % 100}%`, top: "60%" }}
            initial={{ y: 0, opacity: 0 }}
            animate={{ y: [-20, -260 - (i % 5) * 40], opacity: [0, 1, 0], x: [0, (i % 2 ? 1 : -1) * (30 + i * 4)] }}
            transition={{ duration: 2.2 + (i % 4) * 0.4, delay: 0.3 + i * 0.06, repeat: Infinity, repeatDelay: 1.2 }}
          />
        ))}

      <div className="relative z-10 max-w-xl">
        <motion.div
          initial={{ scale: 0, rotate: -12 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 12, delay: 0.1 }}
          className="mx-auto grid h-16 w-16 place-items-center rounded-full border-2 border-olive text-olive"
        >
          <FreedomIcon size={34} />
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="eyebrow mt-5 text-olive"
        >
          Passive income beat your expenses
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, scale: 0.9, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 180, damping: 14, delay: 0.35 }}
          className="display-caps mt-2 text-5xl text-ink sm:text-7xl"
        >
          You&apos;re free.
        </motion.h1>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="mx-auto mt-7 flex max-w-sm items-center justify-between rounded-[6px] border border-ink/15 bg-bg2 px-5 py-4"
        >
          <div className="text-left">
            <p className="eyebrow text-ink-dim" style={{ fontSize: "0.58rem" }}>Passive income</p>
            <p className="num text-2xl font-bold text-olive">
              <AnimatedNumber value={passive} format={(n) => currency(n)} />
            </p>
          </div>
          <span className="num text-ink-dim">vs</span>
          <div className="text-right">
            <p className="eyebrow text-ink-dim" style={{ fontSize: "0.58rem" }}>Expenses</p>
            <p className="num text-2xl font-bold text-ink">{currency(expenses)}</p>
          </div>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="mt-5 font-serif text-ink-dim"
        >
          You escaped the Rat Race in {s.turn} turns. Your assets now pay for your life — no job required. Time to chase the dream.
        </motion.p>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.25 }} className="mt-7">
          <NeonButton variant="primary" size="lg" onClick={() => { audio.accent("rise"); onDone(); }}>
            Enter the Fast Track →
          </NeonButton>
        </motion.div>
      </div>
    </div>
  );
}
