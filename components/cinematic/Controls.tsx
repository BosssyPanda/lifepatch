"use client";

/**
 * Cinematic chrome. Both controls live in a screen corner at ~28px tall, well under the
 * 44px floor — a `::before` layer expands the *hit* box without touching the visual size,
 * the same trick LedgerButton uses. Skip is the only way out of a 20s ceremony, so it also
 * gets a real accessible name rather than relying on 9px type.
 */
const HIT = "before:absolute before:-inset-x-[8px] before:-inset-y-[9px] before:content-['']";

function Speaker({ muted }: { muted: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 9v6h4l5 4V5L8 9z" />
      {muted ? <path d="M17 9l5 5M22 9l-5 5" /> : <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8 8 0 0 1 0 12" />}
    </svg>
  );
}

export function MuteButton({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={muted ? "Unmute" : "Mute"}
      aria-pressed={muted}
      className={`pointer-events-auto relative flex items-center gap-1.5 border border-ink/25 bg-bg px-2.5 py-1.5 text-ink-dim transition-colors hover:border-ink hover:text-ink ${HIT}`}
    >
      <Speaker muted={muted} />
      <span className="eyebrow" style={{ fontSize: "0.56rem" }}>{muted ? "Muted" : "Sound"}</span>
    </button>
  );
}

export function SkipButton({ onSkip }: { onSkip: () => void }) {
  return (
    <button
      type="button"
      onClick={onSkip}
      aria-label="Skip ahead"
      className={`pointer-events-auto relative flex items-center gap-1.5 border border-ink/25 bg-bg px-3 py-1.5 text-ink-dim transition-colors hover:border-ink hover:text-ink ${HIT}`}
    >
      <span className="eyebrow" style={{ fontSize: "0.56rem" }}>Skip</span>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M5 5l8 7-8 7zM16 5v14" />
      </svg>
    </button>
  );
}
