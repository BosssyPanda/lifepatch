"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAudio } from "@/hooks/useAudio";
import { currency } from "@/lib/format";
import type { BigMarketEvent, YearRecord } from "@/lib/runEngine";
import { DUR, EASE } from "@/src/motion/tokens";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { useSkippable } from "@/src/motion/useSkippable";

/**
 * Phase-3 "big market event" ceremony — when the market crashes (or booms) the
 * whole screen becomes the caption: huge centered MARKET CRASH text, the index
 * move, and what it did to the player's money. Deliberately NOT a jumpscare
 * (tester note): everything fades/settles in over ~0.7s with a slow musical
 * swell — no slam, no flash. The score's mood shift (setMarketMood) is owned by
 * YearLoop so it persists after this overlay closes.
 */

const TONE: Record<BigMarketEvent["kind"], string> = {
  crash: "var(--color-loss)",
  boom: "var(--color-gain)",
};

export function MarketEventBeat({
  record,
  event,
  onDone,
}: {
  record: YearRecord;
  event: BigMarketEvent;
  onDone: () => void;
}) {
  const audio = useAudio();
  const { reduced } = useMotionCtx();
  const crash = event.kind === "crash";
  const delta = record.portfolioDelta;

  const [done, setDone] = useState(reduced);
  const timers = useRef<number[]>([]);

  // lock body scroll while the overlay owns the screen
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // one slow musical land (grid-quantized inside the engine), then settle
  useEffect(() => {
    const pending = timers.current;
    audio.accent(crash ? "crash" : "boom");
    if (!reduced) pending.push(window.setTimeout(() => setDone(true), 2200));
    return () => pending.forEach(clearTimeout);
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const skip = useCallback(() => {
    if (done) {
      onDone();
      return;
    }
    timers.current.forEach(clearTimeout);
    setDone(true);
  }, [done, onDone]);

  // any input fast-forwards the settle; Continue below owns advancing
  useSkippable(!done, skip);

  const moneyLine = crash
    ? delta < 0
      ? { label: "Your money", figure: `−${currency(Math.abs(delta))}`, note: "That's what this year took from your portfolio." }
      : { label: "Your money", figure: `+${currency(delta)}`, note: "You were barely exposed. Sometimes boring saves you." }
    : delta > 0
      ? { label: "Your money", figure: `+${currency(delta)}`, note: "That's what this year handed your portfolio." }
      : { label: "Your money", figure: currency(0), note: "You had almost nothing invested to catch it." };

  const fade = (delay: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: DUR.scene, ease: EASE, delay },
        };

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={crash ? "Market crash" : "Market boom"}
      className="fixed inset-0 z-[90] flex flex-col bg-bg text-ink"
      initial={reduced ? undefined : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
      onClick={skip}
    >
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3 sm:px-6">
        <span className="eyebrow text-secondary" style={{ fontSize: "0.55rem", letterSpacing: "0.22em" }}>
          Year {record.yearIndex} / Market report
        </span>
        <span className="eyebrow" style={{ fontSize: "0.55rem", letterSpacing: "0.22em", color: TONE[event.kind] }}>
          {crash ? "Bad year" : "Big year"}
        </span>
      </div>

      {/* the caption owns the middle of the screen */}
      <div className="flex flex-1 flex-col items-center justify-center px-5 text-center">
        <motion.h2
          className="font-anton leading-[0.9]"
          style={{ fontSize: "clamp(2.9rem, 12vw, 8rem)", color: TONE[event.kind] }}
          initial={reduced ? undefined : { opacity: 0, scale: 1.04, letterSpacing: "0.12em" }}
          animate={{ opacity: 1, scale: 1, letterSpacing: "0.02em" }}
          transition={{ duration: 1.1, ease: EASE }}
        >
          {event.title}
        </motion.h2>

        <motion.p className="mt-4 font-body text-base text-ink-dim sm:text-lg" {...fade(0.45)}>
          The market moved{" "}
          <span className="num" style={{ color: TONE[event.kind] }}>
            {record.indexReturn >= 0 ? "+" : "−"}
            {Math.abs(record.indexReturn).toFixed(1)}%
          </span>{" "}
          this year.
        </motion.p>

        <motion.div className="mt-9" {...fade(0.8)}>
          <p className="eyebrow text-secondary" style={{ letterSpacing: "0.24em" }}>
            {moneyLine.label}
          </p>
          <p
            className="num mt-2 tabular-nums"
            style={{
              fontSize: "clamp(2rem, 7vw, 4rem)",
              color: crash ? (delta < 0 ? TONE.crash : TONE.boom) : delta > 0 ? TONE.boom : "var(--color-ink)",
            }}
          >
            {moneyLine.figure}
          </p>
          <p className="mx-auto mt-3 max-w-md font-body text-sm italic text-ink-dim">{moneyLine.note}</p>
        </motion.div>
      </div>

      <div className="flex items-stretch border-t border-hairline">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            skip();
          }}
          className="ml-auto flex items-center gap-2 px-4 py-3.5 text-ink-dim transition-colors hover:text-ink sm:px-6"
        >
          <span className="eyebrow" style={{ fontSize: "0.58rem", letterSpacing: "0.22em" }}>
            {done ? "Continue" : "Skip"}
          </span>
          <span aria-hidden>→</span>
        </button>
      </div>
    </motion.div>
  );
}
