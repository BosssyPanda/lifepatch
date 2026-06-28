"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { useScore } from "@/hooks/useScore";
import { COLD_OPEN } from "@/lib/cinematic";
import { Beat } from "./Beat";
import { MuteButton, SkipButton } from "./Controls";

export function ColdOpen({
  score,
  muted,
  onToggleMute,
  onDone,
}: {
  score: ReturnType<typeof useScore>;
  muted: boolean;
  onToggleMute: () => void;
  onDone: () => void;
}) {
  const [i, setI] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const beat = COLD_OPEN[i];
    if (!beat) {
      if (!doneRef.current) { doneRef.current = true; onDone(); }
      return;
    }
    try { score.play(beat.accent); } catch {}
    timerRef.current = setTimeout(() => setI((n) => n + 1), beat.ms);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [i, score, onDone]);

  const skip = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!doneRef.current) { doneRef.current = true; onDone(); }
  };

  const beat = COLD_OPEN[i];

  return (
    <div className="bg-arena relative flex min-h-[100svh] w-full items-center justify-center overflow-hidden">
      <AnimatePresence mode="wait">
        {beat && (
          <motion.div
            key={beat.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="flex w-full items-center justify-center"
          >
            <Beat beat={beat} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute right-4 top-4 z-20">
        <MuteButton muted={muted} onToggle={onToggleMute} />
      </div>
      <div className="absolute bottom-6 right-4 z-20">
        <SkipButton onSkip={skip} />
      </div>

      {/* progress ticks */}
      <div className="absolute bottom-7 left-1/2 flex -translate-x-1/2 gap-1.5">
        {COLD_OPEN.map((b, idx) => (
          <span key={b.id} className="h-1 w-5 rounded-full" style={{ background: idx <= i ? "var(--color-accent)" : "var(--color-ink-dim)", opacity: idx <= i ? 1 : 0.3 }} />
        ))}
      </div>
    </div>
  );
}
