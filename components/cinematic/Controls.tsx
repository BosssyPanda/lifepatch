"use client";

import { VolumePopover, useVolumePopover } from "@/components/ui/VolumeControl";

/**
 * Cinematic chrome. Both controls live in a screen corner at ~28px tall, well under the
 * 44px floor — a `::before` layer expands the *hit* box without touching the visual size,
 * the same trick LedgerButton uses. Skip is the only way out of a 20s ceremony, so it also
 * gets a real accessible name rather than relying on 9px type.
 *
 * The speaker carries a level control now, not just an on/off: a second cell opens the
 * shared volume popover. Mute stays exactly where it was — one click, same label — so the
 * cheap escape from a loud film is never more than one press away.
 */
const HIT = "before:absolute before:-inset-x-[8px] before:-inset-y-[9px] before:content-['']";
/**
 * The shared shell for all three cells. Hoisted because the border token drifted
 * once already: the Vol cell was hand-written against `border-ink/25` (~2.1:1)
 * after the rest had moved on, and an operable control's boundary owes 3:1
 * (WCAG 1.4.11 / DESIGN.md § Palette — `hairline-strong`). One string, no drift.
 */
const CHROME = `relative flex items-center border border-hairline-strong transition-colors hover:border-ink hover:text-ink ${HIT}`;

function Speaker({ muted }: { muted: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 9v6h4l5 4V5L8 9z" />
      {muted ? <path d="M17 9l5 5M22 9l-5 5" /> : <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8 8 0 0 1 0 12" />}
    </svg>
  );
}

export function MuteButton({
  muted,
  onToggle,
  volume = true,
}: {
  muted: boolean;
  onToggle: () => void;
  /** Set false to render the bare toggle (no level popover). */
  volume?: boolean;
}) {
  const vol = useVolumePopover();
  return (
    <div className="pointer-events-auto relative flex items-stretch">
      <button
        type="button"
        onClick={onToggle}
        aria-label={muted ? "Unmute" : "Mute"}
        aria-pressed={muted}
        className={`${CHROME} gap-1.5 bg-bg px-2.5 py-1.5 text-ink-dim`}
      >
        <Speaker muted={muted} />
        <span className="eyebrow" style={{ fontSize: "0.56rem" }}>{muted ? "Muted" : "Sound"}</span>
      </button>
      {volume && (
        <>
          <button
            type="button"
            onClick={vol.toggle}
            {...vol.triggerProps}
            aria-label="Volume"
            className={`${CHROME} border-l-0 px-2 py-1.5 ${
              vol.open ? "bg-ink text-bg" : "bg-bg text-ink-dim"
            }`}
          >
            <span className="eyebrow" style={{ fontSize: "0.56rem" }}>Vol</span>
          </button>
          <VolumePopover open={vol.open} onClose={vol.close} muted={muted} onToggleMute={onToggle} />
        </>
      )}
    </div>
  );
}

export function SkipButton({ onSkip }: { onSkip: () => void }) {
  return (
    <button
      type="button"
      onClick={onSkip}
      aria-label="Skip ahead"
      className={`pointer-events-auto ${CHROME} gap-1.5 bg-bg px-3 py-1.5 text-ink-dim`}
    >
      <span className="eyebrow" style={{ fontSize: "0.56rem" }}>Skip</span>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M5 5l8 7-8 7zM16 5v14" />
      </svg>
    </button>
  );
}
