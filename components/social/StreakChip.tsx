"use client";

import { useProfile } from "@/hooks/useProfile";

/** Loss-aversion habit cue: the player's current daily streak. Hidden at zero. */
export function StreakChip() {
  const { streak } = useProfile();
  const current = streak?.current ?? 0;
  if (current <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-bg2/70 px-3 py-1 text-sm">
      <span aria-hidden>🔥</span>
      <span className="display-caps tracking-[0.1em] text-accent">{current}</span>
      <span className="text-ink-dim">day{current === 1 ? "" : "s"}</span>
    </span>
  );
}
