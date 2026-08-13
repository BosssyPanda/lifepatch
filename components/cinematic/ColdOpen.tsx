"use client";

import { AnimatePresence, motion } from "framer-motion";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useAudio } from "@/hooks/useAudio";
import { ACT_LABELS, COLD_OPEN } from "@/lib/cinematic";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { Beat } from "./Beat";
import { MuteButton, SkipButton } from "./Controls";
import { FilmLayer } from "./film/FilmLayer";
import { VideoBeat } from "./film/VideoBeat";
import { DUR } from "@/src/motion/tokens";

// Act II's WebGL backdrop — three only loads if/when the act arms.
const BillVortex = dynamic(
  () => import("./film/BillVortex").then((m) => m.BillVortex),
  { ssr: false },
);

/**
 * The intro film (CINEMA Phase P): a ~20s three-act cold open. Act I slams
 * kinetic type over looping film clips (public/film/), Act II runs the live
 * BillVortex WebGL scene, Act III resolves the title. FilmLayer supplies the
 * sanctioned grain/flicker/flash vocabulary; every beat stays skippable and
 * reduced motion keeps the old text-only pacing with posters instead of
 * motion. Audio escalates per beat exactly as before (accents + intensity).
 */
export function ColdOpen({
  muted,
  onToggleMute,
  onDone,
}: {
  muted: boolean;
  onToggleMute: () => void;
  onDone: () => void;
}) {
  const audio = useAudio();
  const { reduced } = useMotionCtx();
  const [i, setI] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef(false);
  // WebGL support check happens client-side only (this tree never SSRs).
  const [webgl] = useState(
    () => typeof window !== "undefined" && typeof window.WebGLRenderingContext !== "undefined",
  );

  useEffect(() => {
    // Reduced motion gets the static equivalent below, not a 20-second wait with the
    // visuals switched off: the timed chain used to keep running regardless, so the
    // whole point of the ceremony (its lines) went by invisibly while the user sat
    // through it. DESIGN.md § Motion — every ceremony owes a static or instant
    // equivalent. The film's phrases are printed at once and the user leaves when
    // they're ready. One quiet accent stands in for the escalating bed.
    if (reduced) {
      audio.setIntensity(0.3);
      try { audio.accent("riser"); } catch {}
      return;
    }
    const beat = COLD_OPEN[i];
    if (!beat) {
      if (!doneRef.current) { doneRef.current = true; onDone(); }
      return;
    }
    // escalate the bed phrase-by-phrase, accent the slam-in
    audio.setIntensity(Math.min(1, 0.3 + (i / Math.max(1, COLD_OPEN.length - 1)) * 0.7));
    try { audio.accent(beat.accent); } catch {}
    timerRef.current = setTimeout(() => setI((n) => n + 1), beat.ms);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [i, audio, onDone, reduced]);

  const skip = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!doneRef.current) { doneRef.current = true; onDone(); }
  };

  if (reduced) {
    // The whole film as one printed page — same copy, same act structure, no timeline.
    return (
      <div className="relative flex min-h-[100svh] w-full flex-col justify-center overflow-hidden bg-bg px-5 py-16 sm:px-10">
        <div className="absolute right-4 top-4 z-30">
          <MuteButton muted={muted} onToggle={onToggleMute} />
        </div>
        <div className="mx-auto w-full max-w-3xl">
          <p className="eyebrow text-secondary" style={{ fontSize: "0.6rem", letterSpacing: "0.3em" }}>
            The Cold Open — in full
          </p>
          <div className="mt-6 border-t border-hairline">
            {COLD_OPEN.filter((b) => b.act !== 3).map((b, idx, all) => (
              <div key={b.id} className="border-b border-hairline py-4">
                {(idx === 0 || all[idx - 1].act !== b.act) && (
                  <p className="eyebrow mb-2 text-secondary" style={{ fontSize: "0.55rem", letterSpacing: "0.3em" }}>
                    {ACT_LABELS[b.act as 1 | 2]}
                  </p>
                )}
                <p className="display-caps text-2xl leading-tight text-ink sm:text-4xl">{b.text}</p>
              </div>
            ))}
          </div>
          <h1 className="display-caps mt-8 text-5xl leading-none text-ink sm:text-7xl">Lifepatch</h1>
          <p className="voice mt-2 text-lg text-ink-dim">Survive the Internet Economy</p>
          <button
            type="button"
            onClick={skip}
            className="mt-8 flex items-center gap-2 border-2 border-hairline-strong px-6 py-3 text-ink transition-colors hover:border-ink"
          >
            <span className="display-caps text-base tracking-[0.18em]">Continue</span>
            <span aria-hidden>→</span>
          </button>
        </div>
        {/* FilmLayer still collapses itself to a single static faint frame here */}
        <FilmLayer grain={0.65} flicker={0.55} vignette={0.75} className="z-20" />
      </div>
    );
  }

  const beat = COLD_OPEN[i];
  const act = beat?.act;
  // The vortex mounts once Act II arms and stays through the act (no churn
  // between its three beats); it unmounts when the title act cuts in.
  const vortexLive = !reduced && webgl && beat?.scene === "vortex";

  return (
    <div className="relative flex min-h-[100svh] w-full items-center justify-center overflow-hidden bg-bg">
      {/* ---- backdrop: Act I film loops (crossfade per clip) ---- */}
      <AnimatePresence>
        {beat?.film && (
          <motion.div
            key={beat.film}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DUR.base }}
            className="absolute inset-0"
          >
            <VideoBeat
              src={`/film/${beat.film}.webm`}
              poster={`/film/${beat.film}-poster.jpg`}
              active
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---- backdrop: Act II live vortex ---- */}
      <AnimatePresence>
        {vortexLive && (
          <motion.div
            key="vortex"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DUR.slow }}
            className="absolute inset-0"
          >
            <BillVortex />
          </motion.div>
        )}
      </AnimatePresence>

      {/* legibility scrim between backdrop and type */}
      {(beat?.film || vortexLive) && (
        <div aria-hidden className="absolute inset-0 bg-bg/45" />
      )}

      {/* ---- act eyebrow ---- */}
      <AnimatePresence mode="wait">
        {(act === 1 || act === 2) && (
          <motion.span
            key={act}
            initial={reduced ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DUR.base }}
            className="eyebrow absolute top-7 left-1/2 z-10 -translate-x-1/2 text-ink-dim"
            style={{ fontSize: "0.6rem", letterSpacing: "0.3em" }}
          >
            {ACT_LABELS[act]}
          </motion.span>
        )}
      </AnimatePresence>

      {/* ---- the type ---- */}
      <AnimatePresence mode="wait">
        {beat && (
          <motion.div
            key={beat.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DUR.instant }}
            className="relative z-10 flex w-full items-center justify-center"
          >
            <Beat beat={beat} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---- film vocabulary: grain + flicker + vignette + per-beat flash ---- */}
      <FilmLayer
        grain={0.65}
        flicker={0.55}
        vignette={0.75}
        flashKey={beat?.id ?? null}
        flashTone={beat?.accent === "stab" ? "loss" : "ink"}
        className="z-20"
      />

      <div className="absolute right-4 top-4 z-30">
        <MuteButton muted={muted} onToggle={onToggleMute} />
      </div>
      <div className="absolute bottom-6 right-4 z-30">
        <SkipButton onSkip={skip} />
      </div>

      {/* progress ticks */}
      <div className="absolute bottom-7 left-1/2 z-30 flex -translate-x-1/2 gap-1.5">
        {COLD_OPEN.map((b, idx) => (
          <span key={b.id} className="h-1 w-5" style={{ background: idx <= i ? "var(--color-ink)" : "var(--color-ink-dim)", opacity: idx <= i ? 1 : 0.3 }} />
        ))}
      </div>
    </div>
  );
}
