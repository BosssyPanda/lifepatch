"use client";

import { motion } from "framer-motion";
import { CashIcon, ReplayIcon, SkullIcon, TrophyIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/NeonButton";
import { ASSETS } from "@/lib/assets";
import { currency } from "@/lib/format";
import { macroEvent } from "@/lib/markets";
import { netWorth, portfolioValue, type RunState } from "@/lib/runEngine";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } } };
const item = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } };

const REASON: Record<string, { label: string; Icon: typeof TrophyIcon }> = {
  "story-complete": { label: "The story ends", Icon: TrophyIcon },
  retired: { label: "You retired", Icon: TrophyIcon },
  quit: { label: "You walked away", Icon: TrophyIcon },
  died: { label: "Your number came up", Icon: SkullIcon },
};

function finalClass(nw: number, happiness: number, died: boolean): { title: string; blurb: string; hex: string } {
  if (died) return { title: "The Estate", blurb: "You can't take it with you — but you can leave it behind. Here's the ledger you left.", hex: "#a89f8c" };
  if (nw >= 1_000_000) return { title: "Financially Free", blurb: "You won the only game that mattered: options. Work became optional well before the end.", hex: "#7f8b52" };
  if (nw >= 250_000) return { title: "Comfortable", blurb: "Not a yacht, but a real cushion. Boring, correct choices compounded into a soft landing.", hex: "#c9a24a" };
  if (nw > 0 && happiness >= 60) return { title: "Rich Enough", blurb: "Modest numbers, high happiness. You optimized for a life, not a spreadsheet. Valid.", hex: "#d4541e" };
  if (nw > 0) return { title: "Getting By", blurb: "You stayed above water. Next run: kill the debt earlier and let the index do the heavy lifting.", hex: "#c8861e" };
  return { title: "Underwater", blurb: "The math caught up. Debt and bad timing won this round. The good news: you get to run it back.", hex: "#a33218" };
}

function NetWorthArc({ values }: { values: number[] }) {
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 28 - ((v - min) / range) * 26;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const zeroY = 28 - ((0 - min) / range) * 26;
  const up = values[values.length - 1] >= 0;
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-2 h-16 w-full" aria-hidden>
      <line x1="0" y1={zeroY} x2="100" y2={zeroY} stroke="var(--color-ink-dim)" strokeWidth="0.3" strokeDasharray="1 1" opacity="0.5" />
      <polyline points={pts.join(" ")} fill="none" stroke={up ? "#7f8b52" : "#a33218"} strokeWidth="0.8" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function PortfolioBreakdown({ run }: { run: RunState }) {
  const total = portfolioValue(run) + run.cash;
  if (total <= 0) return null;
  const rows = [
    ...ASSETS.map((a) => ({ key: a.id, label: a.short, Icon: a.Icon, value: run.holdings[a.id] ?? 0 })),
    { key: "cash", label: "Cash", Icon: CashIcon, value: run.cash },
  ]
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  return (
    <div className="rounded-[4px] border border-ink/12 bg-bg2 p-4">
      <p className="eyebrow text-ink-dim">Where your money ended up</p>
      <ul className="mt-3 space-y-2">
        {rows.map((r) => {
          const pct = (r.value / total) * 100;
          const Icon = r.Icon;
          return (
            <li key={r.key} className="flex items-center gap-2.5">
              <Icon size={15} className="shrink-0 text-ink-dim" />
              <span className="w-20 shrink-0 truncate font-display text-[0.72rem] font-semibold uppercase tracking-wide text-ink/85">{r.label}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-black/40">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, pct)}%` }} />
              </div>
              <span className="num w-20 shrink-0 text-right text-sm text-ink">{currency(r.value)}</span>
              <span className="num w-9 shrink-0 text-right text-[0.7rem] text-ink-dim">{pct.toFixed(0)}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function LifeReport({ run, onReplay, onTitle, onAlmanac }: { run: RunState; onReplay: () => void; onTitle: () => void; onAlmanac: () => void }) {
  const nw = netWorth(run);
  const reason = REASON[run.endReason ?? "quit"];
  const Icon = reason.Icon;
  const klass = finalClass(nw, run.life.happiness, run.endReason === "died");

  const hist = run.history;
  const firstYear = hist[0]?.year ?? run.startYear;
  const lastYear = hist[hist.length - 1]?.year ?? run.startYear;
  const best = [...hist].sort((a, b) => b.portfolioDelta - a.portfolioDelta)[0];
  const worst = [...hist].sort((a, b) => a.portfolioDelta - b.portfolioDelta)[0];

  const ledger = [
    { label: "Net worth", value: currency(nw) },
    { label: "Debt", value: currency(run.debt) },
    { label: "Final salary", value: `${currency(run.salary)}/yr` },
    { label: "Years lived", value: `${hist.length}` },
  ];

  return (
    <div className="mx-auto flex min-h-[100svh] w-full max-w-2xl flex-col justify-center px-5 py-16">
      <motion.div variants={container} initial="hidden" animate="show">
        <motion.p variants={item} className="flex items-center justify-center gap-2 eyebrow text-accent">
          <Icon size={16} /> {reason.label}
        </motion.p>

        {/* the reveal: the real years you just lived through */}
        <motion.p variants={item} className="mt-4 text-center font-serif text-lg italic text-ink-dim">
          You lived from <span className="text-ink">{firstYear}</span> to <span className="text-ink">{lastYear}</span> — age {run.history[0]?.age ?? run.age} to {run.age}.
        </motion.p>

        <motion.div variants={item} className="mt-6 text-center">
          <div className="mx-auto inline-block rounded-[4px] border-2 px-6 py-3" style={{ borderColor: klass.hex, color: klass.hex }}>
            <p className="eyebrow" style={{ opacity: 0.7 }}>Final verdict · {run.name}</p>
            <p className="display-caps text-4xl sm:text-5xl">{klass.title}</p>
          </div>
          <p className="mx-auto mt-4 max-w-md font-serif text-base italic leading-relaxed text-ink/80">{klass.blurb}</p>
        </motion.div>

        <motion.dl variants={item} className="mt-8 grid grid-cols-2 gap-3">
          {ledger.map((r) => (
            <div key={r.label} className="rounded-[4px] border border-ink/12 bg-bg2 px-4 py-3">
              <p className="eyebrow text-ink-dim">{r.label}</p>
              <p className="num text-2xl text-ink">{r.value}</p>
            </div>
          ))}
        </motion.dl>

        {/* net-worth arc */}
        {hist.length > 1 && (
          <motion.div variants={item} className="mt-3 rounded-[4px] border border-ink/12 bg-bg2 p-4">
            <p className="eyebrow text-ink-dim">Net worth, year by year</p>
            <NetWorthArc values={hist.map((h) => h.netWorth)} />
          </motion.div>
        )}

        {/* final portfolio — BuildYourStax style */}
        <motion.div variants={item} className="mt-3">
          <PortfolioBreakdown run={run} />
        </motion.div>

        {/* named-event reveal */}
        {best && worst && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <motion.div variants={item} className="rounded-[4px] border-l-2 border-olive bg-bg2 p-4">
              <p className="eyebrow text-olive">Best year · {best.year}</p>
              <p className="num text-lg text-olive">+{currency(Math.max(0, best.portfolioDelta))}</p>
              <p className="mt-1 font-serif text-xs italic text-ink-dim">{macroEvent(best.year)?.title ?? "A quiet, green year."}</p>
            </motion.div>
            <motion.div variants={item} className="rounded-[4px] border-l-2 border-brick bg-bg2 p-4">
              <p className="eyebrow text-brick">Worst year · {worst.year}</p>
              <p className="num text-lg text-brick">−{currency(Math.abs(Math.min(0, worst.portfolioDelta)))}</p>
              <p className="mt-1 font-serif text-xs italic text-ink-dim">{macroEvent(worst.year)?.title ?? "The market just shrugged."}</p>
            </motion.div>
          </div>
        )}

        <motion.p variants={item} className="mt-5 text-center font-serif text-sm text-ink-dim">
          {run.life.partner ? "Married" : "Single"} · {run.life.kids} kid{run.life.kids === 1 ? "" : "s"} · {run.life.housing === "owned" ? "homeowner" : "renter"} · {run.job}
        </motion.p>

        <motion.div variants={item} className="mt-8 flex flex-wrap justify-center gap-3">
          <NeonButton variant="ghost" size="md" onClick={onTitle}>Title screen</NeonButton>
          <NeonButton variant="secondary" size="md" onClick={onAlmanac}>Almanac</NeonButton>
          <NeonButton variant="primary" size="lg" onClick={onReplay}>
            <ReplayIcon size={18} /> Run it back
          </NeonButton>
        </motion.div>
      </motion.div>
    </div>
  );
}
