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
  // Touch target: the rail is 32px by design (three read-only cells share its dividers, so
  // growing the buttons would break the hairlines), so a `::before` layer expands the *hit*
  // box to 44px instead — same trick as cinematic/Controls.tsx. `relative` is part of the
  // string because the buttons' only positioned ancestor is the whole sound group, where the
  // expander would size to the group and SOUND's hit box would swallow VOL. Vertical only
  // (`inset-x-0`), because the two buttons are horizontally adjacent.
  const HIT = "relative before:absolute before:inset-x-0 before:-inset-y-[6px] before:content-['']";

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
      {/* The counter is the one cell that is LIVE — the turn/year the run is standing
          on right now — so it carries the accent and the rest of the rail stays ink.
          6.04:1 on bg; it is also the cell the live region announces. */}
      <span className={`${cell} border-r border-hairline text-accent`} style={type}>
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
          // No aria-label: the visible "SOUND ON" / "SOUND OFF" text is the name, so the
          // name is state-phrased and agrees with aria-pressed (pressed = sound is on). An
          // action-phrased label ("Turn sound off") announced the opposite of the state and
          // broke voice control (WCAG 2.5.3), since the spoken words weren't in the name.
          aria-pressed={!audio.muted}
          className={`${cell} ${HIT} transition-colors hover:bg-ink hover:text-bg ${
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
          className={`${cell} ${HIT} border-l border-hairline transition-colors hover:bg-ink hover:text-bg ${
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
