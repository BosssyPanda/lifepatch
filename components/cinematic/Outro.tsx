"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NeonButton } from "@/components/ui/NeonButton";
import { useAudio } from "@/hooks/useAudio";
import { currency } from "@/lib/format";
import { macroEvent, sp500Return } from "@/lib/markets";
import { netWorth, type RunState, type YearRecord } from "@/lib/runEngine";
import { deriveVerdict } from "@/lib/verdict";
import { RECAP_SCENES, YEARS_FLIP_MS, YEARS_HOLD_MS, YEARS_MIN_MS } from "@/lib/cinematic";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { useSkippable } from "@/src/motion/useSkippable";
import { DUR, EASE, STAGGER } from "@/src/motion/tokens";
import { buzz, BUZZ } from "@/src/motion/haptics";
import { NumberTicker } from "@/components/cinematic/landing/NumberTicker";
import { MuteButton, SkipButton } from "./Controls";
import { MoneyFall } from "./MoneyFall";
import { SplitFlap } from "./SplitFlap";
import { AshFall } from "./film/AshFall";
import { FilmLayer } from "./film/FilmLayer";
import { YearFlap } from "./film/YearFlap";

/**
 * Run-end recap film (CINEMA Phase Q). Five skippable scenes that SETTLE into
 * the original receipt: RUN CLOSED slam → THE YEARS (digit-flap replay, pauses
 * on milestones) → THE WIN / THE HIT (symmetric — best or worst year plate) →
 * THE LINE (net worth full-bleed) → VERDICT (giant split-flap) → receipt.
 * Reduced motion goes straight to the settled receipt; any input skips there
 * (useSkippable). All data from run.history / deriveVerdict / macroEvent —
 * nothing invented. Film vocabulary (grain/flash/shake/ash) per DESIGN.md
 * § Film Exception; falls fire only from the natural timeline.
 */

type Scene = "closed" | "years" | "swing" | "line" | "verdict" | "receipt";

const sceneMs = (kind: string) => RECAP_SCENES.find((s) => s.kind === kind)?.ms ?? 3000;

/** Scene-2 runtime: per-year flips + milestone holds, floored and capped. */
function yearsSceneMs(hist: YearRecord[], milestones: Map<number, string>): number {
  const raw = hist.reduce((t, h) => t + (milestones.has(h.year) ? YEARS_HOLD_MS + YEARS_FLIP_MS : YEARS_FLIP_MS), 0);
  return Math.max(YEARS_MIN_MS, Math.min(sceneMs("years"), raw));
}

export function Outro({ run, onDone }: { run: RunState; onDone: () => void }) {
  const audio = useAudio();
  const { reduced } = useMotionCtx();

  const verdict = deriveVerdict(run);
  const nw = netWorth(run);
  const hist = run.history;
  const firstYear = hist[0]?.year ?? run.startYear;
  const lastYear = hist[hist.length - 1]?.year ?? run.startYear;
  const worst = [...hist].sort((a, b) => a.portfolioDelta - b.portfolioDelta)[0];
  const best = [...hist].sort((a, b) => b.portfolioDelta - a.portfolioDelta)[0];
  const nwSeries = hist.map((h) => h.netWorth);

  // THE WIN / THE HIT — symmetric (director's pick): whichever swing is bigger.
  // Runs whose portfolio never moved (all deltas 0 — e.g. an early quit) get no
  // swing scene: "THE WIN +$0" over a broke receipt reads absurd.
  const isWin = best && worst ? Math.abs(best.portfolioDelta) >= Math.abs(worst.portfolioDelta) : true;
  const swingMag = Math.max(Math.abs(best?.portfolioDelta ?? 0), Math.abs(worst?.portfolioDelta ?? 0));
  const swing = swingMag > 0 ? (isWin ? best : worst) : undefined;

  // Milestone years: best/worst swings + top-3 real macro events in lived years
  // (same selection the AnnotatedLifeChart uses).
  const milestones = useMemo(() => {
    const map = new Map<number, string>();
    if (best && best.portfolioDelta > 0) map.set(best.year, `BEST YEAR — +${currency(best.portfolioDelta)}`);
    if (worst && worst.portfolioDelta < 0) map.set(worst.year, `WORST YEAR — −${currency(Math.abs(worst.portfolioDelta))}`);
    const macro = hist
      .filter((h) => macroEvent(h.year))
      .sort((a, b) => Math.abs(sp500Return(b.year)) - Math.abs(sp500Return(a.year)))
      .slice(0, 3);
    for (const m of macro) if (!map.has(m.year)) map.set(m.year, macroEvent(m.year)!.title.toUpperCase());
    return map;
    // derived purely from hist — stable per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const yearsMs = hist.length > 0 ? yearsSceneMs(hist, milestones) : 0;

  const [scene, setScene] = useState<Scene>(reduced ? "receipt" : "closed");
  const settled = scene === "receipt";
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

  // the film's timeline — scene transitions + per-scene audio cues
  useEffect(() => {
    if (reduced) return;
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    type Step = { kind: Scene; ms: number; enter?: () => void };
    const steps: Step[] = [{
      kind: "closed", ms: sceneMs("closed"),
      enter: () => { try { audio.accent("thump"); } catch {} },
    }];
    if (hist.length > 0) steps.push({
      kind: "years", ms: yearsMs,
      enter: () => { try { audio.accent("rise"); } catch {} },
    });
    if (swing) steps.push({
      kind: "swing", ms: sceneMs("swing"),
      enter: () => {
        try { audio.accent(isWin ? "stampGood" : "stampBad"); } catch {}
        buzz(BUZZ.verdict, audio.muted);
        if (isWin) audio.swellWarmth();
      },
    });
    if (nwSeries.length > 1) steps.push({
      kind: "line", ms: sceneMs("line"),
      enter: () => { try { audio.accent("rise"); } catch {} },
    });
    steps.push({
      kind: "verdict", ms: sceneMs("verdict"),
      enter: () => {
        try { audio.accent(verdict.good ? "stampGood" : "stampBad"); } catch {}
        buzz(BUZZ.verdict, audio.muted);
        if (verdict.good) audio.swellWarmth();
      },
    });
    let acc = 0;
    steps.forEach((s, i) => {
      if (i === 0) { at(250, () => s.enter?.()); return; }
      acc += steps[i - 1].ms;
      const kind = s.kind;
      const enter = s.enter;
      at(acc, () => { setScene(kind); enter?.(); });
    });
    acc += steps[steps.length - 1].ms;
    at(acc, () => setScene("receipt"));
    return () => { timers.current.forEach(clearTimeout); timers.current = []; };
    // one-shot ceremony timeline
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const skipToEnd = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setScene("receipt");
  }, []);

  // global input-skip: any tap/key jumps the film to the settled receipt
  useSkippable(!settled, skipToEnd);

  const finish = useCallback(() => {
    timers.current.forEach(clearTimeout);
    if (!doneRef.current) { doneRef.current = true; onDone(); }
  }, [onDone]);

  const lossTone = (scene === "swing" && !isWin) || (scene === "verdict" && !verdict.good);

  // While the film runs, flag the body so game toasts (concept "Noted" chips
  // fired by the final event) stay hidden — see globals.css body[data-ceremony].
  useEffect(() => {
    if (settled) { delete document.body.dataset.ceremony; return; }
    document.body.dataset.ceremony = "1";
    return () => { delete document.body.dataset.ceremony; };
  }, [settled]);

  return (
    // z-[95]: the ceremony owns the whole screen — game toasts (Toast z-[90],
    // e.g. a concept "Noted" chip fired by the final event) paint underneath.
    <div className="relative isolate z-[95] min-h-[100svh] w-full overflow-hidden bg-bg text-ink">
      <AnimatePresence mode="wait">
        {/* ---------------- Scene 1 — RUN CLOSED ---------------- */}
        {scene === "closed" && (
          <SceneFrame key="closed" eyebrow="">
            <motion.h1
              initial={{ scale: 1.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 170, damping: 15 }}
              className="display-caps text-center text-[13vw] leading-[0.9] sm:text-[8rem]"
            >
              Run<br className="sm:hidden" /> Closed
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: DUR.base, ease: EASE }}
              className="num mt-5 text-[0.75rem] text-secondary"
              style={{ letterSpacing: "0.2em" }}
            >
              STATEMENT NO. {run.mode}-{run.seed} · {firstYear}–{lastYear}
            </motion.p>
          </SceneFrame>
        )}

        {/* ---------------- Scene 2 — THE YEARS ---------------- */}
        {scene === "years" && hist.length > 0 && (
          <SceneFrame key="years" eyebrow="The Years">
            <YearsScene hist={hist} milestones={milestones} totalMs={yearsMs} />
          </SceneFrame>
        )}

        {/* ---------------- Scene 3 — THE WIN / THE HIT ---------------- */}
        {scene === "swing" && swing && (
          <SceneFrame key="swing" eyebrow={isWin ? "The Win" : "The Hit"}>
            <motion.div
              animate={isWin ? undefined : { x: [0, -10, 8, -6, 4, 0], y: [0, 4, -3, 2, 0] }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="flex flex-col items-center text-center"
            >
              <motion.p
                initial={{ scale: 1.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 220, damping: 16 }}
                className={`display-caps px-[0.2em] text-[11vw] leading-[1.05] sm:text-[6.5rem] ${isWin ? "bg-gain text-bg" : "bg-loss text-bg"}`}
              >
                {isWin ? "+" : "−"}{currency(Math.abs(swing.portfolioDelta))}
              </motion.p>
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35, duration: DUR.base, ease: EASE }}
                className="num mt-5 text-[0.8rem] text-secondary"
                style={{ letterSpacing: "0.2em" }}
              >
                {isWin ? "YOUR BEST YEAR" : "YOUR WORST YEAR"} — {swing.year}
              </motion.p>
              {macroEvent(swing.year) && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6 }}
                  className="eyebrow mt-2 text-ink-dim"
                  style={{ fontSize: "0.6rem" }}
                >
                  {macroEvent(swing.year)!.title.toUpperCase()}
                </motion.p>
              )}
            </motion.div>
          </SceneFrame>
        )}

        {/* ---------------- Scene 4 — THE LINE ---------------- */}
        {scene === "line" && nwSeries.length > 1 && (
          <SceneFrame key="line" eyebrow={`The Line — Net Worth ${firstYear}–${lastYear}`}>
            <div className="w-full max-w-5xl px-6">
              <NetWorthDraw values={nwSeries} draw reduced={false} tall />
              <div className="mt-3 flex items-baseline justify-between">
                <span className="num text-[0.7rem] text-secondary">START — {currency(nwSeries[0])}</span>
                <span
                  className="num text-[0.9rem] font-bold"
                  style={{ color: nw >= 0 ? "var(--color-gain)" : "var(--color-loss)" }}
                >
                  FINAL — {currency(nw)}
                </span>
              </div>
            </div>
          </SceneFrame>
        )}

        {/* ---------------- Scene 5 — VERDICT ---------------- */}
        {scene === "verdict" && (
          <SceneFrame key="verdict" eyebrow="Final Verdict">
            <div className="flex flex-col items-center text-center">
              <SplitFlap text={verdict.title} hex={verdict.hex} active reduced={false} className="text-4xl sm:text-7xl md:text-8xl" />
              {hist.length > 0 && (
                <motion.p
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: DUR.base, ease: EASE, delay: 0.6 }}
                  className="num mt-6 text-[0.75rem] text-secondary"
                  style={{ letterSpacing: "0.18em" }}
                >
                  YEARS LIVED — <NumberTicker value={hist.length} durationMs={900} className="text-ink" />
                </motion.p>
              )}
            </div>
          </SceneFrame>
        )}

        {/* ---------------- Settled receipt (the original outro frame) ---------------- */}
        {scene === "receipt" && (
          <motion.div
            key="receipt"
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
                <NeonButton variant="primary" size="lg" className="mt-6" onClick={finish}>See the full report →</NeonButton>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* falls — natural timeline only (scenes never mount on skip/reduced) */}
      {scene === "swing" && (isWin ? <MoneyFall /> : <AshFall />)}
      {scene === "verdict" && (verdict.good ? <MoneyFall /> : <AshFall />)}

      {/* film vocabulary — heavy during the film, faint on the receipt */}
      <FilmLayer
        grain={settled ? 0.22 : 0.6}
        flicker={settled ? 0 : 0.45}
        vignette={settled ? 0.3 : 0.7}
        flashKey={scene}
        flashTone={lossTone ? "loss" : "ink"}
        className="z-30"
      />

      <div className="absolute right-4 top-4 z-40"><MuteButton muted={audio.muted} onToggle={() => audio.setMuted(!audio.muted)} /></div>
      <div className="absolute bottom-6 right-4 z-40"><SkipButton onSkip={settled ? finish : skipToEnd} /></div>
    </div>
  );
}

/** Full-bleed centered scene shell with a mono eyebrow up top. */
function SceneFrame({ eyebrow, children }: { eyebrow: string; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DUR.instant }}
      className="absolute inset-0 z-10 flex flex-col items-center justify-center px-5"
    >
      {eyebrow && (
        <span className="eyebrow absolute top-8 left-1/2 -translate-x-1/2 text-ink-dim" style={{ fontSize: "0.6rem", letterSpacing: "0.3em" }}>
          {eyebrow.toUpperCase()}
        </span>
      )}
      {children}
    </motion.div>
  );
}

/** Scene 2 — the giant year counter: flips every lived year, holds on milestones. */
function YearsScene({ hist, milestones, totalMs }: { hist: YearRecord[]; milestones: Map<number, string>; totalMs: number }) {
  const [idx, setIdx] = useState(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const holds = hist.map((h) => (milestones.has(h.year) ? YEARS_HOLD_MS + YEARS_FLIP_MS : YEARS_FLIP_MS));
    const raw = holds.reduce((a, b) => a + b, 0) || 1;
    const scale = totalMs / raw;
    let acc = 0;
    hist.forEach((_, i) => {
      if (i === 0) return;
      acc += holds[i - 1] * scale;
      timers.current.push(window.setTimeout(() => setIdx(i), acc));
    });
    return () => { timers.current.forEach(clearTimeout); timers.current = []; };
    // one-shot replay
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const h = hist[idx];
  const caption = milestones.get(h.year);
  const delta = h.portfolioDelta;

  return (
    <div className="flex flex-col items-center text-center">
      <YearFlap value={h.year} reduced={false} className="text-[15vw] sm:text-[8rem]" />
      <span
        key={h.year}
        className="num mt-5 text-lg sm:text-2xl"
        style={{ color: delta >= 0 ? "var(--color-gain)" : "var(--color-loss)" }}
      >
        {delta >= 0 ? "+" : "−"}{currency(Math.abs(delta))}
      </span>
      <div className="mt-3 flex min-h-[1.4rem] items-center justify-center">
        <AnimatePresence mode="wait">
          {caption && (
            <motion.p
              key={caption}
              initial={{ opacity: 0, scale: 1.2 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="eyebrow text-ink"
              style={{ fontSize: "0.62rem", letterSpacing: "0.22em" }}
            >
              {caption}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      <span className="num absolute right-6 top-8 text-[0.7rem] text-secondary" style={{ letterSpacing: "0.18em" }}>
        AGE {h.age}
      </span>
    </div>
  );
}

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
 * Net-worth line that draws left-to-right; `tall` = the full-bleed scene-4 cut.
 * Drawn via a clip-path reveal (not framer pathLength — its dasharray trick
 * fragments the stroke under preserveAspectRatio="none").
 */
function NetWorthDraw({ values, draw, reduced, tall = false }: { values: number[]; draw: boolean; reduced: boolean; tall?: boolean }) {
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
  const shown = reduced || draw;
  return (
    <div className={`relative w-full ${tall ? "h-[46svh]" : "h-16"}`} aria-hidden>
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <line x1="0" y1={zeroY} x2="100" y2={zeroY} stroke="var(--color-ink-dim)" strokeWidth="0.3" strokeDasharray="1 1" opacity="0.5" />
      </svg>
      <motion.div
        className="absolute inset-0"
        initial={reduced ? false : { clipPath: "inset(0 100% 0 0)" }}
        animate={{ clipPath: shown ? "inset(0 0% 0 0)" : "inset(0 100% 0 0)" }}
        transition={{ duration: reduced ? 0 : tall ? 1.6 : 0.9, ease: EASE }}
      >
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-full w-full">
          <polyline
            points={pts.join(" ")}
            fill="none"
            stroke={up ? "#2bd576" : "#ff3b30"}
            strokeWidth={tall ? 1.6 : 0.9}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </motion.div>
    </div>
  );
}
