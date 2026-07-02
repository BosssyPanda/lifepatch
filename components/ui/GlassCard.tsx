import type { ReactNode } from "react";

/** SPENT-style document card. `paper` = cream dossier, `dark` = charcoal panel. */
export function PaperCard({
  children,
  variant = "paper",
  className = "",
}: {
  children: ReactNode;
  variant?: "paper" | "dark";
  className?: string;
}) {
  if (variant === "dark") {
    return (
      <div className={`border border-hairline bg-bg2 ${className}`}>{children}</div>
    );
  }
  return <div className={`paper ${className}`}>{children}</div>;
}

// Back-compat alias.
export const GlassCard = PaperCard;
