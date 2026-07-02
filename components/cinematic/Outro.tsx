"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { NeonButton } from "@/components/ui/NeonButton";
import { useAudio } from "@/hooks/useAudio";
import { currency } from "@/lib/format";
import { netWorth, type RunState } from "@/lib/runEngine";
import { deriveVerdict } from "@/lib/verdict";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { useSkippable } from "@/src/motion/useSkippable";
import { DUR, EASE, STAGGER } from "@/src/motion/tokens";
import { buzz, BUZZ } from "@/src/motion/haptics";
import { MuteButton, SkipButton } from "./Controls";
import { MoneyFall } from "./MoneyFall";
import { VerdictStamp } from "./VerdictStamp";
import { SplitFlap } from "./SplitFlap";

type VerdictKind = "stamp" | "flap";
function useVerdictKind(): VerdictKind {
  // ?verdict=flap|stamp overrides the default so both A/B reveals can be captured.
  const [kind, setKind] = useState<VerdictKind>("stamp");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("verdict");
    if (q === "flap" || q === "stamp") setKind(q);
  }, []);
  return kind;
}

/**
 * Run-end verdict ceremony — Spectacle S2 (Addendum A §7.1). One skippable sequence:
 * RUN CLOSED kicker → the final statement prints row-by-row (dot leaders) → the
 * net-worth sparkline draws left-to-right → the verdict word resolves (stamp OR
 * split-flap, A/B via ?verdict=) → a serif-italic voice line. Reduced motion renders
 * the final frame; any input skips to it. All data from RunState / deriveVerdict.
 */
export function Outro({ run, onDone }: { run: RunState; onDone: () => void }) {
  const audio = useAudio();
  const { reduced } = useMotionCtx();
  const verdictKind = useVerdictKind();

  const verdict = deriveVerdict(run);
  const nw = netWorth(run);
  const hist = run.history;
  const firstYear = hist[0]?.year ?? run.startYear;
  const lastYear = hist[hist.length - 1]?.year ?? run.startYear;
  const worst = [...hist].sort((a, b) => a.portfolioDelta - b.portfolioDelta)[0];
  const nwSeries = hist.map((h) => h.netWorth);

  const rows: { label: string; value: string; tone?: "gain" | "loss"; strong?: boolean }[] = [
    { label: "Net worth", value: currency(nw), strong: true, tone: nw >= 0 ? "gain" : "loss" },
    { label: "Final salary", value: `${currency(run.salary)}/yr` },
    { label: "Debt", value: currency(run.debt), tone: run.debt > 0 ? "loss" : undefined },
    { label: "Biggest single hit", value: worst ? `−${currency(Math.abs(Math.min(0, worst.portfolioDelta)))}` : "—", tone: "loss" },
    { label: "Months survived", value: `${hist.length * 12}` },
  ];

  const [step, setStep] = useState(reduced ? 5 : 0);
  const [settled, setSettled] = useState(reduced);
  // money-fall fires ONLY from the natural timeline (never on skip / reduced)
  const [fall, setFall] = useState(false);
  const timers = useRef<number[]>([]);
  const startedRef = useRef(false);
  const doneRef = useRef(false);

  // crossfade the running score into the verdict-keyed recap preset
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const preset = verdict.good ? "recapGood" : "recapBad";
    audio.unlock(preset);
    audio.setPhase(preset);
    audio.ambience(null);
  }, [audio, verdict.good]);

  // choreographed timeline
  useEffect(() => {
    if (reduced) { setSettled(true); return; }
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    at(250, () => { setStep(1); try { audio.accent("thump"); } catch {} }); // RUN CLOSED
    at(850, () => { setStep(2); try { audio.accent("rise"); } catch {} }); // statement prints
    at(2150, () => { setStep(3); try { audio.accent("rise"); } catch {} }); // sparkline draws
    at(3150, () => {
      setStep(4); // verdict resolves
      try { audio.accent(verdict.good ? "stampGood" : "stampBad"); } catch {}
      buzz(BUZZ.verdict, audio.muted);
      if (verdict.good) {
        audio.swellWarmth();
        setFall(true); // §13 #5 — one shower of flat ink bills on a good verdict
      }
    });
    at(3900, () => setStep(5)); // voice + continue
    at(4300, () => setSettled(true));
    return () => { timers.current.forEach(clearTimeout); timers.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const skipToEnd = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setStep(5);
    setSettled(true);
  }, []);

  // global input-skip: any tap/key jumps the ceremony to its final frame
  useSkippable(!settled, skipToEnd);

  const finish = useCallback(() => {
    timers.current.forEach(clearTimeout);
    if (!doneRef.current) { doneRef.current = true; onDone(); }
  }, [onDone]);

  const showKicker = reduced || step >= 1;
  const showRows = reduced || step >= 2;
  const drawSpark = reduced || step >= 3;
  const showVerdict = reduced || step >= 4;
  const showVoice = reduced || step >= 5;

  return (
    <div className="relative flex min-h-[100svh] w-full flex-col bg-bg px-5 py-10 text-ink sm:px-10">
      {/* top rail */}
      <div className="flex items-center justify-between border-b border-hairline pb-3">
        <div className="flex items-center gap-2.5">
          <motion.span
            initial={reduced ? false : { opacity: 0, x: -6 }}
            animate={showKicker ? { opacity: 1, x: 0 } : { opacity: 0, x: -6 }}
            transition={{ duration: DUR.base, ease: EASE }}
            className="eyebrow text-loss"
            style={{ letterSpacing: "0.24em" }}
          >
            ● Run Closed
          </motion.span>
          <span className="eyebrow text-secondary" style={{ fontSize: "0.55rem" }}>{firstYear}–{lastYear}</span>
        </div>
        <span className="num text-secondary" style={{ fontSize: "0.7rem" }}>STATEMENT NO. {run.mode}-{run.seed}</span>
      </div>

      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center py-8">
        {/* the life headline */}
        <motion.p
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={showKicker ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
          transition={{ duration: DUR.slow, ease: EASE }}
          className="display-caps text-2xl text-ink sm:text-3xl"
        >
          The life of {run.name}
        </motion.p>

        {/* statement rows print in */}
        <motion.div
          className="mt-6"
          variants={{ show: { transition: { staggerChildren: reduced ? 0 : STAGGER.loose, delayChildren: 0 } } }}
          initial="hide"
          animate={showRows ? "show" : "hide"}
        >
          {rows.map((r) => (
            <motion.div
              key={r.label}
              variants={{ hide: reduced ? { opacity: 1 } : { opacity: 0, clipPath: "inset(0 0 100% 0)" }, show: { opacity: 1, clipPath: "inset(0 0 0% 0)" } }}
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

        {/* net-worth sparkline draws left-to-right */}
        {nwSeries.length > 1 && (
          <div className="mt-6">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="eyebrow text-secondary" style={{ fontSize: "0.55rem" }}>Net worth · year by year</span>
              <span className="rule-dotted h-px flex-1" />
            </div>
            <div className="border border-hairline bg-bg2 p-3">
              <NetWorthDraw values={nwSeries} draw={drawSpark} reduced={reduced} />
            </div>
          </div>
        )}

        {/* verdict resolves — stamp OR split-flap */}
        <div className="mt-8 flex min-h-[5.5rem] flex-col items-start">
          {verdictKind === "flap" && (
            <span className="eyebrow text-secondary" style={{ fontSize: "0.56rem", opacity: showVerdict ? 1 : 0 }}>Final verdict</span>
          )}
          <div className="mt-2">
            {verdictKind === "flap" ? (
              <SplitFlap text={verdict.title} hex={verdict.hex} active={showVerdict} reduced={reduced} className="text-4xl sm:text-6xl" />
            ) : (
              (showVerdict) && <VerdictStamp title={verdict.title} hex={verdict.hex} />
            )}
          </div>
        </div>

        {/* serif-italic voice line + continue */}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={showVoice ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
          transition={{ duration: DUR.slow, ease: EASE }}
          className="mt-6"
        >
          <p className="voice max-w-md text-[1.06rem] leading-snug text-ink/85">{verdict.blurb}</p>
          <NeonButton variant="primary" size="lg" className="mt-6" onClick={finish}>See the full report →</NeonButton>
        </motion.div>
      </div>

      {fall && <MoneyFall />}

      <div className="absolute right-4 top-4 z-20"><MuteButton muted={audio.muted} onToggle={() => audio.setMuted(!audio.muted)} /></div>
      <div className="absolute bottom-6 right-4 z-20"><SkipButton onSkip={finish} /></div>
    </div>
  );
}

/** Net-worth line that draws left-to-right (SVG pathLength), flat red/green with a zero baseline. */
function NetWorthDraw({ values, draw, reduced }: { values: number[]; draw: boolean; reduced: boolean }) {
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 28 - ((v - min) / range) * 26;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const zeroY = 28 - ((0 - min) / range) * 26;
  const up = values[values.length - 1] >= (values[0] ?? 0);
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-16 w-full" aria-hidden>
      <line x1="0" y1={zeroY} x2="100" y2={zeroY} stroke="var(--color-ink-dim)" strokeWidth="0.3" strokeDasharray="1 1" opacity="0.5" />
      <motion.polyline
        points={pts.join(" ")}
        fill="none"
        stroke={up ? "#2bd576" : "#ff3b30"}
        strokeWidth="0.9"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        initial={reduced ? false : { pathLength: 0 }}
        animate={draw ? { pathLength: 1 } : { pathLength: reduced ? 1 : 0 }}
        transition={{ duration: reduced ? 0 : 0.9, ease: EASE }}
      />
    </svg>
  );
}
