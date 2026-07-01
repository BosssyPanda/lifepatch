"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect } from "react";
import { AnimatedNumber } from "@/components/story/AnimatedNumber";
import { BrainIcon, ReplayIcon, TrophyIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/NeonButton";
import { MoneyBrainMeter, moneyBrainPct } from "@/components/learn/MoneyBrainMeter";
import { useAudio } from "@/hooks/useAudio";
import { useConceptLearn } from "@/hooks/useConceptLearn";
import { useProfile } from "@/hooks/useProfile";
import { conceptTitle } from "@/lib/concepts";
import { getDream } from "@/lib/cashflow/dreams";
import { getProfession } from "@/lib/cashflow/professions";
import { netWorth, passiveIncome } from "@/lib/cashflow/selectors";
import { currency } from "@/lib/format";
import type { CashflowState } from "@/lib/cashflow/types";

function archetype(s: CashflowState): { title: string; line: string } {
  const esc = s.escapedOnTurn ?? s.turn;
  if (esc <= 14) return { title: "The Lightning Escape", line: "You read the deals, struck fast, and never looked back." };
  if (s.dealsBought >= 8) return { title: "The Asset Stacker", line: "Brick by brick, deal by deal — you built an income machine." };
  if (s.liabilities.bankLoan === 0) return { title: "The Disciplined Investor", line: "You escaped without ever leaning on the bank. Clean run." };
  return { title: "The Freedom Builder", line: "You turned a salary into assets and assets into freedom." };
}

function Stat({ label, value, format = (n: number) => currency(n), tone }: { label: string; value: number; format?: (n: number) => string; tone?: string }) {
  return (
    <div className="rounded-[5px] border border-ink/12 bg-bg2 p-3 text-center">
      <p className="eyebrow text-ink-dim" style={{ fontSize: "0.56rem" }}>{label}</p>
      <p className={`num mt-1 text-xl font-bold ${tone ?? "text-ink"}`}>
        <AnimatedNumber value={value} format={format} />
      </p>
    </div>
  );
}

export function CashflowReport({ s, onReplay, onExit, onMasteryMap }: { s: CashflowState; onReplay: () => void; onExit: () => void; onMasteryMap?: () => void }) {
  const audio = useAudio();
  const reduce = useReducedMotion();
  const dream = getDream(s.dreamId);
  const prof = getProfession(s.professionId);
  const arch = archetype(s);
  const { mastery } = useProfile();
  const { runGains } = useConceptLearn();

  useEffect(() => {
    audio.setPhase("recapGood", 1.4);
    audio.accent("stampGood");
    audio.swellWarmth();
  }, [audio]);

  // warm the recap bed by how rich the Money Brain has become
  useEffect(() => {
    audio.setBrainGlow(moneyBrainPct(mastery) / 100);
  }, [mastery, audio]);

  return (
    <div className="mx-auto min-h-[100svh] w-full max-w-3xl px-5 py-12">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <motion.div
          initial={{ scale: 0, rotate: -10 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 12, delay: 0.1 }}
          className="mx-auto grid h-16 w-16 place-items-center rounded-full border-2 border-accent text-accent"
        >
          <TrophyIcon size={34} />
        </motion.div>
        <p className="eyebrow mt-4 text-accent">You won the game</p>
        <h1 className="display-caps mt-2 text-4xl text-ink sm:text-6xl">
          {s.dreamPurchased ? dream.title : "+$50k / month"}
        </h1>
        <p className="mt-2 font-serif text-ink-dim">
          {s.dreamPurchased
            ? "You lived your dream — funded entirely by your assets."
            : "You built fifty thousand dollars a month in cash flow. Generational freedom."}
        </p>
      </motion.div>

      {/* verdict stamp */}
      <motion.div
        initial={{ opacity: 0, scale: 1.2, rotate: reduce ? 0 : -6 }}
        animate={{ opacity: 1, scale: 1, rotate: reduce ? 0 : -3 }}
        transition={{ type: "spring", stiffness: 200, damping: 14, delay: 0.5 }}
        className="mx-auto mt-8 w-fit rounded-[6px] border-2 border-accent px-6 py-3 text-center"
      >
        <p className="eyebrow text-ink-dim" style={{ fontSize: "0.56rem" }}>Your verdict</p>
        <p className="display-caps text-2xl text-accent">{arch.title}</p>
      </motion.div>
      <p className="mx-auto mt-3 max-w-md text-center font-serif text-[0.92rem] text-ink-dim">{arch.line}</p>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Escaped on turn" value={s.escapedOnTurn ?? s.turn} format={(n) => String(Math.round(n))} tone="text-olive" />
        <Stat label="Total turns" value={s.turn} format={(n) => String(Math.round(n))} />
        <Stat label="Net worth" value={netWorth(s)} tone="text-accent" />
        <Stat label="Passive income" value={passiveIncome(s)} tone="text-olive" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Deals bought" value={s.dealsBought} format={(n) => String(Math.round(n))} />
        <Stat label="Quizzes passed" value={s.quizzesPassed} format={(n) => String(Math.round(n))} />
        <Stat label="Started as" value={0} format={() => prof.title} />
      </div>

      <div className="mt-8 rounded-[6px] border-l-[3px] border-accent bg-accent/10 px-4 py-3">
        <p className="eyebrow text-accent" style={{ fontSize: "0.6rem" }}>The lesson you just lived</p>
        <p className="mt-1 font-serif text-[0.95rem] leading-relaxed text-ink">
          Freedom never came from a bigger paycheck — it came from buying assets that pay you whether you work or not. That&apos;s real financial IQ, and it works exactly the same in real life.
        </p>
      </div>

      <div className="mt-8 rounded-[6px] border border-ink/12 bg-bg2 px-4 py-4 text-ink">
        <MoneyBrainMeter mastery={mastery} />
        {runGains.length > 0 && (
          <p className="mt-2 font-serif text-[0.9rem] text-ink-dim">
            This run sharpened: <span className="text-ink">{runGains.map(conceptTitle).join(", ")}</span>.
          </p>
        )}
        {onMasteryMap && (
          <button type="button" onClick={onMasteryMap} className="eyebrow mt-3 inline-flex items-center gap-1.5 text-accent transition-opacity hover:opacity-70">
            <BrainIcon size={13} /> View your Money Brain →
          </button>
        )}
      </div>

      <div className="mt-8 flex items-center justify-center gap-3">
        <NeonButton variant="secondary" size="md" onClick={onExit}>
          ← Back to title
        </NeonButton>
        <NeonButton variant="primary" size="lg" onClick={() => { audio.sfx("confirm"); onReplay(); }}>
          <ReplayIcon size={16} /> Play again
        </NeonButton>
      </div>
    </div>
  );
}
