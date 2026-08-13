"use client";

import { motion } from "framer-motion";
import { Mascot } from "@/components/brand/Mascot";
import type { ColdBeat } from "@/lib/cinematic";
import { useMotionCtx } from "@/src/motion/MotionProvider";

/**
 * One beat of the intro film. Regular beats slam in word-by-word (masked
 * y-reveals with a spring); the emphasis word lands as a stamped plate —
 * ink for threats, loss-red on the "stab" beat. Mascot and title beats keep
 * their own choreography. Reduced motion renders every word settled.
 */

function KineticLine({
  text,
  emphasis,
  tone,
  big,
  reduced,
}: {
  text: string;
  emphasis?: string;
  tone: "ink" | "loss";
  big: boolean;
  reduced: boolean;
}) {
  const words = text.split(" ");
  const isEmph = (w: string) => !!emphasis && w.replace(/[.,!?]/g, "") === emphasis;
  return (
    <motion.h2
      variants={{ show: { transition: { staggerChildren: reduced ? 0 : 0.085, delayChildren: 0.05 } } }}
      initial={reduced ? "show" : "hide"}
      animate="show"
      className={`display-caps max-w-5xl px-6 text-center leading-[1.04] text-ink ${
        big ? "text-6xl sm:text-8xl" : "text-5xl sm:text-7xl"
      }`}
    >
      {words.map((w, i) => (
        <span
          key={i}
          className="inline-block overflow-hidden pb-[0.08em] align-bottom"
          style={{ marginRight: i < words.length - 1 ? "0.26em" : 0 }}
        >
          <motion.span
            variants={{
              hide: { y: "112%" },
              show: { y: "0%" },
            }}
            transition={{ type: "spring", stiffness: 430, damping: 34 }}
            className={`inline-block ${
              isEmph(w)
                ? tone === "loss"
                  ? "bg-loss px-[0.18em] text-bg"
                  : "bg-ink px-[0.18em] text-bg"
                : ""
            }`}
          >
            {w}
          </motion.span>
        </span>
      ))}
    </motion.h2>
  );
}

export function Beat({ beat }: { beat: ColdBeat }) {
  const { reduced } = useMotionCtx();

  if (beat.accent === "title") {
    return (
      <div className="text-center">
        {/* The wordmark used to spring `letterSpacing` 0.3em → 0.02em alongside the
            scale, which re-shapes and re-lays-out the text run on every frame of the
            game's opening title. The tracking is now static and the same convergence
            is carried on the compositor: the extra tracking across 9 glyphs widened
            the word ~1.6×, so the stamp starts at scaleX 2.24 / scaleY 1.4 (1.6 × the
            original 1.4 uniform scale) and springs to 1/1 on the identical spring —
            same wide-and-huge → settled arrival, zero layout. */}
        <motion.h1
          initial={reduced ? false : { scaleX: 2.24, scaleY: 1.4, opacity: 0 }}
          animate={{ scaleX: 1, scaleY: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 140, damping: 12 }}
          className="display-caps text-[16vw] leading-[0.85] tracking-[0.02em] text-ink sm:text-[10rem]"
        >
          Life<span className="text-ink">patch</span>
        </motion.h1>
        <motion.p
          initial={reduced ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduced ? 0 : 0.4 }}
          className="voice mt-2 text-xl text-ink/70 sm:text-2xl"
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
          initial={reduced ? false : { scale: 0.5, rotate: -10, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 12 }}
          className="w-28 sm:w-36"
        >
          <Mascot mood="gloating" />
        </motion.div>
        <motion.p
          initial={reduced ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduced ? 0 : 0.25 }}
          className="display-caps max-w-2xl text-4xl text-ink sm:text-5xl"
        >
          {beat.text}
        </motion.p>
        <motion.span
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: reduced ? 0 : 0.5 }}
          className="eyebrow text-ink"
        >
          — The System
        </motion.span>
      </div>
    );
  }

  return (
    <KineticLine
      text={beat.text}
      emphasis={beat.emphasis}
      tone={beat.accent === "stab" ? "loss" : "ink"}
      big={beat.act === 1}
      reduced={reduced}
    />
  );
}
