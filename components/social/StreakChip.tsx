"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { FlameIcon } from "@/components/icons";
import { useAudio } from "@/hooks/useAudio";
import { useProfile } from "@/hooks/useProfile";
import { todayStr } from "@/lib/cloud/streaks";

/** Once-a-day guard so the streak only celebrates on the first menu after a play. */
const CELEB_KEY = "lifepatch.streakCelebrated";

/** Loss-aversion habit cue: the player's current daily streak. Hidden at zero. */
export function StreakChip() {
  const { streak } = useProfile();
  const { accent, started } = useAudio();
  const reduce = useReducedMotion();
  const [pulse, setPulse] = useState(false);

  const current = streak?.current ?? 0;
  const playedToday = !!streak && streak.lastPlayedOn === todayStr();

  // First time the alive streak shows after today's run: a flame pulse + cue (once/day).
  useEffect(() => {
    if (current <= 0 || !playedToday || !started) return;
    const today = todayStr();
    let celebrated: string | null = null;
    try {
      celebrated = localStorage.getItem(CELEB_KEY);
    } catch {}
    if (celebrated === today) return;
    try {
      localStorage.setItem(CELEB_KEY, today);
    } catch {}
    setPulse(true);
    accent("streak");
    const t = setTimeout(() => setPulse(false), 900);
    return () => clearTimeout(t);
  }, [current, playedToday, started, accent]);

  if (current <= 0) return null;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-bg2/70 px-3 py-1 text-sm shadow-[0_6px_18px_-12px_rgba(0,0,0,0.85)]">
      <motion.span
        aria-hidden
        animate={pulse && !reduce ? { scale: [1, 1.55, 1], rotate: [0, -12, 10, 0] } : { scale: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="text-accent"
      >
        <FlameIcon size={14} />
      </motion.span>
      <span className="display-caps tracking-[0.1em] text-accent">{current}</span>
      <span className="text-ink-dim">day{current === 1 ? "" : "s"}</span>
    </span>
  );
}
