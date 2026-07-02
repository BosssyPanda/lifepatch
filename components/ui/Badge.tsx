import type { ReactNode } from "react";

// LEDGER: gain/loss for good/bad, neutral ink/secondary for the rest (no amber).
const TONE_HEX: Record<string, string> = {
  good: "#2bd576",
  bad: "#ff3b30",
  warning: "#8f8e85",
  neutral: "#8f8e85",
  accent: "#f2f1ea",
  Chill: "#2bd576",
  Normal: "#8f8e85",
  Brutal: "#ff3b30",
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
      className={`eyebrow inline-flex items-center gap-1 rounded-[2px] border px-2 py-0.5 ${className}`}
      style={{ color: hex, borderColor: `${hex}66` }}
    >
      {children}
    </span>
  );
}
