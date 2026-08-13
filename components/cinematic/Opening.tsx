"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { Intro } from "@/components/screens/Intro";
import { useAudio } from "@/hooks/useAudio";
import { ColdOpen } from "./ColdOpen";
import { Gate } from "./Gate";
import { DUR } from "@/src/motion/tokens";

type Stage = "gate" | "cold" | "title";

const wipe = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: DUR.base },
};

export function Opening({ onStart, onAlmanac }: { onStart: () => void; onAlmanac: () => void }) {
  const audio = useAudio();
  // Always render "gate" on the server AND the first client paint so hydration
  // matches; promote returning visitors to the title after mount (no SSR mismatch).
  const [stage, setStage] = useState<Stage>("gate");
  useEffect(() => {
    try {
      if (sessionStorage.getItem("lp_introSeen") === "1") setStage("title");
    } catch {}
  }, []);

  const begin = useCallback(() => {
    audio.unlock("intro"); // starts the engine on this gesture, at the intro preset
    setStage("cold");
  }, [audio]);

  const finishCold = useCallback(() => {
    audio.setPhase("title"); // crossfade into the signature title theme behind the hero
    try { sessionStorage.setItem("lp_introSeen", "1"); } catch {}
    setStage("title");
  }, [audio]);

  const replay = useCallback(() => {
    audio.unlock("intro");
    audio.setPhase("intro");
    setStage("cold");
  }, [audio]);

  const toggleMute = useCallback(() => audio.setMuted(!audio.muted), [audio]);

  return (
    <div className="relative">
      <AnimatePresence>
        {stage === "gate" && (
          <motion.div key="gate" {...wipe}>
            <Gate onBegin={begin} muted={audio.muted} onToggleMute={toggleMute} />
          </motion.div>
        )}
        {stage === "cold" && (
          <motion.div key="cold" {...wipe}>
            <ColdOpen muted={audio.muted} onToggleMute={toggleMute} onDone={finishCold} />
          </motion.div>
        )}
        {stage === "title" && (
          <motion.div key="title" {...wipe}>
            <Intro onBegin={onStart} onAlmanac={onAlmanac} />
            {/* Clears the hero's top rail (~41px) instead of sitting on top of it — at top-4
                this covered the LIFEPATCH cell at every breakpoint. */}
            <button
              type="button"
              onClick={replay}
              aria-label="Replay the intro film"
              data-radius=""
              className="fixed left-4 top-14 z-30 flex min-h-11 items-center gap-1.5 border border-hairline-strong bg-bg px-3 py-2 text-ink-dim transition-colors hover:border-ink hover:text-ink"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M7 4l13 8-13 8z" /></svg>
              <span className="eyebrow" style={{ fontSize: "0.56rem" }}>Intro</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
