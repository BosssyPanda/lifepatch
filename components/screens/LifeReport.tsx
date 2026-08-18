"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { AnnotatedLifeChart } from "@/components/share/AnnotatedLifeChart";
import { ShareCard } from "@/components/share/ShareCard";
import { useShareUrl } from "@/components/share/useShareUrl";
import { ApartmentIcon, BrainIcon, CashIcon, DebtIcon, ReplayIcon, SkullIcon, TrophyIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/LedgerButton";
import { LedgerRow, SectionLabel } from "@/components/ui/report";
import { MoneyBrainMeter, moneyBrainPct } from "@/components/learn/MoneyBrainMeter";
import { useAudio } from "@/hooks/useAudio";
import { useProfile } from "@/hooks/useProfile";
import { useConceptLearn } from "@/hooks/useConceptLearn";
import { conceptTitle } from "@/lib/concepts";
import { ASSETS } from "@/lib/assets";
import { currency } from "@/lib/format";
import { macroEvent } from "@/lib/markets";
import { homeEquity, netWorth, type RunState } from "@/lib/runEngine";
import { deriveVerdict } from "@/lib/verdict";
import { STAGGER } from "@/src/motion/tokens";

const container = { hidden: {}, show: { transition: { staggerChildren: STAGGER.list, delayChildren: STAGGER.loose } } };
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };

const REASON: Record<string, { label: string; Icon: typeof TrophyIcon }> = {
  "story-complete": { label: "The story ends", Icon: TrophyIcon },
  retired: { label: "You retired", Icon: TrophyIcon },
  quit: { label: "You walked away", Icon: TrophyIcon },
  died: { label: "Your number came up", Icon: SkullIcon },
};

/**
 * Where the money ended up — assets AND what is owed against them.
 *
 * The shares used to divide by the listed assets alone, so a player holding
 * $10k of cash against $2M of debt read "Cash — 100%" and a full bar. Percentages
 * are of GROSS assets, and the liabilities are printed underneath as their own
 * share of that same base: owing more than you own shows as a bar past 100%,
 * because that is what it is. The closing line is the number that actually counts.
 */
function PortfolioBreakdown({ run }: { run: RunState }) {
  const assetRows = [
    ...ASSETS.map((a) => ({ key: a.id, label: a.short, Icon: a.Icon, value: run.holdings[a.id] ?? 0 })),
    { key: "cash", label: "Cash", Icon: CashIcon, value: run.cash },
    { key: "home", label: "Home", Icon: ApartmentIcon, value: run.homeValue },
  ]
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  const gross = assetRows.reduce((t, r) => t + r.value, 0);
  const owed = run.debt + run.mortgage;
  const nw = netWorth(run);

  // The header above is the question, so the panel always answers it — even with nothing left.
  if (assetRows.length === 0 && owed === 0) {
    return (
      <div className="border border-hairline bg-bg2 p-4">
        <LedgerRow label="Nothing left" value={currency(0)} />
      </div>
    );
  }

  const liabilities = [
    { key: "mortgage", label: "Mortgage", value: run.mortgage },
    { key: "debt", label: "Debt", value: run.debt },
  ].filter((r) => r.value > 0);

  // With no assets at all, a share of gross is a divide-by-zero; show the bar full instead.
  const share = (v: number) => (gross > 0 ? (v / gross) * 100 : 100);

  return (
    <div className="border border-hairline bg-bg2 p-4">
      <ul className="space-y-2">
        {assetRows.map((r) => {
          const pct = share(r.value);
          const Icon = r.Icon;
          return (
            <li key={r.key} className="flex items-center gap-2.5">
              <Icon size={15} className="shrink-0 text-secondary" />
              <span className="w-20 shrink-0 truncate font-mono text-[0.72rem] font-semibold uppercase tracking-wide text-ink/85">{r.label}</span>
              <div className="h-2 flex-1 overflow-hidden bg-hairline">
                <div className="h-full bg-ink" style={{ width: `${Math.max(2, pct)}%` }} />
              </div>
              <span className="num w-20 shrink-0 text-right text-sm text-ink">{currency(r.value)}</span>
              <span className="num w-9 shrink-0 text-right text-[0.7rem] text-secondary">{pct.toFixed(0)}%</span>
            </li>
          );
        })}
      </ul>

      {liabilities.length > 0 && (
        <ul className="mt-3 space-y-2 border-t border-hairline pt-3">
          {liabilities.map((r) => {
            const pct = share(r.value);
            return (
              <li key={r.key} className="flex items-center gap-2.5">
                <DebtIcon size={15} className="shrink-0 text-loss" />
                <span className="w-20 shrink-0 truncate font-mono text-[0.72rem] font-semibold uppercase tracking-wide text-loss">{r.label}</span>
                <div className="h-2 flex-1 overflow-hidden bg-hairline">
                  <div className="h-full bg-loss" style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
                </div>
                <span className="num w-20 shrink-0 text-right text-sm text-loss">−{currency(r.value)}</span>
                <span className="num w-9 shrink-0 text-right text-[0.7rem] text-loss">{pct.toFixed(0)}%</span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 border-t border-hairline pt-3">
        <LedgerRow label="Net worth" value={currency(nw)} strong />
      </div>
    </div>
  );
}

export function LifeReport({ run, onReplay, onTitle, onAlmanac, onMasteryMap }: { run: RunState; onReplay: () => void; onTitle: () => void; onAlmanac: () => void; onMasteryMap: () => void }) {
  const { mastery } = useProfile();
  const { runGains } = useConceptLearn();
  const { setBrainGlow } = useAudio();
  const [shareOpen, setShareOpen] = useState(false);
  const shareUrl = useShareUrl(run);
  const nw = netWorth(run);

  // warm the calm report bed by how rich the Money Brain has become
  useEffect(() => {
    setBrainGlow(moneyBrainPct(mastery) / 100);
  }, [mastery, setBrainGlow]);

  // The statement owns the screen. A concept chip fired by the run's last event was still
  // in the queue when the recap settled, and the toast is anchored at top-24 to clear the
  // in-run HUD — which this screen does not have, so it landed squarely on the masthead and
  // covered the player's name. It is redundant here anyway: the report prints every concept
  // the run sharpened, a few sections down.
  useEffect(() => {
    document.body.dataset.statement = "1";
    return () => { delete document.body.dataset.statement; };
  }, []);
  const reason = REASON[run.endReason ?? "quit"];
  const Icon = reason.Icon;
  const klass = deriveVerdict(run);

  const hist = run.history;
  const firstYear = hist[0]?.year ?? run.startYear;
  const lastYear = hist[hist.length - 1]?.year ?? run.startYear;
  const best = [...hist].sort((a, b) => b.portfolioDelta - a.portfolioDelta)[0];
  const worst = [...hist].sort((a, b) => a.portfolioDelta - b.portfolioDelta)[0];
  // A run whose worst year still finished green has no "hit" — clamping it to zero
  // printed "−$0" in loss red, which is both wrong and unearned drama.
  const tookAHit = !!worst && worst.portfolioDelta < 0;
  const bestUp = !!best && best.portfolioDelta > 0;

  // Rebuilt every render, this redrew ShareCard's whole 1080×1920 canvas on every
  // parent tick — and this screen has running counters.
  const shareData = useMemo(
    () => ({
      verdict: klass.title,
      verdictHex: klass.hex,
      netWorth: nw,
      netWorthText: currency(nw),
      years: hist.length,
      runId: `${run.mode}-${run.seed}`,
      history: hist.map((h) => h.netWorth),
      statLabel: "Biggest hit",
      statValue: tookAHit ? `−${currency(Math.abs(worst.portfolioDelta))}` : "None",
      url: shareUrl,
    }),
    [klass.title, klass.hex, nw, hist, run.mode, run.seed, tookAHit, worst, shareUrl],
  );

  const ledger = [
    { label: "Net worth", value: currency(nw) },
    ...(run.homeValue > 0 ? [{ label: "Home equity", value: currency(homeEquity(run)) }] : []),
    ...(run.mortgage > 0 ? [{ label: "Mortgage", value: currency(run.mortgage) }] : []),
    { label: "Debt", value: currency(run.debt) },
    { label: "Final salary", value: `${currency(run.salary)}/yr` },
    { label: "Years lived", value: `${hist.length}` },
  ];

  return (
    <div className="mx-auto min-h-[100svh] w-full max-w-2xl px-5 py-16">
      <motion.div variants={container} initial="hidden" animate="show">
        {/* masthead — the statement header */}
        <motion.header variants={item} className="border-b border-hairline pb-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="eyebrow text-secondary">Life Statement</p>
            <p className="eyebrow flex items-center gap-1.5 text-secondary">
              <Icon size={13} /> {reason.label}
            </p>
          </div>
          <h1 className="display-caps mt-3 text-3xl text-ink sm:text-4xl">{run.name}</h1>
          <p className="num mt-1.5 text-[0.8rem] text-secondary">
            {firstYear}–{lastYear} · age {run.history[0]?.age ?? run.age}–{run.age} · {run.job}
          </p>
        </motion.header>

        {/* verdict — a left-aligned ink stamp, blurb as a voice line */}
        <motion.div variants={item} className="mt-6">
          <div className="inline-block border-2 px-5 py-2.5" style={{ borderColor: klass.hex, color: klass.hex }}>
            <p className="eyebrow" style={{ fontSize: "0.56rem" }}>Final verdict</p>
            <p className="display-caps text-3xl sm:text-4xl">{klass.title}</p>
          </div>
          <p className="voice mt-3 max-w-lg text-[1.05rem] leading-snug text-ink/80">{klass.blurb}</p>
        </motion.div>

        {/* statement — dot-leader ledger rows */}
        <motion.section variants={item}>
          <SectionLabel>Statement</SectionLabel>
          {ledger.map((r, i) => (
            <LedgerRow key={r.label} label={r.label} value={r.value} strong={i === 0} />
          ))}
        </motion.section>

        {/* annotated net-worth line — best/worst swings + the macro events crossed */}
        {hist.length > 1 && (
          <motion.div variants={item}>
            <SectionLabel>Net worth, year by year</SectionLabel>
            <AnnotatedLifeChart points={hist.map((h) => ({ year: h.year, netWorth: h.netWorth }))} />
          </motion.div>
        )}

        {/* final portfolio */}
        <motion.div variants={item}>
          <SectionLabel>Where your money ended up</SectionLabel>
          <PortfolioBreakdown run={run} />
        </motion.div>

        {/* best / worst — named market years */}
        {best && worst && (
          <motion.div variants={item} className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className={`border border-hairline border-l-2 bg-bg2 p-4 ${bestUp ? "border-l-gain" : "border-l-hairline-strong"}`}>
              <p className={`eyebrow ${bestUp ? "text-gain" : "text-secondary"}`}>Best year · {best.year}</p>
              <p className={`num text-lg ${bestUp ? "text-gain" : "text-loss"}`}>
                {bestUp ? `+${currency(best.portfolioDelta)}` : `−${currency(Math.abs(best.portfolioDelta))}`}
              </p>
              <p className="voice mt-1 text-[0.92rem] text-secondary">
                {bestUp ? macroEvent(best.year)?.title ?? "A quiet, green year." : "Even your best year lost money."}
              </p>
            </div>
            <div className={`border border-hairline border-l-2 bg-bg2 p-4 ${tookAHit ? "border-l-loss" : "border-l-hairline-strong"}`}>
              <p className={`eyebrow ${tookAHit ? "text-loss" : "text-secondary"}`}>Worst year · {worst.year}</p>
              <p className={`num text-lg ${tookAHit ? "text-loss" : "text-gain"}`}>
                {tookAHit ? `−${currency(Math.abs(worst.portfolioDelta))}` : `+${currency(worst.portfolioDelta)}`}
              </p>
              <p className="voice mt-1 text-[0.92rem] text-secondary">
                {tookAHit ? macroEvent(worst.year)?.title ?? "The market just shrugged." : "You never had a down year."}
              </p>
            </div>
          </motion.div>
        )}

        <motion.p variants={item} className="num mt-6 text-[0.75rem] text-secondary">
          {run.life.partner ? "Married" : "Single"} · {run.life.kids} kid{run.life.kids === 1 ? "" : "s"} · {run.life.housing === "owned" ? "homeowner" : "renter"} · {run.job}
        </motion.p>

        {/* money brain */}
        <motion.div variants={item} className="mt-6 border border-hairline bg-bg2 px-4 py-4 text-ink">
          <MoneyBrainMeter mastery={mastery} />
          {runGains.length > 0 && (
            <p className="mt-2 font-body text-[0.9rem] text-secondary">
              This run sharpened: <span className="text-ink">{runGains.map(conceptTitle).join(", ")}</span>.
            </p>
          )}
          <button type="button" onClick={onMasteryMap} className="eyebrow mt-3 inline-flex items-center gap-1.5 text-ink transition-opacity hover:opacity-70">
            <BrainIcon size={13} /> View your Money Brain →
          </button>
        </motion.div>

        {/* actions */}
        <motion.div variants={item} className="mt-8 flex flex-wrap gap-3 border-t border-hairline pt-6">
          <NeonButton variant="primary" size="lg" onClick={onReplay}>
            <ReplayIcon size={18} /> Run it back
          </NeonButton>
          <NeonButton variant="secondary" size="lg" onClick={() => setShareOpen(true)}>Share ↗</NeonButton>
          <NeonButton variant="secondary" size="md" onClick={onAlmanac}>Almanac</NeonButton>
          <NeonButton variant="ghost" size="md" onClick={onTitle}>Title screen</NeonButton>
        </motion.div>
      </motion.div>

      {shareOpen && <ShareCard data={shareData} onClose={() => setShareOpen(false)} />}
    </div>
  );
}
