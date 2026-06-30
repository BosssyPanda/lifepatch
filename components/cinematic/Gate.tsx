"use client";

import { motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import type { PointerEvent } from "react";
import { DataAtlas } from "./DataAtlas";
import { MuteButton } from "./Controls";
import { EASE } from "@/lib/motion";

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

  // normalized pointer (−0.5..0.5), springed — drives layered parallax in DataAtlas
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 60, damping: 18 });
  const sy = useSpring(py, { stiffness: 60, damping: 18 });

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
          backgroundImage: "radial-gradient(circle at 1px 1px, rgba(168,159,140,0.16) 1px, transparent 0)",
          backgroundSize: "26px 26px",
          maskImage: "radial-gradient(110% 80% at 30% 45%, #000 30%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(110% 80% at 30% 45%, #000 30%, transparent 78%)",
        }}
      />

      {/* ---------------- HUD: corner brackets ---------------- */}
      <div aria-hidden className="pointer-events-none absolute inset-3 z-20 lg:inset-5">
        <span className="absolute left-0 top-0 h-7 w-7 border-l-2 border-t-2 border-accent/40 lg:h-10 lg:w-10" />
        <span className="absolute right-0 top-0 h-7 w-7 border-r-2 border-t-2 border-accent/40 lg:h-10 lg:w-10" />
        <span className="absolute bottom-0 left-0 h-7 w-7 border-b-2 border-l-2 border-accent/40 lg:h-10 lg:w-10" />
        <span className="absolute bottom-0 right-0 h-7 w-7 border-b-2 border-r-2 border-accent/40 lg:h-10 lg:w-10" />
      </div>

      {/* ---------------- HUD: index readout (top-left) ---------------- */}
      <div aria-hidden className="pointer-events-none absolute left-6 top-6 z-20 hidden items-center gap-2 lg:flex">
        <span className="num text-[0.7rem] text-accent">001</span>
        <span className="h-px w-8 bg-ink-dim/50" />
        <span className="eyebrow text-ink-dim/70" style={{ fontSize: "0.55rem" }}>Survive the Internet Economy</span>
      </div>

      <div className="absolute right-4 top-4 z-20">
        <MuteButton muted={muted} onToggle={onToggleMute} />
      </div>

      {/* ---------------- illustration ---------------- */}
      <motion.div
        initial={reduce ? false : { opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1, ease: EASE }}
        className="relative z-10 flex w-full max-w-[260px] shrink-0 justify-center overflow-hidden sm:max-w-[320px] lg:h-[90svh] lg:max-h-[900px] lg:w-auto lg:max-w-none"
      >
        <DataAtlas px={sx} py={sy} className="h-auto w-full lg:h-full lg:w-auto drop-shadow-[0_30px_60px_rgba(0,0,0,0.6)]" />
        {/* slow accent scanline sweep over the panel */}
        {!reduce && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent"
            initial={{ top: "8%" }}
            animate={{ top: ["8%", "92%", "8%"] }}
            transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
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

      {/* ---------------- HUD: footer status ticker ---------------- */}
      <div aria-hidden className="pointer-events-none absolute inset-x-6 bottom-5 z-20 hidden items-center justify-between lg:flex">
        <div className="flex items-center gap-3 text-ink-dim/55">
          <span className="eyebrow" style={{ fontSize: "0.55rem" }}>System · Active</span>
          <span className="flex items-end gap-0.5">
            {[5, 9, 4, 11, 7, 10, 6, 8].map((h, i) => (
              <span key={i} className="w-0.5 bg-ink-dim/40" style={{ height: `${h}px` }} />
            ))}
          </span>
          <span className="num text-[0.6rem]">V1.0</span>
        </div>
        <div className="flex items-center gap-2 text-ink-dim/55">
          <span className="eyebrow" style={{ fontSize: "0.55rem" }}>Rendering</span>
          {!reduce && (
            <span className="flex gap-1">
              {[0, 0.2, 0.4].map((d, i) => (
                <motion.span key={i} className="h-1 w-1 rounded-full bg-accent/70"
                  animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.4, repeat: Infinity, delay: d }} />
              ))}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
