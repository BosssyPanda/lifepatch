"use client";

import { useEffect, useState } from "react";
import { useAudio } from "@/hooks/useAudio";

/**
 * Phase M2 — the persistent chrome strip over both game modes (phantom.land
 * instrument rail): MODE · COUNTER · LOCAL TIME · SOUND in mono cells. Reads
 * existing state only; the sound cell is the one live control (audio.setMuted,
 * persisted by the audio provider). Local time renders after mount so server
 * and client HTML never disagree. Flat bg, hairline dividers — no blur.
 */
export function HudRail({ mode, counter, className = "" }: { mode: string; counter: string; className?: string }) {
  const audio = useAudio();
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const tick = () =>
      setTime(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const cell = "flex h-8 items-center px-3 num";
  const type = { fontSize: "0.6rem", letterSpacing: "0.16em" } as const;

  return (
    <div className={`sticky top-0 z-50 flex items-stretch border-b border-hairline bg-bg ${className}`} aria-label="Run status">
      <span className={`${cell} border-r border-hairline text-ink`} style={type}>
        {mode.toUpperCase()}
      </span>
      <span className={`${cell} border-r border-hairline text-secondary`} style={type}>
        {counter.toUpperCase()}
      </span>
      <span className={`${cell} hidden text-tertiary sm:flex`} style={type}>
        LOCAL {time ?? "--:--"}
      </span>
      <button
        type="button"
        onClick={() => audio.setMuted(!audio.muted)}
        aria-pressed={!audio.muted}
        aria-label={audio.muted ? "Turn sound on" : "Turn sound off"}
        className={`${cell} ml-auto border-l border-hairline transition-colors hover:bg-ink hover:text-bg ${
          audio.muted ? "text-tertiary" : "text-ink"
        }`}
        style={type}
      >
        SOUND {audio.muted ? "OFF" : "ON"}
      </button>
    </div>
  );
}
