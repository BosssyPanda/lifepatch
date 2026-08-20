"use client";

import { motion } from "framer-motion";
import { MascotLine } from "@/components/story/MascotLine";
import { useMatchCtx } from "@/hooks/useMatch";
import { currency } from "@/lib/format";
import { playHeadline, type RunState } from "@/lib/runEngine";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { DUR, EASE, SPRING } from "@/src/motion/tokens";

const TONE_HEX: Record<string, string> = {
  good: "var(--color-gain)",
  bad: "var(--color-loss)",
  warning: "var(--color-secondary)",
  neutral: "var(--color-secondary)",
};

function taunt(indexReturn: number, delta: number): { line: string; mood: "gloating" | "rattled" } | null {
  if (indexReturn <= -20) return { line: "A crash. Most people sell right here, at the bottom. Will you?", mood: "gloating" };
  if (indexReturn >= 28 && delta > 0) return { line: "Up big. Don't get cocky — I always come back for it.", mood: "rattled" };
  return null;
}

export function MarketTicker({ run }: { run: RunState }) {
  // read before the early return, so hook order is stable across both branches
  const { reduced } = useMotionCtx();
  // null for a solo run — the solo copy below is untouched.
  const match = useMatchCtx();
  const last = run.history[run.history.length - 1];

  if (!last) {
    // Year one says the same thing twice over: in a match the clock HAS started —
    // it is counting down a few hundred pixels up the page — and the button this
    // copy points at is labelled "Lock in the year", not "Advance the year".
    return (
      <div className="mx-auto max-w-3xl px-5 py-6 text-center">
        <p className="eyebrow text-ink">Year One</p>
        <h2 className="display-caps mt-2 text-3xl text-ink sm:text-4xl">
          {match ? "The room's clock is running" : "The clock hasn't started"}
        </h2>
        <p className="mx-auto mt-2 max-w-md font-body text-ink-dim">
          {match
            ? "Put your starting cash to work below, handle whatever life throws at you, then lock in the year. Everyone's year turns together — ready or not."
            : "Put your starting cash to work below, handle whatever life throws at you, then advance the year. You won't know what's coming. That's the point."}
        </p>
      </div>
    );
  }

  const headline = playHeadline(last.year, last.indexReturn);
  const t = taunt(last.indexReturn, last.portfolioDelta);
  const up = last.portfolioDelta >= 0;

  return (
    <div className="mx-auto max-w-3xl px-5 py-6">
      <div className="border border-hairline bg-bg2 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow text-ink-dim">The market did this</p>
            <p className="num text-3xl sm:text-4xl" style={{ color: last.indexReturn >= 0 ? "var(--color-gain)" : "var(--color-loss)" }}>
              {last.indexReturn >= 0 ? "+" : ""}{last.indexReturn.toFixed(1)}%
            </p>
          </div>
          <div className="text-right">
            <p className="eyebrow text-ink-dim">Your portfolio</p>
            {/* Reduced motion keeps the feedback and drops the pop (same trade as
                YearHud's FlashValue): the figure fades in instead of punching in. */}
            <motion.p
              key={last.portfolioDelta}
              initial={reduced ? { opacity: 0 } : { scale: 1.2 }}
              animate={reduced ? { opacity: 1 } : { scale: 1 }}
              transition={reduced ? { duration: DUR.instant, ease: EASE } : SPRING.reward}
              className="num text-2xl sm:text-3xl"
              style={{ color: up ? "var(--color-gain)" : "var(--color-loss)" }}
            >
              {up ? "+" : "−"}{currency(Math.abs(last.portfolioDelta))}
            </motion.p>
          </div>
        </div>

        {headline && (
          <p
            className="mt-3 border-t border-hairline pt-3 font-mono text-sm uppercase tracking-wide"
            style={{ color: TONE_HEX[headline.tone] }}
          >
            {headline.text}
          </p>
        )}
      </div>

      {t && <MascotLine line={t.line} mood={t.mood} />}
    </div>
  );
}
