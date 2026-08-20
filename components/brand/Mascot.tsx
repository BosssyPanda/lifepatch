"use client";

import { motion } from "framer-motion";
import { useEffect, useRef } from "react";
import type { Tone } from "@/lib/types";
import { useMotionCtx } from "@/src/motion/MotionProvider";

export type MascotMood = "idle" | "smug" | "gloating" | "rattled" | "defeated";

export function moodFromTone(tone: Tone | null | undefined): MascotMood {
  switch (tone) {
    case "good":
      return "rattled"; // the System hates it when you win
    case "bad":
      return "gloating";
    case "warning":
      return "smug";
    default:
      return "idle";
  }
}

/**
 * One path per mood, and they are NOT interpolated into each other.
 *
 * These shapes do not share a command structure — `gloating` is two cubics where
 * `idle` is one and `defeated` is a straight `h` — so tweening the `d` attribute
 * between them fed the browser `d="undefined"` for the length of the transition
 * (an SVG error on every mood change, and a momentarily featureless face). A mood
 * is a cut, not a morph: the path is re-keyed and the new face fades in, which is
 * compositor-only work and never emits an invalid path.
 */
const MOUTHS: Record<MascotMood, string> = {
  idle: "M78 150c8 6 36 6 44 0",
  smug: "M78 150c10 9 34 9 44 -2",
  gloating: "M76 146c10 16 38 16 48 0 -12 6 -36 6 -48 0",
  rattled: "M80 156c8 -7 32 -7 40 0",
  defeated: "M80 154h40",
};

const BROWS: Record<MascotMood, string> = {
  idle: "M70 116l20 4 M130 120l-20 0",
  smug: "M68 112l22 6 M132 122l-22 -2",
  gloating: "M68 110l22 4 M132 110l-22 4",
  rattled: "M70 122l20 -6 M130 116l-20 6",
  defeated: "M70 120l20 0 M130 120l-20 0",
};

export function Mascot({
  mood = "idle",
  className = "",
  bob = true,
}: {
  mood?: MascotMood;
  className?: string;
  bob?: boolean;
}) {
  const { reduced } = useMotionCtx();
  const idle = bob && !reduced;

  // Only a CHANGE of face is worth animating: the first one to be painted is simply
  // the face this mascot has, and fading it in would blink on every mount.
  const prevMood = useRef<MascotMood>(mood);
  const faceIn = prevMood.current !== mood && !reduced ? { opacity: 0 } : false;
  useEffect(() => {
    prevMood.current = mood;
  }, [mood]);

  return (
    <motion.svg
      viewBox="0 0 200 250"
      className={className}
      role="img"
      aria-label="The System, a top-hat money baron"
      initial={false}
      // `reduced` is false through first paint (MotionProvider's hydration gate) and
      // promotes after mount, so the loop is already running by then. Dropping to
      // `undefined` would only abandon it, freezing a residual transform mid-bob —
      // an explicit rest target is what the promote animates back to.
      animate={idle ? { y: [0, -4, 0], rotate: [0, -0.6, 0] } : { y: 0, rotate: 0 }}
      transition={idle ? { duration: 5, repeat: Infinity, ease: "easeInOut" } : { duration: 0 }}
    >
      {/* shoulders / suit */}
      <path
        d="M30 250c0-34 28-52 70-52s70 18 70 52z"
        fill="var(--color-bg2)"
        stroke="var(--color-ink)"
        strokeWidth="2.5"
      />
      {/* lapels */}
      <path d="M84 205l16 18 16-18" fill="none" stroke="var(--color-ink)" strokeWidth="2.5" />
      {/* bow tie */}
      <path
        d="M88 206l12 8 12-8-12-6z"
        fill="var(--color-ink)"
        stroke="var(--color-ink)"
        strokeWidth="2"
      />
      {/* neck */}
      <rect x="88" y="182" width="24" height="22" fill="var(--color-bg)" stroke="var(--color-ink)" strokeWidth="2" />

      {/* head */}
      <path
        d="M62 120c0-30 14-48 38-48s38 18 38 48c0 34-18 56-38 56s-38-22-38-56z"
        fill="var(--color-bg)"
        stroke="var(--color-ink)"
        strokeWidth="2.5"
      />

      {/* hat */}
      <g stroke="var(--color-ink)" strokeWidth="2.5" strokeLinejoin="round">
        <path d="M50 88c8-6 92-6 100 0l-6 6c-12 5-76 5-88 0z" fill="var(--color-bg)" />
        <path d="M64 88l4-46c0-6 60-6 64 0l4 46" fill="var(--color-bg)" />
        <path d="M66 64c14 5 54 5 68 0" fill="none" stroke="var(--color-ink)" strokeWidth="6" />
      </g>

      {/* eyes */}
      <motion.g animate={{ opacity: 1 }}>
        <circle cx="82" cy="132" r="4.2" fill="var(--color-ink)" />
        {/* monocle */}
        <circle cx="118" cy="132" r="9" fill="none" stroke="var(--color-secondary)" strokeWidth="2.5" />
        <circle cx="118" cy="132" r="3.4" fill="var(--color-ink)" />
        <path d="M126 138l6 18" stroke="var(--color-secondary)" strokeWidth="2" />
      </motion.g>

      {/* brows */}
      <motion.path
        key={`brow-${mood}`}
        d={BROWS[mood]}
        stroke="var(--color-ink)"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        initial={faceIn}
        animate={{ opacity: 1 }}
        transition={{ duration: reduced ? 0 : 0.18 }}
      />

      {/* mustache */}
      <path
        d="M84 142c4 4 28 4 32 0"
        stroke="var(--color-ink)"
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
      />

      {/* mouth */}
      <motion.path
        key={`mouth-${mood}`}
        d={MOUTHS[mood]}
        stroke="var(--color-ink)"
        strokeWidth="3"
        fill={mood === "gloating" ? "var(--color-loss)" : "none"}
        strokeLinecap="round"
        initial={faceIn}
        animate={{ opacity: 1 }}
        transition={{ duration: reduced ? 0 : 0.18 }}
      />
      {/* gold tooth on a grin */}
      {(mood === "smug" || mood === "gloating") && (
        <rect x="96" y="150" width="6" height="6" fill="var(--color-secondary)" />
      )}
      {/* sweat when rattled — the only visual tell for this mood, so reduced motion
          settles it in place rather than removing it. */}
      {mood === "rattled" && (
        <motion.path
          d="M140 120c0 6-4 8-4 12a4 4 0 0 0 8 0c0-4-4-6-4-12z"
          fill="var(--color-tertiary)"
          initial={reduced ? { y: 0, opacity: 1 } : { y: -4, opacity: 0 }}
          animate={reduced ? { y: 0, opacity: 1 } : { y: 4, opacity: 1 }}
          transition={reduced ? { duration: 0 } : { repeat: Infinity, repeatType: "reverse", duration: 1 }}
        />
      )}
    </motion.svg>
  );
}
