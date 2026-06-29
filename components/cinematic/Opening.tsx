"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useRef, useState } from "react";
import { Intro } from "@/components/screens/Intro";
import { useAudio } from "@/hooks/useAudio";
import { ColdOpen } from "./ColdOpen";
import { Gate } from "./Gate";

type Stage = "gate" | "cold" | "title";

const wipe = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.4 },
};

export function Opening({ onStart, onAlmanac }: { onStart: () => void; onAlmanac: () => void }) {
  const audio = useAudio();
  const seen = useRef(typeof window !== "undefined" && sessionStorage.getItem("lp_introSeen") === "1");
  const [stage, setStage] = useState<Stage>(seen.current ? "title" : "gate");

  const begin = useCallback(() => {
    audio.unlock("intro"); // starts the engine on this gesture, at the intro preset
    setStage("cold");
  }, [audio]);

  const finishCold = useCallback(() => {
    audio.setPhase("menu"); // crossfade — music keeps playing into the title screen
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
      <AnimatePresence mode="wait">
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
            <button
              type="button"
              onClick={replay}
              className="fixed left-4 top-4 z-30 flex items-center gap-1.5 rounded-[3px] border border-ink/25 bg-bg/60 px-2.5 py-1.5 text-ink-dim backdrop-blur-sm transition-colors hover:border-accent hover:text-accent"
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
