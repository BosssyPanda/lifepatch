"use client";

import { AnimatePresence, motion } from "framer-motion";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Opening } from "@/components/cinematic/Opening";
import { ModeSelect } from "@/components/screens/ModeSelect";
import { useAuth } from "@/hooks/useAuth";
import { AudioProvider, useAudio } from "@/hooks/useAudio";
import { useRun } from "@/hooks/useRun";
import { ConceptLearnProvider, useConceptLearn } from "@/hooks/useConceptLearn";
import { TerminalOp } from "@/components/ui/TerminalOp";
import { MotionProvider, useMotionCtx } from "@/src/motion/MotionProvider";
import { wipeFor } from "@/src/motion/transitions";
import { resolvePlayerId } from "@/lib/cloud/identity";
import { flushPendingResults, resultFromRun, submitRunOnce } from "@/lib/cloud/buildResult";
import type { GameMode } from "@/lib/cloud/types";

// Code-split every screen first paint doesn't need. Only the intro (Opening) and
// ModeSelect stay eager; the run engine, Rat Race board, cinematics, report, and
// overlays load on demand — keeping `/`'s First Load lean. ssr:false because these
// are all client-only screens gated behind a phase or a user action.
const screenFallback = () => (
  <div className="flex min-h-[100svh] items-center justify-center bg-bg">
    <TerminalOp label="Loading" center />
  </div>
);
const CashflowShell = dynamic(() => import("@/components/cashflow/CashflowShell").then((m) => m.CashflowShell), { ssr: false, loading: screenFallback });
const YearLoop = dynamic(() => import("@/components/run/YearLoop").then((m) => m.YearLoop), { ssr: false, loading: screenFallback });
const Outro = dynamic(() => import("@/components/cinematic/Outro").then((m) => m.Outro), { ssr: false, loading: screenFallback });
const LifeReport = dynamic(() => import("@/components/screens/LifeReport").then((m) => m.LifeReport), { ssr: false, loading: screenFallback });
const AuthGate = dynamic(() => import("@/components/screens/AuthGate").then((m) => m.AuthGate), { ssr: false, loading: screenFallback });
const Setup = dynamic(() => import("@/components/screens/Setup").then((m) => m.Setup), { ssr: false, loading: screenFallback });
// Overlays: keep their always-mounted open/close API (and exit animation) but defer
// the chunk until the first time each is opened, then leave it mounted.
const Almanac = dynamic(() => import("@/components/screens/Almanac").then((m) => m.Almanac), { ssr: false });
const Leaderboard = dynamic(() => import("@/components/social/Leaderboard").then((m) => m.Leaderboard), { ssr: false });
const MasteryMap = dynamic(() => import("@/components/learn/MasteryMap").then((m) => m.MasteryMap), { ssr: false });

export function AppShell() {
  return (
    <AudioProvider>
      <ConceptLearnProvider>
        <MotionProvider>
          <AppShellInner />
        </MotionProvider>
      </ConceptLearnProvider>
    </AudioProvider>
  );
}

function AppShellInner() {
  const auth = useAuth();
  const run = useRun(auth.user?.id ?? null);
  const audio = useAudio();
  const { reduced } = useMotionCtx();
  // Phase-C transition layer: the paper-feed wipe (director's pick; see src/motion/transitions).
  const wipe = wipeFor(reduced);
  const { phase, mode } = run;
  // Each overlay stays mounted once first opened (defers its chunk without losing
  // the open/close animation); `*Open` drives visibility, `*Mounted` gates the load.
  const [almanacOpen, setAlmanacOpen] = useState(false);
  const [almanacMounted, setAlmanacMounted] = useState(false);
  const openAlmanac = () => { audio.sfx("modal"); setAlmanacMounted(true); setAlmanacOpen(true); };
  const [socialOpen, setSocialOpen] = useState(false);
  const [socialMounted, setSocialMounted] = useState(false);
  const [socialMode, setSocialMode] = useState<GameMode>("story");
  const openLeaderboard = (m: GameMode) => { audio.sfx("modal"); setSocialMounted(true); setSocialMode(m); setSocialOpen(true); };
  const [masteryOpen, setMasteryOpen] = useState(false);
  const [masteryMounted, setMasteryMounted] = useState(false);
  const openMasteryMap = () => { audio.sfx("modal"); setMasteryMounted(true); setMasteryOpen(true); };
  const { resetRun } = useConceptLearn();

  // The Rat Race mode is a fully self-contained board game with its own internal
  // phase machine — hand off to it as soon as it's chosen (skip LifePatch auth).
  const inCashflow = mode === "cashflow" && phase !== "intro" && phase !== "mode";

  // Phase → music preset. intro & recap are owned by Opening/Outro (so they can
  // sync the escalation/verdict), everything else crossfades to a steady bed.
  useEffect(() => {
    if (phase === "mode" || phase === "auth" || phase === "setup") audio.setPhase("menu");
    else if (phase === "run") audio.setPhase("gameplay");
    else if (phase === "report") audio.setPhase("menu");
  }, [phase, audio]);

  // Post a leaderboard result + bump the daily streak when a life run finishes.
  // submitRunOnce dedupes durably (per run seed), so re-renders, resumes, and
  // reloads all post exactly once.
  useEffect(() => {
    if (phase !== "report" || !run.run || run.run.status !== "ended") return;
    const r = run.run;
    const id = resolvePlayerId(auth.user?.id ?? null);
    void submitRunOnce(`${r.mode}-${r.seed}`, id, resultFromRun(r));
  }, [phase, run.run, auth.user]);

  // Drain the result outbox — runs that finished signed-out or during a network
  // blip post to the GLOBAL board as soon as an identity/connection exists.
  useEffect(() => {
    const flush = () => void flushPendingResults(resolvePlayerId(auth.user?.id ?? null));
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [auth.user]);

  // Fresh run → clear the "this run sharpened" concept summary.
  const runSeed = run.run?.seed ?? null;
  useEffect(() => {
    if (phase === "run") resetRun();
  }, [phase, runSeed, resetRun]);

  if (inCashflow) {
    return (
      <main id="main" className="relative min-h-[100svh] w-full">
        <CashflowShell onExit={run.toTitle} onOpenAlmanac={openAlmanac} onMasteryMap={openMasteryMap} />
        {almanacMounted && <Almanac open={almanacOpen} onClose={() => setAlmanacOpen(false)} />}
        {masteryMounted && <MasteryMap open={masteryOpen} onClose={() => setMasteryOpen(false)} />}
      </main>
    );
  }

  return (
    <main id="main" className="relative min-h-[100svh] w-full">
      <AnimatePresence mode="wait">
        {phase === "intro" && (
          <motion.div key="intro" {...wipe}>
            <Opening onStart={run.goMode} onAlmanac={openAlmanac} />
          </motion.div>
        )}

        {phase === "mode" && (
          <motion.div key="mode" {...wipe}>
            <ModeSelect onChoose={run.chooseMode} onBack={run.toTitle} onLeaderboard={() => openLeaderboard("story")} onMasteryMap={openMasteryMap} />
          </motion.div>
        )}

        {phase === "auth" && mode && (
          <motion.div key="auth" {...wipe}>
            <AuthGate auth={auth} mode={mode} onResume={run.resume} onNew={run.toSetup} onBack={run.goMode} />
          </motion.div>
        )}

        {phase === "setup" && mode && (
          <motion.div key="setup" {...wipe}>
            <Setup mode={mode} onStart={(bg, name) => run.start(mode, bg, name)} onBack={() => run.setPhase("auth")} />
          </motion.div>
        )}

        {phase === "run" && run.run && (
          <motion.div key="run" {...wipe}>
            <YearLoop run={run} onOpenAlmanac={openAlmanac} />
          </motion.div>
        )}

        {phase === "recap" && run.run && (
          <motion.div key="recap" {...wipe}>
            <Outro run={run.run} onDone={run.toReport} />
          </motion.div>
        )}

        {phase === "report" && run.run && (
          <motion.div key="report" {...wipe}>
            <LifeReport
              run={run.run}
              onReplay={() => run.start(run.run!.mode, run.run!.backgroundId, run.run!.name)}
              onTitle={run.toTitle}
              onAlmanac={openAlmanac}
              onMasteryMap={openMasteryMap}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {almanacMounted && <Almanac open={almanacOpen} onClose={() => setAlmanacOpen(false)} />}
      {socialMounted && <Leaderboard open={socialOpen} onClose={() => setSocialOpen(false)} initialMode={socialMode} />}
      {masteryMounted && <MasteryMap open={masteryOpen} onClose={() => setMasteryOpen(false)} />}
    </main>
  );
}
