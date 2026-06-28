"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { Opening } from "@/components/cinematic/Opening";
import { Outro } from "@/components/cinematic/Outro";
import { Almanac } from "@/components/screens/Almanac";
import { AuthGate } from "@/components/screens/AuthGate";
import { LifeReport } from "@/components/screens/LifeReport";
import { ModeSelect } from "@/components/screens/ModeSelect";
import { Setup } from "@/components/screens/Setup";
import { YearLoop } from "@/components/run/YearLoop";
import { useAuth } from "@/hooks/useAuth";
import { useRun } from "@/hooks/useRun";

const wipe = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -16 },
  transition: { duration: 0.4, ease: [0.2, 0.65, 0.3, 0.9] },
};

export function AppShell() {
  const auth = useAuth();
  const run = useRun(auth.user?.id ?? null);
  const { phase, mode } = run;
  const [almanacOpen, setAlmanacOpen] = useState(false);
  const openAlmanac = () => setAlmanacOpen(true);

  return (
    <main className="relative min-h-[100svh] w-full">
      <AnimatePresence mode="wait">
        {phase === "intro" && (
          <motion.div key="intro" {...wipe}>
            <Opening onStart={run.goMode} onAlmanac={openAlmanac} />
          </motion.div>
        )}

        {phase === "mode" && (
          <motion.div key="mode" {...wipe}>
            <ModeSelect onChoose={run.chooseMode} onBack={run.toTitle} />
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
    </main>
  );
}
