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
            {/* The replay used to be a `fixed left-4 top-14` chip floating over the whole
                landing. Clearing the hero rail fixed the one overlap that had been noticed
                and left the rest: probed at eleven scroll offsets it collided at every one
                of them, 15,498px² of that on other controls. It is a cell in the hero's own
                rail now — in the document, so it cannot overlap anything — and it sits
                beside the landing's sound control, which had been missing entirely. */}
            <Intro onBegin={onStart} onAlmanac={onAlmanac} onReplayIntro={replay} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
