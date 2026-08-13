"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAudio } from "@/hooks/useAudio";

/**
 * The mixer. Until now the only audio control in the game was a mute toggle with
 * the master pinned at one level — you could have the score or not have it, and
 * nothing in between. This is the missing volume: a real 0–100 level, persisted
 * under `lp_volume`, ramped through `AudioEngine.setVolume` (which never sets a
 * gain instantly — everything in the engine fades).
 *
 * It reuses the `.allocator` range styling from globals.css, so the fader reads
 * as the same instrument as the portfolio allocators: a 4px rule with a two-tone
 * fill and a square 12px thumb. Native `<input type="range">`, so arrows /
 * Home / End / PageUp / PageDown all work and it carries a real label.
 *
 * `data-no-skip` on the popover: the ceremonies' global input-skip fires on any
 * pointerdown, and reaching for the volume during the cold open must not end it.
 */

/** The fader itself — labelled, keyboard-operable, safe to drop anywhere. */
export function VolumeSlider({
  className = "",
  label = "Volume",
}: {
  className?: string;
  label?: string;
}) {
  const audio = useAudio();
  const id = useId();
  const pct = Math.round(audio.volume * 100);

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <label htmlFor={id} className="eyebrow text-secondary" style={{ fontSize: "0.52rem", letterSpacing: "0.18em" }}>
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        onChange={(e) => audio.setVolume(Number(e.target.value) / 100)}
        // the level survives muting, so the fader stays operable while muted —
        // it just reads as inactive until sound comes back on.
        className={`allocator w-24 cursor-pointer ${audio.muted ? "opacity-45" : ""}`}
        style={{ "--fill": `${pct}%` } as React.CSSProperties}
        aria-valuetext={`${pct} percent`}
      />
      <span className="num w-7 text-right text-tertiary" style={{ fontSize: "0.58rem" }}>
        {pct}
      </span>
    </div>
  );
}

/**
 * A small popover holding the mute toggle and the fader. The trigger is supplied
 * by the caller (the HUD rail's SOUND cell, the cinematic chrome's speaker), so
 * both surfaces get identical behaviour without sharing a look.
 */
export function VolumePopover({
  open,
  onClose,
  align = "right",
  muted,
  onToggleMute,
}: {
  open: boolean;
  onClose: () => void;
  align?: "left" | "right";
  muted: boolean;
  onToggleMute: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Node && ref.current && !ref.current.contains(t)) onClose();
    };
    window.addEventListener("keydown", onKey);
    // non-capture: the panel's own controls handle their events first
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      data-no-skip
      data-elevated=""
      className={`absolute top-full z-50 mt-px flex w-max items-center gap-3 border border-hairline-strong bg-bg2 px-3 py-2.5 ${
        align === "right" ? "right-0" : "left-0"
      }`}
    >
      <button
        type="button"
        onClick={onToggleMute}
        aria-pressed={muted}
        // ~20px tall by design; a `::before` layer takes the *hit* box to ~40px without
        // changing the look (same trick as cinematic/Controls.tsx). 10px is exactly the
        // popover's own py-2.5, so the expander fills the padding and stops at the panel
        // edge: near-misses land on Mute instead of leaking to the dismiss handler, and it
        // never steals a tap aimed outside the popover.
        className="eyebrow relative border border-hairline-strong px-2 py-1 text-ink-dim transition-colors hover:bg-ink hover:text-bg before:absolute before:inset-x-0 before:-inset-y-[10px] before:content-['']"
        style={{ fontSize: "0.52rem", letterSpacing: "0.16em" }}
      >
        {muted ? "Unmute" : "Mute"}
      </button>
      <VolumeSlider />
    </div>
  );
}

/** Open/close state + the a11y wiring a disclosure trigger needs. */
export function useVolumePopover() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  return {
    open,
    close,
    toggle,
    triggerProps: {
      "aria-expanded": open,
      "aria-haspopup": true as const,
    },
  };
}
