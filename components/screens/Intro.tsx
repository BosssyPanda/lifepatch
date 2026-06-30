"use client";

import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { Mascot } from "@/components/brand/Mascot";
import { ArrowDown } from "@/components/icons";
import { NeonButton } from "@/components/ui/NeonButton";
import { VerdictGallery } from "@/components/social/VerdictGallery";
import { useAudio } from "@/hooks/useAudio";

// 3D economy hero — lazy + client-only so three/drei stay out of the base bundle.
// Returns null without WebGL, leaving the flat text hero as the fallback.
const EconomyCanvas = dynamic(
  () => import("@/components/cinematic/economy3d/EconomyCanvas").then((m) => m.EconomyCanvas),
  { ssr: false },
);

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
      {/* HERO */}
      <section className="relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden px-5 text-center">
        {/* 3D internet-economy world behind the wordmark (paints after the text) */}
        <EconomyCanvas variant="title" />

        <motion.div className="relative z-10">
          <motion.p
            initial={{ opacity: 0, letterSpacing: "0.5em" }}
            animate={{ opacity: 1, letterSpacing: "0.28em" }}
            transition={{ duration: 0.8 }}
            className="eyebrow text-accent"
          >
            A financial survival story
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, type: "spring", stiffness: 160, damping: 18 }}
            className="display-caps mt-4 text-[22vw] leading-[0.82] text-ink sm:text-[12rem]"
          >
            Life<span className="text-accent">patch</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mt-2 font-serif text-xl italic text-ink/70 sm:text-2xl"
          >
            Survive the Internet Economy
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55 }}
            className="mx-auto mt-6 max-w-md font-serif text-base leading-relaxed text-ink-dim"
          >
            You&apos;re running out of money fast. Every choice costs something. Scroll, and
            try not to get financially cooked.
          </motion.p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, y: [0, 10, 0] }}
          transition={{ opacity: { delay: 1 }, y: { duration: 1.8, repeat: Infinity } }}
          className="absolute bottom-8 flex flex-col items-center gap-1 text-ink-dim"
        >
          <span className="eyebrow">Scroll</span>
          <ArrowDown size={20} />
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

      {/* SOCIAL PROOF — every run ends in a verdict */}
      <section className="relative px-5 pb-24">
        <div className="mx-auto max-w-4xl text-center">
          <motion.p
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            className="eyebrow text-accent"
          >
            Every run gets graded
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ delay: 0.08 }}
            className="display-caps mt-3 text-3xl text-ink sm:text-5xl"
          >
            How will you be remembered?
          </motion.h2>
          <p className="mx-auto mt-3 max-w-md font-serif text-ink-dim">
            Nine months of choices compound into one verdict. Financially free, or
            underwater — the ledger doesn&apos;t lie.
          </p>
        </div>
        <div className="mt-8">
          <VerdictGallery />
        </div>
      </section>
    </div>
  );
}
