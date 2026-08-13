"use client";

import { motion } from "framer-motion";
import { useEffect } from "react";
import { AnimatedNumber } from "@/components/story/AnimatedNumber";
import { BrainIcon, ReplayIcon, TrophyIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/LedgerButton";
import { LedgerRow, SectionLabel } from "@/components/ui/report";
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
import { STAGGER } from "@/src/motion/tokens";

const container = { hidden: {}, show: { transition: { staggerChildren: STAGGER.list, delayChildren: STAGGER.loose } } };
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };

function archetype(s: CashflowState): { title: string; line: string } {
  const esc = s.escapedOnTurn ?? s.turn;
  if (esc <= 14) return { title: "The Lightning Escape", line: "You read the deals, struck fast, and never looked back." };
  if (s.dealsBought >= 8) return { title: "The Asset Stacker", line: "Brick by brick, deal by deal — you built an income machine." };
  if (s.liabilities.bankLoan === 0) return { title: "The Disciplined Investor", line: "You escaped without ever leaning on the bank. Clean run." };
  return { title: "The Freedom Builder", line: "You turned a salary into assets and assets into freedom." };
}

export function CashflowReport({ s, onReplay, onExit, onMasteryMap }: { s: CashflowState; onReplay: () => void; onExit: () => void; onMasteryMap?: () => void }) {
  const audio = useAudio();
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
    <div className="mx-auto min-h-[100svh] w-full max-w-2xl px-5 py-14">
      <motion.div variants={container} initial="hidden" animate="show">
        {/* masthead — the win statement */}
        <motion.header variants={item} className="border-b border-hairline pb-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="eyebrow text-secondary">Escape Statement</p>
            <p className="eyebrow flex items-center gap-1.5 text-gain">
              <TrophyIcon size={13} /> You won
            </p>
          </div>
          <h1 className="display-caps mt-3 text-3xl text-ink sm:text-5xl">
            {s.dreamPurchased ? dream.title : "+$50k / month"}
          </h1>
          <p className="voice mt-2 max-w-lg text-[1.05rem] leading-snug text-ink/80">
            {s.dreamPurchased
              ? "You lived your dream — funded entirely by your assets."
              : "Fifty thousand dollars a month in cash flow. Generational freedom."}
          </p>
        </motion.header>

        {/* verdict — a left-aligned ink stamp, blurb as a voice line */}
        <motion.div variants={item} className="mt-6">
          <div className="inline-block border-2 border-ink px-5 py-2.5 text-ink">
            <p className="eyebrow text-secondary" style={{ fontSize: "0.56rem" }}>Your verdict</p>
            <p className="display-caps text-2xl text-ink sm:text-3xl">{arch.title}</p>
          </div>
          <p className="voice mt-3 max-w-lg text-[1.05rem] leading-snug text-ink/80">{arch.line}</p>
        </motion.div>

        {/* statement — dot-leader ledger rows */}
        <motion.section variants={item}>
          <SectionLabel>Final statement</SectionLabel>
          <LedgerRow label="Net worth" strong value={<AnimatedNumber value={netWorth(s)} format={(n) => currency(n)} />} />
          <LedgerRow label="Passive income" tone="text-gain" size="0.95rem" value={<AnimatedNumber value={passiveIncome(s)} format={(n) => currency(n)} />} />
          <LedgerRow label="Escaped on turn" tone="text-gain" size="0.95rem" value={<AnimatedNumber value={s.escapedOnTurn ?? s.turn} format={(n) => String(Math.round(n))} />} />
          <LedgerRow label="Total turns" size="0.95rem" value={<AnimatedNumber value={s.turn} format={(n) => String(Math.round(n))} />} />
          <LedgerRow label="Deals bought" size="0.95rem" value={<AnimatedNumber value={s.dealsBought} format={(n) => String(Math.round(n))} />} />
          <LedgerRow label="Quizzes passed" size="0.95rem" value={<AnimatedNumber value={s.quizzesPassed} format={(n) => String(Math.round(n))} />} />
          <LedgerRow label="Started as" size="0.95rem" value={prof.title} />
        </motion.section>

        {/* the lesson — one quiet voice line */}
        <motion.div variants={item} className="mt-8 border-t border-hairline pt-4">
          <p className="voice text-[1.15rem] leading-snug text-ink">
            Freedom never came from a bigger paycheck — it came from buying assets that pay you whether you work or not. That&apos;s real financial IQ, and it works exactly the same in real life.
          </p>
        </motion.div>

        {/* money brain */}
        <motion.div variants={item} className="mt-8 border border-hairline bg-bg2 px-4 py-4 text-ink">
          <MoneyBrainMeter mastery={mastery} />
          {runGains.length > 0 && (
            <p className="mt-2 font-body text-[0.9rem] text-secondary">
              This run sharpened: <span className="text-ink">{runGains.map(conceptTitle).join(", ")}</span>.
            </p>
          )}
          {onMasteryMap && (
            <button type="button" onClick={onMasteryMap} className="eyebrow mt-3 inline-flex items-center gap-1.5 text-ink transition-opacity hover:opacity-70">
              <BrainIcon size={13} /> View your Money Brain →
            </button>
          )}
        </motion.div>

        {/* actions */}
        <motion.div variants={item} className="mt-8 flex flex-wrap gap-3 border-t border-hairline pt-6">
          <NeonButton variant="primary" size="lg" onClick={() => { audio.sfx("confirm"); onReplay(); }}>
            <ReplayIcon size={16} /> Play again
          </NeonButton>
          <NeonButton variant="secondary" size="md" onClick={onExit}>← Back to title</NeonButton>
        </motion.div>
      </motion.div>
    </div>
  );
}
