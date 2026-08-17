"use client";

import { motion } from "framer-motion";
import { NeonButton } from "@/components/ui/LedgerButton";
import { currency } from "@/lib/format";
import type { RunState, YearRecord } from "@/lib/runEngine";
import type { deriveVerdict } from "@/lib/verdict";
import { DUR, EASE, STAGGER } from "@/src/motion/tokens";
import { NumberTicker } from "@/components/cinematic/landing/NumberTicker";
import { SplitFlap } from "../SplitFlap";
import { NetWorthDraw } from "./NetWorthDraw";

/** The receipt's statement rows — same data as the pre-film outro. */
function receiptRows(run: RunState, nw: number, worst: YearRecord | undefined, hist: YearRecord[]) {
  return [
    { label: "Net worth", value: currency(nw), strong: true, tone: nw >= 0 ? ("gain" as const) : ("loss" as const) },
    { label: "Final salary", value: `${currency(run.salary)}/yr`, tone: undefined, strong: false },
    { label: "Debt", value: currency(run.debt), tone: run.debt > 0 ? ("loss" as const) : undefined, strong: false },
    { label: "Biggest single hit", value: worst ? `−${currency(Math.abs(Math.min(0, worst.portfolioDelta)))}` : "—", tone: "loss" as const, strong: false },
    { label: "Months survived", value: `${hist.length * 12}`, tone: undefined, strong: false },
  ];
}

/**
 * The settled receipt — the film's terminal frame and the original pre-film outro.
 * `AnimatePresence` in Outro keys this element as "receipt"; the root motion.div below
 * is what it tracks, so the enter transition stays where it was.
 */
export function ReceiptScene({
  run,
  nw,
  worst,
  hist,
  nwSeries,
  verdict,
  reduced,
  firstYear,
  lastYear,
  onFinish,
}: {
  run: RunState;
  nw: number;
  worst: YearRecord | undefined;
  hist: YearRecord[];
  nwSeries: number[];
  verdict: ReturnType<typeof deriveVerdict>;
  reduced: boolean;
  firstYear: number;
  lastYear: number;
  onFinish: () => void;
}) {
  return (
    <motion.div
      initial={reduced ? false : { scale: 1.045, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: DUR.slow, ease: EASE }}
      className="relative flex min-h-[100svh] w-full flex-col px-5 py-10 sm:px-10"
    >
      {/* top rail */}
      <div className="flex items-center justify-between border-b border-hairline pb-3">
        <div className="flex items-center gap-2.5">
          <span className="eyebrow text-loss" style={{ letterSpacing: "0.24em" }}>● Run Closed</span>
          <span className="eyebrow text-secondary" style={{ fontSize: "0.55rem" }}>{firstYear}–{lastYear}</span>
        </div>
        <span className="num text-secondary" style={{ fontSize: "0.7rem" }}>STATEMENT NO. {run.mode}-{run.seed}</span>
      </div>

      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center py-8">
        <p className="display-caps text-2xl text-ink sm:text-3xl">The life of {run.name}</p>

        {/* statement rows print in on settle */}
        <motion.div
          className="mt-6"
          variants={{ show: { transition: { staggerChildren: reduced ? 0 : STAGGER.loose } } }}
          initial={reduced ? "show" : "hide"}
          animate="show"
        >
          {receiptRows(run, nw, worst, hist).map((r) => (
            <motion.div
              key={r.label}
              variants={{ hide: { opacity: 0, clipPath: "inset(0 0 100% 0)" }, show: { opacity: 1, clipPath: "inset(0 0 0% 0)" } }}
              transition={{ duration: DUR.fast, ease: EASE }}
              className={`flex items-baseline gap-2.5 py-1.5 ${r.strong ? "border-b border-hairline" : ""}`}
            >
              <span className={r.strong ? "display-caps text-[0.82rem] text-ink" : "text-[0.84rem] text-ink/80"}>{r.label}</span>
              <span className="rule-dotted h-px flex-1" />
              <span
                className={`num ${r.strong ? "text-[1.15rem] font-bold" : "text-[0.92rem]"}`}
                style={{ color: r.tone === "gain" ? "var(--color-gain)" : r.tone === "loss" ? "var(--color-loss)" : "var(--color-ink)" }}
              >
                {r.value}
              </span>
            </motion.div>
          ))}
        </motion.div>

        {/* net-worth sparkline */}
        {nwSeries.length > 1 && (
          <div className="mt-6">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="eyebrow text-secondary" style={{ fontSize: "0.55rem" }}>Net worth · year by year</span>
              <span className="rule-dotted h-px flex-1" />
            </div>
            <div className="border border-hairline bg-bg2 p-3">
              <NetWorthDraw values={nwSeries} draw reduced={reduced} />
            </div>
          </div>
        )}

        {/* verdict — already flipped in scene 5; rest instantly here */}
        <div className="mt-8 flex flex-col items-start">
          <span className="eyebrow text-secondary" style={{ fontSize: "0.56rem" }}>Final verdict</span>
          <div className="mt-2">
            <SplitFlap text={verdict.title} hex={verdict.hex} active reduced className="text-4xl sm:text-6xl" />
          </div>
          {hist.length > 0 && (
            <p className="num mt-3 text-[0.7rem] text-secondary" style={{ letterSpacing: "0.18em" }}>
              YEARS LIVED — <NumberTicker value={hist.length} durationMs={reduced ? 0 : 700} className="text-ink" />
            </p>
          )}
        </div>

        {/* serif-italic voice line + continue */}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.slow, ease: EASE, delay: reduced ? 0 : 0.4 }}
          className="mt-6"
        >
          <p className="voice max-w-md text-[1.06rem] leading-snug text-ink/85">{verdict.blurb}</p>
          <NeonButton variant="primary" size="lg" className="mt-6" onClick={onFinish}>See the full report →</NeonButton>
        </motion.div>
      </div>
    </motion.div>
  );
}
