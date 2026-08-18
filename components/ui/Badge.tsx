import type { ReactNode } from "react";
import { PALETTE } from "@/lib/palette";

// LEDGER: gain/loss for good/bad, neutral ink/secondary for the rest (no amber).
const TONE_HEX: Record<string, string> = {
  good: PALETTE.gain,
  bad: PALETTE.loss,
  warning: PALETTE.secondary,
  neutral: PALETTE.secondary,
  accent: PALETTE.ink,
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
