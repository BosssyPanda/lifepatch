"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { CashflowShell } from "@/components/cashflow/CashflowShell";
import { Opening } from "@/components/cinematic/Opening";
import { Outro } from "@/components/cinematic/Outro";
import { Almanac } from "@/components/screens/Almanac";
import { AuthGate } from "@/components/screens/AuthGate";
import { LifeReport } from "@/components/screens/LifeReport";
import { ModeSelect } from "@/components/screens/ModeSelect";
import { Setup } from "@/components/screens/Setup";
import { YearLoop } from "@/components/run/YearLoop";
import { useAuth } from "@/hooks/useAuth";
import { AudioProvider, useAudio } from "@/hooks/useAudio";
import { useRun } from "@/hooks/useRun";
import { Leaderboard } from "@/components/social/Leaderboard";
import { resolvePlayerId } from "@/lib/cloud/identity";
import { resultFromRun } from "@/lib/cloud/buildResult";
import { ensureProfile } from "@/lib/cloud/profiles";
import { submitResult } from "@/lib/cloud/results";
import { bumpStreak } from "@/lib/cloud/streaks";
import type { GameMode } from "@/lib/cloud/types";

const wipe = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -16 },
  transition: { duration: 0.4, ease: [0.2, 0.65, 0.3, 0.9] },
};

export function AppShell() {
  return (
    <AudioProvider>
      <AppShellInner />
    </AudioProvider>
  );
}

function AppShellInner() {
  const auth = useAuth();
  const run = useRun(auth.user?.id ?? null);
  const audio = useAudio();
  const { phase, mode } = run;
  const [almanacOpen, setAlmanacOpen] = useState(false);
  const openAlmanac = () => { audio.sfx("modal"); setAlmanacOpen(true); };
  const [socialOpen, setSocialOpen] = useState(false);
  const [socialMode, setSocialMode] = useState<GameMode>("story");
  const openLeaderboard = (m: GameMode) => { audio.sfx("modal"); setSocialMode(m); setSocialOpen(true); };
  const submittedRef = useRef<string | null>(null);

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
  // Guarded by run identity so re-renders of the report don't double-submit.
  useEffect(() => {
    if (phase !== "report" || !run.run || run.run.status !== "ended") return;
    const r = run.run;
    const key = `${r.mode}-${r.seed}-${r.endYear ?? r.year}`;
    if (submittedRef.current === key) return;
    submittedRef.current = key;
    const id = resolvePlayerId(auth.user?.id ?? null);
    if (!id) return;
    void (async () => {
      try {
        await ensureProfile(id);
        await submitResult(id, resultFromRun(r));
        await bumpStreak(id);
      } catch {}
    })();
  }, [phase, run.run, auth.user]);

  if (inCashflow) {
    return (
      <main className="relative min-h-[100svh] w-full">
        <CashflowShell onExit={run.toTitle} onOpenAlmanac={openAlmanac} />
        <Almanac open={almanacOpen} onClose={() => setAlmanacOpen(false)} />
      </main>
    );
  }

  return (
    <main className="relative min-h-[100svh] w-full">
      <AnimatePresence>
        {phase === "intro" && (
          <motion.div key="intro" {...wipe}>
            <Opening onStart={run.goMode} onAlmanac={openAlmanac} />
          </motion.div>
        )}

        {phase === "mode" && (
          <motion.div key="mode" {...wipe}>
            <ModeSelect onChoose={run.chooseMode} onBack={run.toTitle} onLeaderboard={() => openLeaderboard("story")} />
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
            />
          </motion.div>
        )}
      </AnimatePresence>

      <Almanac open={almanacOpen} onClose={() => setAlmanacOpen(false)} />
      <Leaderboard open={socialOpen} onClose={() => setSocialOpen(false)} initialMode={socialMode} />
    </main>
  );
}
