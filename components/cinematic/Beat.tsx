"use client";

import { motion } from "framer-motion";
import { Mascot } from "@/components/brand/Mascot";
import type { ColdBeat } from "@/lib/cinematic";

function Emphasized({ text, word }: { text: string; word?: string }) {
  if (!word || !text.includes(word)) return <>{text}</>;
  const [a, b] = text.split(word);
  return (
    <>
      {a}
      <span className="text-accent">{word}</span>
      {b}
    </>
  );
}

export function Beat({ beat }: { beat: ColdBeat }) {
  if (beat.accent === "title") {
    return (
      <div className="text-center">
        <motion.h1
          initial={{ scale: 1.4, opacity: 0, letterSpacing: "0.3em" }}
          animate={{ scale: 1, opacity: 1, letterSpacing: "0.02em" }}
          transition={{ type: "spring", stiffness: 140, damping: 12 }}
          className="display-caps text-[16vw] leading-[0.85] text-ink sm:text-[10rem]"
        >
          Life<span className="text-accent">patch</span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mt-2 font-serif text-xl italic text-ink/70 sm:text-2xl"
        >
          Survive the Internet Economy
        </motion.p>
      </div>
    );
  }

  if (beat.mascot) {
    return (
      <div className="flex flex-col items-center gap-5 text-center">
        <motion.div
          initial={{ scale: 0.5, rotate: -10, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 12 }}
          className="w-28 sm:w-36"
        >
          <Mascot mood="gloating" />
        </motion.div>
        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="display-caps max-w-2xl text-4xl text-ink sm:text-5xl"
        >
          {beat.text}
        </motion.p>
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="eyebrow text-accent"
        >
          — The System
        </motion.span>
      </div>
    );
  }

  return (
    <motion.h2
      initial={{ scale: 1.18, opacity: 0, y: 16 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ type: "spring", stiffness: 260, damping: 16 }}
      className="display-caps max-w-4xl px-6 text-center text-5xl leading-[1.02] text-ink sm:text-7xl"
    >
      <Emphasized text={beat.text} word={beat.emphasis} />
    </motion.h2>
  );
}
