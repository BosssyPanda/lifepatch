"use client";

import { useId } from "react";

/** Empty / whitespace-only names fall back to this everywhere a player is named. */
export const DEFAULT_PLAYER_NAME = "PLAYER";

/** Trim and fall back — the one place the "what do we call an unnamed player" rule lives. */
export function playerName(raw: string): string {
  return raw.trim() || DEFAULT_PLAYER_NAME;
}

/**
 * The player-name input. Setup and CashflowSetup each had their own (different label, different
 * max length, different placeholder, different fallback), so the same player could be "You" in
 * one mode and "" in the other. One field, one cap, one fallback.
 */
export function NameField({
  value,
  onChange,
  label = "Your name",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="eyebrow text-ink-dim">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={DEFAULT_PLAYER_NAME}
        maxLength={24}
        data-radius=""
        className="mt-1.5 w-full border border-hairline-strong bg-bg2 px-3 py-2.5 font-body text-ink outline-none focus:border-ink placeholder:text-tertiary"
      />
    </div>
  );
}
