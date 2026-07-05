"use client";

import { useEffect, useRef, useState } from "react";
import { useMotionCtx } from "@/src/motion/MotionProvider";

/**
 * VideoBeat — poster-first muted looping film clip for the cinematics.
 * The poster jpg renders immediately; the webm only mounts (and only
 * fetches — preload="none") once the beat arms via `active`. Reduced
 * motion, Save-Data, or a load error all mean the poster stays forever.
 * Clips are palette-locked b/w; grayscale filter guards against drift.
 */
export function VideoBeat({
  src,
  poster,
  active,
  className = "",
}: {
  src: string;
  poster: string;
  active: boolean;
  className?: string;
}) {
  const { reduced } = useMotionCtx();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [saveData, setSaveData] = useState(false);

  useEffect(() => {
    type ConnInfo = { saveData?: boolean };
    const conn = (navigator as Navigator & { connection?: ConnInfo }).connection;
    if (conn?.saveData) setSaveData(true);
  }, []);

  const wantVideo = active && !reduced && !failed && !saveData;

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !wantVideo) return;
    v.play().catch(() => setFailed(true));
  }, [wantVideo]);

  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      {/* poster persists under the video until (and unless) it plays */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={poster}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        style={{ filter: "grayscale(1)" }}
        draggable={false}
      />
      {wantVideo && (
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          muted
          loop
          playsInline
          preload="none"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ filter: "grayscale(1)" }}
        />
      )}
    </div>
  );
}
