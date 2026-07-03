"use client";

import type { ReactNode } from "react";
import { useMotionCtx } from "@/src/motion/MotionProvider";

/**
 * Generic LEDGER marquee — a translateX keyframe loop of a duplicated row
 * (the TitleTicker pattern, generalized). CSS-driven so hover can pause via
 * animation-play-state without restarting the loop. Reduced motion renders
 * one static row. Compositor-only.
 */
export function Marquee({
  children,
  seconds = 42,
  className = "",
  ariaLabel,
}: {
  children: ReactNode;
  seconds?: number;
  className?: string;
  ariaLabel?: string;
}) {
  const { reduced } = useMotionCtx();

  if (reduced) {
    return (
      <div className={`flex items-stretch gap-4 overflow-x-auto ${className}`} aria-label={ariaLabel}>
        {children}
      </div>
    );
  }

  return (
    <div className={`group relative overflow-hidden ${className}`} role="marquee" aria-label={ariaLabel}>
      <style>{`
        @keyframes ledger-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      `}</style>
      <div
        className="flex w-max items-stretch will-change-transform group-hover:[animation-play-state:paused]"
        style={{ animation: `ledger-marquee ${seconds}s linear infinite` }}
      >
        <div className="flex shrink-0 items-stretch gap-4 pr-4">{children}</div>
        <div className="flex shrink-0 items-stretch gap-4 pr-4" aria-hidden>
          {children}
        </div>
      </div>
    </div>
  );
}
