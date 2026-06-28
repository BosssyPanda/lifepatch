import type { ReactNode } from "react";

const TONE_HEX: Record<string, string> = {
  good: "#7f8b52",
  bad: "#a33218",
  warning: "#c8861e",
  neutral: "#a89f8c",
  accent: "#d4541e",
  Chill: "#7f8b52",
  Normal: "#c8861e",
  Brutal: "#a33218",
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
