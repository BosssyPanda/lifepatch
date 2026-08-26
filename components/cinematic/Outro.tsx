"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAudio } from "@/hooks/useAudio";
import { ACCENT_PREROLL_MS, useBeatClock } from "@/hooks/useBeatClock";
import { currency } from "@/lib/format";
import { macroEvent, sp500Return } from "@/lib/markets";
import { netWorth, type RunState, type YearRecord } from "@/lib/runEngine";
import { deriveVerdict } from "@/lib/verdict";
import { RECAP_SCENES, YEARS_FLIP_MS, YEARS_HOLD_MS, YEARS_MIN_MS } from "@/lib/cinematic";
import { prefersReducedMotionNow, useMotionCtx } from "@/src/motion/MotionProvider";
import { useSkippable } from "@/src/motion/useSkippable";
import { DUR, EASE } from "@/src/motion/tokens";
import { buzz, BUZZ } from "@/src/motion/haptics";
import { NumberTicker } from "@/components/cinematic/landing/NumberTicker";
import { MuteButton, SkipButton } from "./Controls";
import { MoneyFall } from "./MoneyFall";
import { SplitFlap } from "./SplitFlap";
import { AshFall } from "./film/AshFall";
import { FilmLayer } from "./film/FilmLayer";
import { NetWorthDraw } from "./outro/NetWorthDraw";
import { ReceiptScene } from "./outro/ReceiptScene";
import { SceneFrame } from "./outro/SceneFrame";
import { YearsScene } from "./outro/YearsScene";

/**
 * Run-end recap film (CINEMA Phase Q). Five skippable scenes that SETTLE into
 * the original receipt: RUN CLOSED slam → THE YEARS (digit-flap replay, pauses
 * on milestones) → THE WIN / THE HIT (symmetric — best or worst year plate) →
 * THE LINE (net worth full-bleed) → VERDICT (giant split-flap) → receipt.
 * Reduced motion goes straight to the settled receipt; any input skips there
 * (useSkippable). All data from run.history / deriveVerdict / macroEvent —
 * nothing invented. Film vocabulary (grain/flash/shake/ash) per DESIGN.md
 * § Film Exception; falls fire only from the natural timeline.
 *
 * ── cut on the downbeat ──────────────────────────────────────────────────────
 * The scene ladder is quantized: every cut lands on a BAR of the running score
 * (2.222s at 108 BPM) and each scene's accent is requested a pre-roll early so the
 * engine's 8th-note quantization resolves it onto that same downbeat instead of
 * the 8th after it. The authored durations sit close enough to whole bars of that
 * grid (2200 / 3000 / 3800 / 4200) that the film's total length is effectively
 * unchanged — the cuts simply stop landing between beats. Boundaries are snapped
 * CUMULATIVELY, so rounding never accumulates into drift.
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
  const clock = useBeatClock();
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
    // live read, not the closure: this effect is pinned to [] like Intro's. Outro mounts
    // long after MotionProvider promotes, so the closure value is correct today — and
    // "correct because of where it happens to be mounted" is not a thing to rely on.
    if (prefersReducedMotionNow()) return;
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, Math.max(0, ms)));
    // `cue` is the quantized accent (fired a pre-roll ahead of the cut so it lands
    // ON it); `enter` is everything that belongs to the visible frame itself.
    type Step = { kind: Scene; ms: number; cue?: () => void; enter?: () => void };
    const steps: Step[] = [{
      kind: "closed", ms: sceneMs("closed"),
      cue: () => { try { audio.accent("thump"); } catch {} },
    }];
    if (hist.length > 0) steps.push({
      kind: "years", ms: yearsMs,
      cue: () => { try { audio.accent("rise"); } catch {} },
    });
    if (swing) steps.push({
      kind: "swing", ms: sceneMs("swing"),
      cue: () => { try { audio.accent(isWin ? "stampGood" : "stampBad"); } catch {} },
      enter: () => {
        buzz(BUZZ.verdict, audio.muted);
        if (isWin) audio.swellWarmth();
      },
    });
    if (nwSeries.length > 1) steps.push({
      kind: "line", ms: sceneMs("line"),
      cue: () => { try { audio.accent("rise"); } catch {} },
    });
    steps.push({
      kind: "verdict", ms: sceneMs("verdict"),
      cue: () => { try { audio.accent(verdict.good ? "stampGood" : "stampBad"); } catch {} },
      enter: () => {
        buzz(BUZZ.verdict, audio.muted);
        if (verdict.good) audio.swellWarmth();
      },
    });
    let acc = 0;      // un-quantized cumulative time, so rounding never drifts
    let last = 0;     // the previous snapped boundary (keeps the ladder ordered)
    steps.forEach((s, i) => {
      if (i === 0) {
        // scene 1 is already on screen; only its accent needs placing
        at(clock.snap(250, "8n") - ACCENT_PREROLL_MS, () => s.cue?.());
        return;
      }
      acc += steps[i - 1].ms;
      const boundary = clock.snap(acc, "bar", last + 1);
      last = boundary;
      const kind = s.kind;
      const { cue, enter } = s;
      if (cue) at(boundary - ACCENT_PREROLL_MS, cue);
      at(boundary, () => { setScene(kind); enter?.(); });
    });
    acc += steps[steps.length - 1].ms;
    at(clock.snap(acc, "bar", last + 1), () => setScene("receipt"));
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
          <ReceiptScene
            key="receipt"
            run={run}
            nw={nw}
            worst={worst}
            hist={hist}
            nwSeries={nwSeries}
            verdict={verdict}
            reduced={reduced}
            firstYear={firstYear}
            lastYear={lastYear}
            onFinish={finish}
          />
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
