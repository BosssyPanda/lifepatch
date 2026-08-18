import type { ReactNode } from "react";
import { PALETTE } from "@/lib/palette";

// LEDGER: gain/loss for good/bad, neutral ink/secondary for the rest (no amber).
//
// There is no `accent` tone, deliberately. The token of that name is now the safety
// orange, which marks the primary path and what is live — never a label on a chip.
// The tone that used to be called `accent` was PALETTE.ink all along and is named
// `ink` now, so the two can't be confused into painting a badge orange.
const TONE_HEX: Record<string, string> = {
  good: PALETTE.gain,
  bad: PALETTE.loss,
  warning: PALETTE.secondary,
  neutral: PALETTE.secondary,
  ink: PALETTE.ink,
  Chill: PALETTE.gain,
  Normal: PALETTE.secondary,
  Brutal: PALETTE.loss,
};

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: keyof typeof TONE_HEX | string;
  className?: string;
}) {
  const hex = TONE_HEX[tone] ?? TONE_HEX.neutral;
  return (
    <span
      className={`eyebrow inline-flex items-center gap-1 border px-2 py-0.5 ${className}`}
      style={{ color: hex, borderColor: `${hex}66` }}
    >
      {children}
    </span>
  );
}
