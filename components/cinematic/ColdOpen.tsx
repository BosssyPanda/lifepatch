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
  }, [i, audio, onDone]);

  const skip = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!doneRef.current) { doneRef.current = true; onDone(); }
  };

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
