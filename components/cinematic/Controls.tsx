"use client";

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
      className="pointer-events-auto flex items-center gap-1.5 rounded-[3px] border border-ink/25 bg-bg/60 px-2.5 py-1.5 text-ink-dim backdrop-blur-sm transition-colors hover:border-accent hover:text-accent"
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
      className="pointer-events-auto flex items-center gap-1.5 rounded-[3px] border border-ink/25 bg-bg/60 px-3 py-1.5 text-ink-dim backdrop-blur-sm transition-colors hover:border-accent hover:text-accent"
    >
      <span className="eyebrow" style={{ fontSize: "0.56rem" }}>Skip</span>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M5 5l8 7-8 7zM16 5v14" />
      </svg>
    </button>
  );
}
