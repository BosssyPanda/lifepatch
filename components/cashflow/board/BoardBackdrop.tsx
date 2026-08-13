"use client";

import { useEffect, useRef, useState } from "react";
import { useMotionCtx } from "@/src/motion/MotionProvider";

/**
 * Rat Race set-piece backdrop (Addendum A §9.2) — the pre-rendered Blender
 * turntable loop of the LEDGER board, layered BEHIND the functional 2D board
 * UI at low opacity. Gameplay never depends on it. Reduced motion (or a video
 * error) renders the poster still instead. The video pauses while the tab is
 * hidden. Assets are palette-locked to the LEDGER hexes (§10) and total well
 * under the 3MB budget (webm 633KB / mp4 858KB / poster 43KB).
 */
const BACKDROP_OPACITY = 0.22; // §6.2 band: 15–25%

export function BoardBackdrop() {
  const { reduced } = useMotionCtx();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);

  // Spare the decoder whenever nobody can see the loop: the tab being hidden was
  // already handled, but the board scrolls off screen constantly on mobile (the
  // statement column is taller than the viewport) and the video kept decoding the
  // whole time. Both conditions now feed one gate.
  useEffect(() => {
    if (reduced || failed) return;
    const v = videoRef.current;
    if (!v) return;
    let onScreen = true;
    const sync = () => {
      if (onScreen && document.visibilityState === "visible") void v.play().catch(() => {});
      else v.pause();
    };
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      onScreen = false;
      io = new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; sync(); }, { threshold: 0.05 });
      io.observe(v);
    }
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [reduced, failed]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {reduced || failed ? (
        <img
          src="/board3d/board-poster.jpg"
          alt=""
          className="h-full w-full object-cover"
          style={{ opacity: BACKDROP_OPACITY }}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          style={{ opacity: BACKDROP_OPACITY }}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster="/board3d/board-poster.jpg"
          onError={() => setFailed(true)}
        >
          <source src="/board3d/board-orbit.webm" type="video/webm" />
          <source src="/board3d/board-orbit.mp4" type="video/mp4" />
        </video>
      )}
    </div>
  );
}
