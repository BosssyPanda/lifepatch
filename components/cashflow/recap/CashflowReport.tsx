"use client";

import { PALETTE, INK_TIER } from "@/lib/palette";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { AnimatedNumber } from "@/components/story/AnimatedNumber";
import { BrainIcon, ReplayIcon, TrophyIcon } from "@/components/icons";
import { ShareCard } from "@/components/share/ShareCard";
import { useShareUrlFor } from "@/components/share/useShareUrl";
import { NeonButton } from "@/components/ui/LedgerButton";
import { LedgerRow, SectionLabel } from "@/components/ui/report";
import { MoneyBrainMeter, moneyBrainPct } from "@/components/learn/MoneyBrainMeter";
import { useAudio } from "@/hooks/useAudio";
import { useConceptLearn } from "@/hooks/useConceptLearn";
import { useProfile } from "@/hooks/useProfile";
import { conceptTitle } from "@/lib/concepts";
import { getDream } from "@/lib/cashflow/dreams";
import { getProfession } from "@/lib/cashflow/professions";
import { bankLoanPayment, hasEscaped, netWorth, passiveIncome, totalExpenses } from "@/lib/cashflow/selectors";
import { cashflowScore } from "@/lib/cloud/buildResult";
import { currency } from "@/lib/format";
import type { CashflowState } from "@/lib/cashflow/types";
import { STAGGER } from "@/src/motion/tokens";

const container = { hidden: {}, show: { transition: { staggerChildren: STAGGER.list, delayChildren: STAGGER.loose } } };
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };

function archetype(s: CashflowState): { title: string; line: string } {
  if (s.status === "lost") {
    if (s.dealsBought === 0) return { title: "The Spectator", line: "You never bought a single asset. Every dollar that came in went straight back out." };
    if (s.interestPaid > 0) return { title: "The Bank's Best Customer", line: "You kept playing. The interest kept compounding. It won." };
    return { title: "Buried in Debt", line: "The bills outran the income, and borrowing only made the bills bigger." };
  }
  const esc = s.escapedOnTurn ?? s.turn;
  if (esc <= 14) return { title: "The Lightning Escape", line: "You read the deals, struck fast, and never looked back." };
  if (s.dealsBought >= 8) return { title: "The Asset Stacker", line: "Brick by brick, deal by deal — you built an income machine." };
  if (s.liabilities.bankLoan === 0) return { title: "The Disciplined Investor", line: "You escaped without ever leaning on the bank. Clean run." };
  return { title: "The Freedom Builder", line: "You turned a salary into assets and assets into freedom." };
}

/** The best passive income the run ever reached — the height it fell from. */
function peakPassive(s: CashflowState): number {
  return Math.max(passiveIncome(s), ...s.log.map((l) => l.passiveIncome), 0);
}

export function CashflowReport({ s, onReplay, onExit, onMasteryMap }: { s: CashflowState; onReplay: () => void; onExit: () => void; onMasteryMap?: () => void }) {
  const audio = useAudio();
  const dream = getDream(s.dreamId);
  const prof = getProfession(s.professionId);
  const arch = archetype(s);
  const { mastery } = useProfile();
  const { runGains } = useConceptLearn();
  const [shareOpen, setShareOpen] = useState(false);

  const lost = s.status === "lost";
  // The Rat Race row is ranked by net worth + a year of payday (score v2), so that
  // is what resolves its /r/{id} — passive income alone rewarded maximum debt.
  const passive = passiveIncome(s);
  const nw = netWorth(s);
  const score = cashflowScore(s);
  const shareUrl = useShareUrlFor("cashflow", score);
  const verdict = lost ? "Buried in Debt" : hasEscaped(s) ? "Escaped the Rat Race" : "Still Racing";

  const shareData = useMemo(
    () => ({
      // same verdict string the leaderboard row carries (lib/cloud/buildResult)
      verdict,
      // This was hardcoded to gain-green, so a "Still Racing" or a lost run got
      // stamped in the winner's colour on its own share card.
      verdictHex: lost ? PALETTE.loss : hasEscaped(s) ? PALETTE.gain : INK_TIER.mid,
      netWorth: nw,
      netWorthText: currency(nw),
      years: s.escapedOnTurn ?? s.turn,
      yearsLabel: "Turns to escape",
      runId: `cashflow-${s.seed}`,
      // the board keeps no per-turn net-worth series; the card degrades to no sparkline
      history: [] as number[],
      statLabel: "Passive income",
      statValue: `${currency(passive)}/mo`,
      url: shareUrl,
    }),
    [s, nw, passive, shareUrl, verdict, lost],
  );

  useEffect(() => {
    if (lost) {
      audio.setPhase("recapBad", 1.4);
      audio.accent("stampBad");
      return;
    }
    audio.setPhase("recapGood", 1.4);
    audio.accent("stampGood");
    audio.swellWarmth();
  }, [audio, lost]);

  // warm the recap bed by how rich the Money Brain has become
  useEffect(() => {
    audio.setBrainGlow(moneyBrainPct(mastery) / 100);
  }, [mastery, audio]);

  return (
    <div className="mx-auto min-h-[100svh] w-full max-w-2xl px-5 py-14">
      <motion.div variants={container} initial="hidden" animate="show">
        {/* masthead — the win statement, or the receipt for the spiral */}
        <motion.header variants={item} className="border-b border-hairline pb-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="eyebrow text-secondary">{lost ? "Closing Statement" : "Escape Statement"}</p>
            <p className={`eyebrow flex items-center gap-1.5 ${lost ? "text-loss" : "text-gain"}`}>
              {lost ? <><span aria-hidden>▲</span> Run over</> : <><TrophyIcon size={13} /> You won</>}
            </p>
          </div>
          <h1 className={`display-caps mt-3 text-3xl sm:text-5xl ${lost ? "text-loss" : "text-ink"}`}>
            {lost ? "The bank said no" : s.dreamPurchased ? dream.title : "+$50k / month"}
          </h1>
          <p className="voice mt-2 max-w-lg text-[1.05rem] leading-snug text-ink/80">
            {lost
              ? (s.lostReason ?? "Your expenses outran every dollar you could borrow.")
              : s.dreamPurchased
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
          <LedgerRow label="Net worth" strong tone={nw < 0 ? "text-loss" : "text-ink"} value={<AnimatedNumber value={nw} format={(n) => currency(n)} />} />
          {lost ? (
            <>
              <LedgerRow label="Turns survived" size="0.95rem" value={<AnimatedNumber value={s.turn} format={(n) => String(Math.round(n))} />} />
              <LedgerRow label="Peak passive income" tone="text-gain" size="0.95rem" value={<AnimatedNumber value={peakPassive(s)} format={(n) => currency(n)} />} />
              <LedgerRow label="Passive income at the end" size="0.95rem" value={<AnimatedNumber value={passive} format={(n) => currency(n)} />} />
              <LedgerRow label="Monthly expenses at the end" tone="text-loss" size="0.95rem" value={<AnimatedNumber value={totalExpenses(s)} format={(n) => currency(n)} />} />
              <LedgerRow label="Bank loan at the end" tone="text-loss" size="0.95rem" value={<AnimatedNumber value={s.liabilities.bankLoan} format={(n) => currency(n)} />} />
              <LedgerRow label="…which cost you every month" tone="text-loss" size="0.95rem" value={<AnimatedNumber value={bankLoanPayment(s)} format={(n) => currency(n)} />} />
              <LedgerRow label="Interest paid to the bank" tone="text-loss" size="0.95rem" value={<AnimatedNumber value={Math.round(s.interestPaid)} format={(n) => currency(n)} />} />
            </>
          ) : (
            <>
              <LedgerRow label="Passive income" tone="text-gain" size="0.95rem" value={<AnimatedNumber value={passive} format={(n) => currency(n)} />} />
              <LedgerRow label="Escaped on turn" tone="text-gain" size="0.95rem" value={<AnimatedNumber value={s.escapedOnTurn ?? s.turn} format={(n) => String(Math.round(n))} />} />
              <LedgerRow label="Total turns" size="0.95rem" value={<AnimatedNumber value={s.turn} format={(n) => String(Math.round(n))} />} />
            </>
          )}
          <LedgerRow label="Deals bought" size="0.95rem" value={<AnimatedNumber value={s.dealsBought} format={(n) => String(Math.round(n))} />} />
          <LedgerRow label="Quizzes passed" size="0.95rem" value={<AnimatedNumber value={s.quizzesPassed} format={(n) => String(Math.round(n))} />} />
          <LedgerRow label="Started as" size="0.95rem" value={prof.title} />
        </motion.section>

        {/* the lesson — one quiet voice line. Named, because a lose screen that
            doesn't name the concept is just a punishment. */}
        <motion.div variants={item} className="mt-8 border-t border-hairline pt-4">
          {lost ? (
            <>
              <p className="eyebrow text-loss" style={{ fontSize: "0.58rem" }}>
                The concept: the debt spiral
              </p>
              <p className="voice mt-2 text-[1.15rem] leading-snug text-ink">
                Every shortfall became a loan, and every loan charged {currency(bankLoanPayment(s))} a month
                — 10% of the balance, forever. That payment is an expense, so it made the next shortfall
                bigger, which meant a bigger loan. The bank took {currency(Math.round(s.interestPaid))} from you
                on the way down. Interest compounds against you exactly as fast as cash flow compounds for you.
              </p>
              <p className="voice mt-3 text-[1.05rem] leading-snug text-ink/75">
                The way out was never a bigger payday. It was buying something that pays you every month —
                or paying off a debt so the bill stops. Both shrink the gap. Borrowing only widens it.
              </p>
            </>
          ) : (
            <p className="voice text-[1.15rem] leading-snug text-ink">
              Freedom never came from a bigger paycheck — it came from buying assets that pay you whether you work or not. That&apos;s real financial IQ, and it works exactly the same in real life.
            </p>
          )}
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
          <NeonButton variant="secondary" size="lg" onClick={() => setShareOpen(true)}>Share ↗</NeonButton>
          <NeonButton variant="secondary" size="md" onClick={onExit}>← Back to title</NeonButton>
        </motion.div>
      </motion.div>

      {shareOpen && <ShareCard data={shareData} onClose={() => setShareOpen(false)} />}
    </div>
  );
}
