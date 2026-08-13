"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { NeonButton } from "@/components/ui/LedgerButton";
import { useAudio } from "@/hooks/useAudio";
import { MODES } from "@/lib/modes";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { SPRING } from "@/src/motion/tokens";

/** Session flag: the visitor has reached the end of the file at least once —
 *  later visits get the hero CTA back (read in Intro). */
export const STORY_SEEN_KEY = "lp_storySeen";

/**
 * The finale that closes the title page (spectacle Phase K5, "behold" rev):
 * a full-viewport set piece where the CTA *is* the display type — a
 * wordmark-scale BEGIN A RUN that stamps in (invert flash + thud, the hero
 * wordmark's own entrance) the first time it scrolls into view. Reduced
 * motion renders it settled. The colophon rails close the document below.
 */
export function FooterColophon({ onBegin, onAlmanac }: { onBegin: () => void; onAlmanac: () => void }) {
  const audio = useAudio();
  const { reduced } = useMotionCtx();
  const [stamped, setStamped] = useState(reduced);
  const [flash, setFlash] = useState(false);

  const arm = () => {
    if (stamped) return;
    setStamped(true);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 180);
    try { audio.accent("title"); } catch {}
    try { sessionStorage.setItem(STORY_SEEN_KEY, "1"); } catch {}
  };

  return (
    <footer className="border-t border-hairline" aria-label="Colophon">
      {/* ================= the BEHOLD plate ================= */}
      <motion.section
        className="relative flex min-h-[100svh] flex-col justify-center overflow-hidden px-5 py-16 sm:px-10 lg:px-16"
        onViewportEnter={arm}
        viewport={{ amount: 0.55, once: true }}
        aria-labelledby="finale-heading"
      >
        <p className="eyebrow text-secondary">007 — Filing</p>
        <h2 id="finale-heading" className="voice mt-4 max-w-xl text-xl text-ink sm:text-2xl">
          You&apos;ve read the file. The house is ready when you are.
        </h2>

        {/* the CTA is the display type — wordmark scale */}
        <div className="relative mt-8 w-fit">
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 bg-ink"
            initial={{ opacity: 0 }}
            animate={flash ? { opacity: [0, 1, 0] } : { opacity: 0 }}
            transition={{ duration: 0.16, ease: "linear" }}
          />
          <motion.button
            type="button"
            onClick={onBegin}
            initial={reduced ? false : { opacity: 0, scaleY: 1.18, y: 8 }}
            animate={stamped ? { opacity: 1, scaleY: 1, y: 0 } : { opacity: 0, scaleY: 1.18, y: 8 }}
            transition={reduced ? { duration: 0 } : SPRING.pop}
            style={{ fontSize: "clamp(3rem, 11.5vw, 10.5rem)", transformOrigin: "left bottom" }}
            className="group block cursor-pointer border-y-2 border-transparent text-left font-anton leading-[0.92] tracking-[-0.01em] text-ink transition-colors duration-200 hover:bg-ink hover:text-bg focus-visible:bg-ink focus-visible:text-bg"
          >
            BEGIN A&nbsp;RUN
            <span aria-hidden className="inline-block translate-y-[-0.06em] pl-[0.15em] transition-transform duration-200 group-hover:translate-x-[0.08em]">→</span>
          </motion.button>
        </div>

        <motion.div
          initial={reduced ? false : { opacity: 0 }}
          animate={stamped ? { opacity: 1 } : { opacity: 0 }}
          transition={{ delay: reduced ? 0 : 0.25 }}
          className="mt-8 flex flex-wrap items-center gap-3"
        >
          <NeonButton variant="secondary" size="lg" onClick={onAlmanac}>Almanac</NeonButton>
          <span className="eyebrow text-tertiary" style={{ fontSize: "0.55rem" }}>
            Reference first, run second — the house respects homework.
          </span>
        </motion.div>
      </motion.section>

      {/* ================= colophon rails ================= */}
      <div className="grid gap-px border-t border-hairline bg-hairline sm:grid-cols-3">
        {Object.entries(MODES).map(([id, m]) => (
          <div key={id} className="bg-bg px-5 py-4 sm:px-6">
            <p className="eyebrow text-ink" style={{ fontSize: "0.6rem" }}>{m.name}</p>
            <p className="eyebrow mt-1 text-tertiary" style={{ fontSize: "0.52rem" }}>{m.meta}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-5 py-4 sm:px-10 lg:px-16">
        <span className="eyebrow text-tertiary" style={{ fontSize: "0.52rem" }}>
          LIFEPATCH · Form 01 · A Financial Survival Game
        </span>
        <span className="eyebrow text-tertiary" style={{ fontSize: "0.52rem" }}>
          Est. MMXXVI · The house always counts.
        </span>
      </div>
    </footer>
  );
}
