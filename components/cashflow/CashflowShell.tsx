"use client";

import { AnimatePresence, motion, type Variants } from "framer-motion";
import { useEffect, type ReactNode } from "react";
import { useAudio } from "@/hooks/useAudio";
import { useCashflow } from "@/hooks/useCashflow";
import { CashflowGame } from "@/components/cashflow/CashflowGame";
import { EscapeSequence } from "@/components/cashflow/escape/EscapeSequence";
import { CashflowReport } from "@/components/cashflow/recap/CashflowReport";
import { CashflowSetup } from "@/components/cashflow/setup/CashflowSetup";
import { enterFastTrack } from "@/lib/cashflow/engine";
import { hasCashflowSave } from "@/lib/cashflow/persist";
import { useAuth } from "@/hooks/useAuth";
import { resolveProgressId } from "@/lib/cloud/identity";
import { resultFromCashflow, submitRunOnce } from "@/lib/cloud/buildResult";

import { useMotionCtx } from "@/src/motion/MotionProvider";
import { DUR, EASE } from "@/src/motion/tokens";

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
      : { opacity: 0, scale: 1.03, y: 22 },
  animate: (reduce: boolean) =>
    reduce
      ? { opacity: 1, transition: { duration: DUR.instant } }
      : {
          opacity: 1,
          scale: 1,
          y: 0,
          transition: { duration: DUR.slow, ease: EASE },
        },
  exit: (reduce: boolean) =>
    reduce
      ? { opacity: 0, transition: { duration: 0.14 } }
      : {
          opacity: 0,
          scale: 0.985,
          y: -18,
          transition: { duration: 0.32, ease: EASE },
        },
};

export function CashflowShell({
  onExit,
  onOpenAlmanac,
  onMasteryMap,
}: {
  onExit: () => void;
  onOpenAlmanac?: () => void;
  onMasteryMap?: () => void;
}) {
  const cf = useCashflow();
  const auth = useAuth();
  // Destructured, not held as one object: the API methods are stable but `audio`
  // itself changes identity on every mute / volume change, and these effects fire
  // one-shot accents — depending on the object re-triggered the riser mid-scene
  // whenever the fader moved.
  const { setPhase, accent, ambience, unlock } = useAudio();
  const { reduced: reduce } = useMotionCtx();
  const s = cf.state;

  // "lost" reaches the recap too — a debt spiral that ends the run has to LAND,
  // with the same ceremony the win gets. The status existed in the type from the
  // start and nothing ever assigned it, so a hopeless run just went on forever.
  const view: "setup" | "play" | "escape" | "report" = !s
    ? "setup"
    : s.status === "escaped"
      ? "escape"
      : s.status === "won" || s.status === "lost"
        ? "report"
        : "play";

  // Drive the adaptive score. Escape/report screens set their own warm phase.
  useEffect(() => {
    if (view === "setup") setPhase("menu");
    else if (view === "play") setPhase("gameplay");
  }, [view, setPhase]);

  // A short riser marks each deliberate scene change (skipped under reduced motion).
  useEffect(() => {
    if (reduce) return;
    if (view === "escape") accent("riser");
    else if (view === "report") accent("title");
  }, [view, reduce, accent]);

  // The board's room tone. Every other ambience bed is set from the Story run
  // (YearLoop); the Rat Race set none at all, so the mode was missing a whole
  // audio layer. `amb_office` is the right bed — this is the cubicle the player
  // is trying to buy their way out of. Cleared when the escape cinematic takes
  // over and on unmount, so nothing bleeds into the warm scenes.
  useEffect(() => {
    if (view !== "play") return;
    ambience("amb_office");
    return () => ambience(null);
  }, [view, ambience]);

  // Post a Rat Race result + bump the streak when the run reaches its report.
  // Keyed on the per-game seed so replays (same name/turn) each post once, and
  // resolved against the signed-in user so cloud submission works for them too.
  useEffect(() => {
    if (view !== "report" || !s) return;
    // `resolveProgressId` for the same reason AppShell uses it: this is a per-player
    // WRITE, and it must resolve its id the way the matching read does. See there.
    const id = resolveProgressId(auth.user?.id ?? null);
    void submitRunOnce(`cf-${s.seed}`, id, resultFromCashflow(s));
  }, [view, s, auth.user]);

  const scene = (key: string, children: ReactNode) => (
    <motion.div
      key={key}
      custom={reduce}
      variants={sceneVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{ transformOrigin: "center top", willChange: "transform, opacity" }}
    >
      {children}
    </motion.div>
  );

  return (
    <AnimatePresence mode="wait" initial={false}>
      {view === "play" && s
        ? scene(
            "cf-play",
            <CashflowGame s={s} apply={cf.apply} commit={cf.commit} onExit={onExit} onOpenAlmanac={onOpenAlmanac} />,
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
                  onMasteryMap={onMasteryMap}
                />,
              )
            : scene(
                "cf-setup",
                <CashflowSetup
                  hasSave={hasCashflowSave()}
                  onResume={() => {
                    cf.resume();
                    unlock("gameplay");
                  }}
                  onBegin={(prof, dream, name) => cf.begin(prof, dream, name)}
                  onExit={onExit}
                />,
              )}
    </AnimatePresence>
  );
}
