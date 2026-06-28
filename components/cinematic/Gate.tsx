"use client";

import { motion } from "framer-motion";
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
  return (
    <div className="relative flex min-h-[100svh] flex-col items-center justify-center px-5 text-center">
      <div className="absolute right-4 top-4 z-10">
        <MuteButton muted={muted} onToggle={onToggleMute} />
      </div>

      <motion.p
        initial={{ opacity: 0, letterSpacing: "0.5em" }}
        animate={{ opacity: 1, letterSpacing: "0.28em" }}
        transition={{ duration: 0.9 }}
        className="eyebrow text-accent"
      >
        A financial survival story
      </motion.p>

      <motion.h1
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, type: "spring", stiffness: 160, damping: 18 }}
        className="display-caps mt-3 text-[18vw] leading-[0.85] text-ink sm:text-[9rem]"
      >
        Life<span className="text-accent">patch</span>
      </motion.h1>

      <motion.button
        type="button"
        onClick={onBegin}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.5, type: "spring", stiffness: 240, damping: 16 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.97 }}
        className="group mt-10 flex items-center gap-3 rounded-[4px] border-2 border-accent bg-accent/10 px-8 py-4 text-accent transition-colors hover:bg-accent hover:text-bg"
      >
        <motion.span
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ duration: 1.6, repeat: Infinity }}
          className="grid place-items-center"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M7 4l13 8-13 8z" /></svg>
        </motion.span>
        <span className="display-caps text-xl tracking-[0.18em]">Begin</span>
      </motion.button>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="mt-6 font-serif text-sm italic text-ink-dim"
      >
        Best with sound on. Headphones recommended.
      </motion.p>
    </div>
  );
}
