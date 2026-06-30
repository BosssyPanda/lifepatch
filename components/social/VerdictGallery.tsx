"use client";

import { motion, useReducedMotion } from "framer-motion";
import { VERDICT_GALLERY, type Verdict } from "@/lib/verdict";

/**
 * Landing social proof: the six end-of-run verdicts every player can earn,
 * shown as a drifting marquee of stamps. Static data (no cloud) so it never
 * reads as an empty leaderboard. Compositor-only transform drift; under
 * reduced motion it collapses to a static, wrapped grid.
 */

function VerdictTile({ v }: { v: Verdict }) {
  return (
    <div
      className="flex shrink-0 flex-col gap-1 rounded-[5px] border-[2px] px-5 py-3"
      style={{ borderColor: v.hex, color: v.hex, boxShadow: `0 0 0 5px ${v.hex}14` }}
    >
      <span className="eyebrow" style={{ opacity: 0.6, fontSize: "0.5rem" }}>
        {v.good ? "Verdict · won" : "Verdict"}
      </span>
      <span className="display-caps whitespace-nowrap text-xl leading-none sm:text-2xl">{v.title}</span>
    </div>
  );
}

export function VerdictGallery() {
  const reduce = useReducedMotion();

  if (reduce) {
    return (
      <div className="flex flex-wrap justify-center gap-3">
        {VERDICT_GALLERY.map((v) => (
          <VerdictTile key={v.title} v={v} />
        ))}
      </div>
    );
  }

  // two back-to-back copies → a seamless −50% loop
  const track = [...VERDICT_GALLERY, ...VERDICT_GALLERY];
  return (
    <div
      className="relative overflow-hidden"
      style={{
        maskImage: "linear-gradient(to right, transparent, #000 12%, #000 88%, transparent)",
        WebkitMaskImage: "linear-gradient(to right, transparent, #000 12%, #000 88%, transparent)",
      }}
    >
      <motion.div
        className="flex w-max gap-4"
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration: 30, ease: "linear", repeat: Infinity }}
      >
        {track.map((v, i) => (
          <VerdictTile key={`${v.title}-${i}`} v={v} />
        ))}
      </motion.div>
    </div>
  );
}
