"use client";

import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import type { PointerEvent } from "react";
import { DataAtlas } from "./DataAtlas";
import { MuteButton } from "./Controls";

export function Gate({
  onBegin,
  muted,
  onToggleMute,
}: {
  onBegin: () => void;
  muted: boolean;
  onToggleMute: () => void;
}) {
  const reduce = useReducedMotion();

  // subtle pointer parallax on the illustration
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 60, damping: 18 });
  const sy = useSpring(py, { stiffness: 60, damping: 18 });
  const tx = useTransform(sx, [-0.5, 0.5], [-14, 14]);
  const ty = useTransform(sy, [-0.5, 0.5], [-10, 10]);

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
  };

  return (
    <div
      onPointerMove={onMove}
      className="relative flex min-h-[100svh] w-full flex-col items-center justify-center gap-6 overflow-hidden px-6 py-16 lg:flex-row lg:items-center lg:justify-center lg:gap-10 lg:px-16"
    >
      {/* faint blueprint grid wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(168,159,140,0.16) 1px, transparent 0)",
          backgroundSize: "26px 26px",
          maskImage: "radial-gradient(110% 80% at 30% 45%, #000 30%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(110% 80% at 30% 45%, #000 30%, transparent 78%)",
        }}
      />

      <div className="absolute right-4 top-4 z-20">
        <MuteButton muted={muted} onToggle={onToggleMute} />
      </div>

      {/* ---------------- illustration ---------------- */}
      <motion.div
        initial={reduce ? false : { opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1, ease: [0.2, 0.65, 0.3, 0.9] }}
        style={{ x: tx, y: ty }}
        className="relative z-10 flex w-full max-w-[300px] shrink-0 justify-center sm:max-w-[360px] lg:w-[46%] lg:max-w-[560px]"
      >
        <DataAtlas className="h-auto w-full drop-shadow-[0_30px_60px_rgba(0,0,0,0.6)]" />
      </motion.div>

      {/* ---------------- title block ---------------- */}
      <div className="relative z-10 flex w-full max-w-xl flex-col items-center text-center lg:items-start lg:text-left">
        <motion.p
          initial={reduce ? false : { opacity: 0, y: 10, letterSpacing: "0.5em" }}
          animate={{ opacity: 1, y: 0, letterSpacing: "0.28em" }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="eyebrow text-accent"
        >
          A Financial Survival Story
        </motion.p>

        <motion.h1
          initial={reduce ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32, type: "spring", stiffness: 150, damping: 18 }}
          className="display-caps mt-4 text-[19vw] leading-[0.82] sm:text-[14vw] lg:text-[clamp(4.5rem,8vw,9rem)]"
        >
          <span className="text-ink">Life</span>
          <span className="text-accent">patch</span>
        </motion.h1>

        <motion.button
          type="button"
          onClick={onBegin}
          initial={reduce ? false : { opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.55, type: "spring", stiffness: 220, damping: 16 }}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          className="group mt-9 flex items-center gap-3 rounded-[4px] border-2 border-accent bg-accent/5 px-9 py-4 text-accent transition-colors hover:bg-accent hover:text-bg"
        >
          <motion.span
            animate={reduce ? undefined : { scale: [1, 1.18, 1] }}
            transition={{ duration: 1.6, repeat: Infinity }}
            className="grid place-items-center"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M7 4l13 8-13 8z" />
            </svg>
          </motion.span>
          <span className="display-caps text-xl tracking-[0.2em]">Begin</span>
        </motion.button>

        <motion.p
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9 }}
          className="mt-6 font-serif text-sm italic text-ink-dim"
        >
          Best with sound on. Headphones recommended.
        </motion.p>
      </div>
    </div>
  );
}
