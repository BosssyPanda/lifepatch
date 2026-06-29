"use client";

import { motion } from "framer-motion";
import { useEffect } from "react";
import { useAudio } from "@/hooks/useAudio";
import { useCashflow } from "@/hooks/useCashflow";
import { CashflowGame } from "@/components/cashflow/CashflowGame";
import { EscapeSequence } from "@/components/cashflow/escape/EscapeSequence";
import { CashflowReport } from "@/components/cashflow/recap/CashflowReport";
import { CashflowSetup } from "@/components/cashflow/setup/CashflowSetup";
import { enterFastTrack } from "@/lib/cashflow/engine";
import { hasCashflowSave } from "@/lib/cashflow/persist";

const wipe = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -14 },
  transition: { duration: 0.35, ease: [0.2, 0.65, 0.3, 0.9] as const },
};

export function CashflowShell({
  onExit,
}: {
  onExit: () => void;
  onOpenAlmanac?: () => void;
}) {
  const cf = useCashflow();
  const audio = useAudio();
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

  if (view === "play" && s) {
    return (
      <motion.div key="cf-play" {...wipe}>
        <CashflowGame s={s} apply={cf.apply} commit={cf.commit} onExit={onExit} />
      </motion.div>
    );
  }

  if (view === "escape" && s) {
    return (
      <motion.div key="cf-escape" {...wipe}>
        <EscapeSequence s={s} onDone={() => cf.commit((st) => enterFastTrack(st))} />
      </motion.div>
    );
  }

  if (view === "report" && s) {
    return (
      <motion.div key="cf-report" {...wipe}>
        <CashflowReport
          s={s}
          onReplay={() => cf.begin(s.professionId, s.dreamId, s.playerName)}
          onExit={() => { cf.reset(); onExit(); }}
        />
      </motion.div>
    );
  }

  return (
    <motion.div key="cf-setup" {...wipe}>
      <CashflowSetup
        hasSave={hasCashflowSave()}
        onResume={() => { cf.resume(); audio.unlock("gameplay"); }}
        onBegin={(prof, dream, name) => cf.begin(prof, dream, name)}
        onExit={onExit}
      />
    </motion.div>
  );
}
