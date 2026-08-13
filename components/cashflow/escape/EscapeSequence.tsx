"use client";

import { motion, type Variants } from "framer-motion";
import { useEffect, useState } from "react";
import { AnimatedNumber } from "@/components/story/AnimatedNumber";
import { FreedomIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/LedgerButton";
import { SkipButton } from "@/components/cinematic/Controls";
import { useAudio } from "@/hooks/useAudio";
import { passiveIncome, totalExpenses } from "@/lib/cashflow/selectors";
import { currency } from "@/lib/format";
import { useSkippable } from "@/src/motion/useSkippable";
import { DUR, EASE, SPRING, STAGGER } from "@/src/motion/tokens";
import type { CashflowState } from "@/lib/cashflow/types";

/** How long the ceremony runs before it settles on its own (ms). */
const CEREMONY_MS = 1700;

/**
 * The beats are driven by *variant name*, not by per-element delays: switching the
 * parent from "show" to "settled" re-resolves every child at zero duration, which is
 * what makes the ceremony skippable mid-flight without remounting (and re-triggering)
 * the count-up inside it.
 */
const container: Variants = {
  hidden: {},
  show: { transition: { delayChildren: 0.1, staggerChildren: STAGGER.loose } },
  settled: { transition: { duration: 0 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE } },
  settled: { opacity: 1, y: 0, transition: { duration: 0 } },
};

const seal: Variants = {
  hidden: { scale: 0, rotate: -12 },
  show: { scale: 1, rotate: 0, transition: SPRING.reward },
  settled: { scale: 1, rotate: 0, transition: { duration: 0 } },
};

const headline: Variants = {
  hidden: { opacity: 0, scale: 0.9, y: 16 },
  show: { opacity: 1, scale: 1, y: 0, transition: SPRING.reward },
  settled: { opacity: 1, scale: 1, y: 0, transition: { duration: 0 } },
};

export function EscapeSequence({ s, onDone }: { s: CashflowState; onDone: () => void }) {
  const audio = useAudio();
  const [settled, setSettled] = useState(false);
  // The only ceremony in the app that couldn't be skipped — any tap/key now lands it.
  const { reduced: reduce } = useSkippable(!settled, () => setSettled(true));

  useEffect(() => {
    audio.accent("stampGood");
    audio.swellWarmth();
    audio.setPhase("recapGood", 1.2);
    audio.setIntensity(0.2);
  }, [audio]);

  useEffect(() => {
    if (reduce) {
      setSettled(true);
      return;
    }
    const id = window.setTimeout(() => setSettled(true), CEREMONY_MS);
    return () => window.clearTimeout(id);
  }, [reduce]);

  const passive = passiveIncome(s);
  const expenses = totalExpenses(s);

  return (
    <div className="relative grid min-h-[100svh] place-items-center overflow-hidden px-5 text-center">
      {/* particles */}
      {!reduce &&
        Array.from({ length: 18 }).map((_, i) => (
          <motion.span
            key={i}
            aria-hidden
            className="absolute h-2 w-2 bg-ink"
            style={{ left: `${(i * 53) % 100}%`, top: "60%" }}
            initial={{ y: 0, opacity: 0 }}
            animate={{ y: [-20, -260 - (i % 5) * 40], opacity: [0, 1, 0], x: [0, (i % 2 ? 1 : -1) * (30 + i * 4)] }}
            transition={{ duration: 2.2 + (i % 4) * 0.4, delay: 0.3 + i * 0.06, repeat: Infinity, repeatDelay: 1.2 }}
          />
        ))}

      {!settled && (
        <div className="absolute bottom-6 right-4 z-40">
          <SkipButton onSkip={() => setSettled(true)} />
        </div>
      )}

      <motion.div
        className="relative z-10 max-w-xl"
        variants={container}
        initial={reduce ? "settled" : "hidden"}
        animate={settled ? "settled" : "show"}
      >
        <motion.div
          variants={seal}
          className="mx-auto grid h-16 w-16 place-items-center border-2 border-gain text-gain"
        >
          <FreedomIcon size={34} />
        </motion.div>

        <motion.p variants={item} className="eyebrow mt-5 text-gain">
          Passive income beat your expenses
        </motion.p>

        <motion.h1 variants={headline} className="display-caps mt-2 text-5xl text-ink sm:text-7xl">
          You&apos;re free.
        </motion.h1>

        <motion.div
          variants={item}
          className="mx-auto mt-7 flex max-w-sm items-center justify-between border border-hairline bg-bg2 px-5 py-4"
        >
          <div className="text-left">
            <p className="eyebrow text-ink-dim" style={{ fontSize: "0.58rem" }}>Passive income</p>
            <p className="num text-2xl font-bold text-gain">
              <AnimatedNumber value={passive} format={(n) => currency(n)} />
            </p>
          </div>
          <span className="num text-ink-dim">vs</span>
          <div className="text-right">
            <p className="eyebrow text-ink-dim" style={{ fontSize: "0.58rem" }}>Expenses</p>
            <p className="num text-2xl font-bold text-ink">{currency(expenses)}</p>
          </div>
        </motion.div>

        <motion.p variants={item} className="mt-5 font-body text-ink-dim">
          You escaped the Rat Race in {s.turn} turns. Your assets now pay for your life — no job required. Time to chase the dream.
        </motion.p>

        <motion.div variants={item} className="mt-7">
          <NeonButton variant="primary" size="lg" onClick={() => { audio.accent("rise"); onDone(); }}>
            Enter the Fast Track →
          </NeonButton>
        </motion.div>
      </motion.div>
    </div>
  );
}
