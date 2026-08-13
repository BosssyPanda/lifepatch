"use client";

import { useEffect, useState } from "react";
import { useAudio } from "@/hooks/useAudio";
import { VolumePopover, useVolumePopover } from "./VolumeControl";

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
  const vol = useVolumePopover();

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
    // role="status": `aria-label` on a plain div is dropped by most screen readers, so
    // the rail had no name and its counter never announced. `aria-atomic="false"` keeps
    // it to the cell that actually changed (the turn/year counter) instead of re-reading
    // the whole strip; the clock is ambient chrome and stays out of the tree entirely.
    <div
      className={`sticky top-0 z-50 flex items-stretch border-b border-hairline bg-bg ${className}`}
      role="status"
      aria-live="polite"
      aria-atomic="false"
      aria-label="Run status"
    >
      <span className={`${cell} border-r border-hairline text-ink`} style={type}>
        {mode.toUpperCase()}
      </span>
      <span className={`${cell} border-r border-hairline text-secondary`} style={type}>
        {counter.toUpperCase()}
      </span>
      <span aria-hidden className={`${cell} hidden text-tertiary sm:flex`} style={type}>
        LOCAL {time ?? "--:--"}
      </span>
      {/* Sound cell: the mute toggle stays a one-click control, and the level
          lives in a small popover next to it (the rail has no room for a fader
          and the mixer is not a thing you reach for every turn). */}
      {/* aria-live="off": the rail is a live region for the turn counter, and a
          popover opening is not a status change worth announcing. */}
      <div aria-live="off" className="relative ml-auto flex items-stretch border-l border-hairline">
        <button
          type="button"
          onClick={() => audio.setMuted(!audio.muted)}
          aria-pressed={!audio.muted}
          aria-label={audio.muted ? "Turn sound on" : "Turn sound off"}
          className={`${cell} transition-colors hover:bg-ink hover:text-bg ${
            audio.muted ? "text-tertiary" : "text-ink"
          }`}
          style={type}
        >
          SOUND {audio.muted ? "OFF" : "ON"}
        </button>
        <button
          type="button"
          onClick={vol.toggle}
          {...vol.triggerProps}
          aria-label="Volume"
          className={`${cell} border-l border-hairline px-2 transition-colors hover:bg-ink hover:text-bg ${
            vol.open ? "bg-ink text-bg" : "text-tertiary"
          }`}
          style={type}
        >
          VOL {Math.round(audio.volume * 100)}
        </button>
        <VolumePopover
          open={vol.open}
          onClose={vol.close}
          muted={audio.muted}
          onToggleMute={() => audio.setMuted(!audio.muted)}
        />
      </div>
    </div>
  );
}
