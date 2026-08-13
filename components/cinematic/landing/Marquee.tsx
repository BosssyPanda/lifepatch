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
    // Reduced motion turns the marquee into a scroller, which means a keyboard user has to be
    // able to reach and drive it — a scrollable region that cannot take focus is unusable
    // without a pointer (and axe flags exactly this). `group` + label make it announce as one
    // named region rather than a bare box.
    return (
      <div
        className={`thin-scroll flex items-stretch gap-4 overflow-x-auto ${className}`}
        role="group"
        aria-label={ariaLabel}
        tabIndex={0}
      >
        {children}
      </div>
    );
  }

  return (
    <div className={`group relative overflow-hidden ${className}`} role="marquee" aria-label={ariaLabel}>
      {/* `@keyframes ledger-marquee` lives in app/globals.css — it used to be injected
          here as a per-instance <style> tag, i.e. once per mounted marquee. */}
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
