"use client";

import { AnimatePresence, motion, useReducedMotion, type Variants } from "framer-motion";
import { useEffect, useRef, type ReactNode } from "react";
import { useAudio } from "@/hooks/useAudio";
import { useCashflow } from "@/hooks/useCashflow";
import { CashflowGame } from "@/components/cashflow/CashflowGame";
import { EscapeSequence } from "@/components/cashflow/escape/EscapeSequence";
import { CashflowReport } from "@/components/cashflow/recap/CashflowReport";
import { CashflowSetup } from "@/components/cashflow/setup/CashflowSetup";
import { enterFastTrack } from "@/lib/cashflow/engine";
import { hasCashflowSave } from "@/lib/cashflow/persist";
import { resolvePlayerId } from "@/lib/cloud/identity";
import { resultFromCashflow } from "@/lib/cloud/buildResult";
import { ensureProfile } from "@/lib/cloud/profiles";
import { submitResult } from "@/lib/cloud/results";
import { bumpStreak } from "@/lib/cloud/streaks";

const EASE = [0.2, 0.65, 0.3, 0.9] as const;

/**
 * Between-scene wipe. Each view enters from a depth-pushed clip-reveal and the
 * outgoing one recedes — so setup → play → escape → report read as deliberate
 * scene changes, not a plain crossfade. Compositor-friendly only (transform /
 * opacity / clip-path / filter). Collapses to a quick fade under reduced motion.
 */
const sceneVariants: Variants = {
  initial: (reduce: boolean) =>
    reduce
      ? { opacity: 0 }
      : {
          opacity: 0,
          scale: 1.03,
          y: 22,
          filter: "blur(6px)",
          clipPath: "inset(8% 0% 8% 0% round 14px)",
        },
  animate: (reduce: boolean) =>
    reduce
      ? { opacity: 1, transition: { duration: 0.18 } }
      : {
          opacity: 1,
          scale: 1,
          y: 0,
          filter: "blur(0px)",
          clipPath: "inset(0% 0% 0% 0% round 0px)",
          transition: { duration: 0.5, ease: EASE },
        },
  exit: (reduce: boolean) =>
    reduce
      ? { opacity: 0, transition: { duration: 0.14 } }
      : {
          opacity: 0,
          scale: 0.985,
          y: -18,
          filter: "blur(5px)",
          clipPath: "inset(6% 0% 6% 0% round 14px)",
          transition: { duration: 0.32, ease: EASE },
        },
};

export function CashflowShell({
  onExit,
}: {
  onExit: () => void;
  onOpenAlmanac?: () => void;
}) {
  const cf = useCashflow();
  const audio = useAudio();
  const reduce = !!useReducedMotion();
  const s = cf.state;

  const view: "setup" | "play" | "escape" | "report" = !s
    ? "setup"
    : s.status === "escaped"
      ? "escape"
      : s.status === "won"
        ? "report"
        : "play";

  // Drive the adaptive score. Escape/report screens set their own warm phase.
  useEffect(() => {
    if (view === "setup") audio.setPhase("menu");
    else if (view === "play") audio.setPhase("gameplay");
  }, [view, audio]);

  // A short riser marks each deliberate scene change (skipped under reduced motion).
  useEffect(() => {
    if (reduce) return;
    if (view === "escape") audio.accent("riser");
    else if (view === "report") audio.accent("title");
  }, [view, reduce, audio]);

  // Post a Rat Race result + bump the streak when the run reaches its report.
  const submittedRef = useRef<string | null>(null);
  useEffect(() => {
    if (view !== "report" || !s) return;
    const key = `cf-${s.playerName}-${s.turn}`;
    if (submittedRef.current === key) return;
    submittedRef.current = key;
    const id = resolvePlayerId(null);
    if (!id) return;
    void (async () => {
      try {
        await ensureProfile(id);
        await submitResult(id, resultFromCashflow(s));
        await bumpStreak(id);
      } catch {}
    })();
  }, [view, s]);

  const scene = (key: string, children: ReactNode) => (
    <motion.div
      key={key}
      custom={reduce}
      variants={sceneVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{ transformOrigin: "center top", willChange: "transform, filter, clip-path, opacity" }}
    >
      {children}
    </motion.div>
  );

  return (
    <AnimatePresence mode="wait" initial={false}>
      {view === "play" && s
        ? scene(
            "cf-play",
            <CashflowGame s={s} apply={cf.apply} commit={cf.commit} onExit={onExit} />,
          )
        : view === "escape" && s
          ? scene(
              "cf-escape",
              <EscapeSequence s={s} onDone={() => cf.commit((st) => enterFastTrack(st))} />,
            )
          : view === "report" && s
            ? scene(
                "cf-report",
                <CashflowReport
                  s={s}
                  onReplay={() => cf.begin(s.professionId, s.dreamId, s.playerName)}
                  onExit={() => {
                    cf.reset();
                    onExit();
                  }}
                />,
              )
            : scene(
                "cf-setup",
                <CashflowSetup
                  hasSave={hasCashflowSave()}
                  onResume={() => {
                    cf.resume();
                    audio.unlock("gameplay");
                  }}
                  onBegin={(prof, dream, name) => cf.begin(prof, dream, name)}
                  onExit={onExit}
                />,
              )}
    </AnimatePresence>
  );
}
