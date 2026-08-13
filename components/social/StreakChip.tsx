"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { FlameIcon } from "@/components/icons";
import { useAudio } from "@/hooks/useAudio";
import { useProfile } from "@/hooks/useProfile";
import { todayStr } from "@/lib/cloud/streaks";
import { useMotionCtx } from "@/src/motion/MotionProvider";

/** Once-a-day guard so the streak only celebrates on the first menu after a play. */
const CELEB_KEY = "lifepatch.streakCelebrated";

/**
 * Loss-aversion habit cue: the player's current daily streak. At zero it renders an
 * invisible copy of itself rather than `null`, so ModeSelect doesn't jump a whole row
 * the first time a streak lands.
 */
export function StreakChip() {
  const { streak } = useProfile();
  const { accent, started } = useAudio();
  const { reduced: reduce } = useMotionCtx();
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

  if (current <= 0) {
    return (
      <span aria-hidden className="invisible inline-flex items-center gap-1.5 border border-transparent px-3 py-1 text-sm">
        <FlameIcon size={14} />
        <span className="display-caps tracking-[0.1em]">0</span>
        <span>days</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 border border-ink/40 bg-bg2/70 px-3 py-1 text-sm">
      <motion.span
        aria-hidden
        animate={pulse && !reduce ? { scale: [1, 1.55, 1], rotate: [0, -12, 10, 0] } : { scale: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="text-ink"
      >
        <FlameIcon size={14} />
      </motion.span>
      {/* the outer span is role=generic, where ARIA forbids a name — so the label is text */}
      <span className="sr-only">Daily streak: </span>
      <span className="display-caps tracking-[0.1em] text-ink">{current}</span>
      <span className="text-ink-dim">day{current === 1 ? "" : "s"}</span>
    </span>
  );
}
