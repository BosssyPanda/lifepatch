"use client";

import { motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { Emblem } from "@/components/brand/Emblem";
import { Mascot } from "@/components/brand/Mascot";
import { ArrowDown } from "@/components/icons";
import { NeonButton } from "@/components/ui/NeonButton";
import { useAudio } from "@/hooks/useAudio";

export function Intro({ onBegin, onAlmanac }: { onBegin: () => void; onAlmanac: () => void }) {
  const audio = useAudio();

  // Arrival: open the signature title theme + fire the reveal swell once as the
  // economy resolves behind the logo. No-ops cleanly when muted / not started.
  const revealed = useRef(false);
  useEffect(() => {
    if (revealed.current) return;
    revealed.current = true;
    audio.setPhase("title");
    audio.accent("title");
  }, [audio]);

  return (
    <div className="relative">
      {/* HERO — engraved masthead */}
      <section className="relative flex min-h-[100svh] flex-col items-center justify-center px-5 py-20 text-center">
        {/* masthead dateline rule */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.9 }}
          className="absolute inset-x-0 top-0 flex items-center gap-4 px-5 pt-6 sm:px-10"
        >
          <span className="num hidden text-[0.6rem] tracking-[0.25em] text-ink-dim/70 sm:block">VOL. I · NO. 1</span>
          <span className="h-px flex-1 bg-ink/15" />
          <span className="eyebrow text-ink-dim/80" style={{ fontSize: "0.55rem" }}>A Financial Survival Story</span>
          <span className="h-px flex-1 bg-ink/15" />
          <span className="num hidden text-[0.6rem] tracking-[0.25em] text-ink-dim/70 sm:block">EST. MMXXVI</span>
        </motion.div>

        <motion.div className="relative z-10 flex flex-col items-center">
          {/* the engraved seal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.86, rotate: -8 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 120, damping: 16 }}
            className="text-ink"
          >
            <Emblem className="h-[30vw] max-h-[156px] w-[30vw] max-w-[156px]" />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12, type: "spring", stiffness: 160, damping: 18 }}
            className="display-caps mt-3 text-[17vw] leading-[0.82] text-ink sm:text-[9.5rem]"
          >
            Life<span className="text-accent">patch</span>
          </motion.h1>

          {/* ornamental double-rule with a center lozenge */}
          <motion.div
            initial={{ opacity: 0, scaleX: 0.6 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ delay: 0.3, duration: 0.7 }}
            className="mt-4 flex w-[min(22rem,80vw)] items-center gap-3 text-accent"
          >
            <span className="h-px flex-1 bg-current opacity-50" />
            <svg width="18" height="8" viewBox="0 0 18 8" fill="none" aria-hidden>
              <path d="M9 0l4.5 4L9 8 4.5 4z" stroke="currentColor" strokeWidth="1" />
              <path d="M0 4h3M15 4h3" stroke="currentColor" strokeWidth="1" />
            </svg>
            <span className="h-px flex-1 bg-current opacity-50" />
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.42 }}
            className="mt-4 font-serif text-xl italic text-ink/75 sm:text-2xl"
          >
            Survive the Internet Economy
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.54 }}
            className="mx-auto mt-5 max-w-md font-serif text-base leading-relaxed text-ink-dim"
          >
            You&apos;re running out of money fast, and every choice costs something. Nine months.
            One verdict. Try not to get financially cooked.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.66 }}
            className="mt-8 flex flex-wrap items-center justify-center gap-3"
          >
            <NeonButton variant="primary" size="lg" onClick={() => { audio.sfx("confirm"); onBegin(); }}>
              Choose your run →
            </NeonButton>
            <NeonButton variant="secondary" size="lg" onClick={onAlmanac}>
              Open the Almanac
            </NeonButton>
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, y: [0, 8, 0] }}
          transition={{ opacity: { delay: 1 }, y: { duration: 1.8, repeat: Infinity } }}
          className="absolute bottom-7 flex flex-col items-center gap-1 text-ink-dim"
        >
          <span className="eyebrow" style={{ fontSize: "0.55rem" }}>The setup</span>
          <ArrowDown size={18} />
        </motion.div>
      </section>

      {/* PREMISE */}
      <section className="relative flex min-h-[90svh] items-center justify-center px-5 py-20">
        <div className="mx-auto grid max-w-4xl items-center gap-10 sm:grid-cols-[1fr_auto]">
          <div>
            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              className="eyebrow text-accent"
            >
              The setup
            </motion.p>
            <motion.h2
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ delay: 0.1 }}
              className="display-caps mt-3 text-4xl leading-tight text-ink sm:text-6xl"
            >
              The economy is rigged.<br />You still have to play.
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ delay: 0.2 }}
              className="mt-5 max-w-lg font-serif text-lg leading-relaxed text-ink/80"
            >
              Nine months. Rent, scams, debt traps, group-chat FOMO, and a market that
              hates you. Your choices move real numbers. Meet the house you&apos;re playing
              against — and pick who you&apos;ll be.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ delay: 0.32 }}
              className="mt-8 flex flex-wrap items-center gap-3"
            >
              <NeonButton variant="primary" size="lg" onClick={() => { audio.sfx("confirm"); onBegin(); }}>
                Choose your run →
              </NeonButton>
              <NeonButton variant="secondary" size="lg" onClick={onAlmanac}>
                Open the Almanac
              </NeonButton>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, x: 20, rotate: 4 }}
            animate={{ opacity: 1, x: 0, rotate: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ type: "spring", stiffness: 160, damping: 18 }}
            className="mx-auto w-40 sm:w-56"
          >
            <Mascot mood="smug" />
            <p className="mt-2 text-center font-serif text-sm italic text-ink-dim">
              &ldquo;Welcome. I&apos;m the house.&rdquo;
            </p>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
