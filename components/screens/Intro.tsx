"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { Mascot } from "@/components/brand/Mascot";
import { ArrowDown } from "@/components/icons";
import { NeonButton } from "@/components/ui/NeonButton";

export function Intro({ onBegin }: { onBegin: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const heroY = useTransform(scrollYProgress, [0, 1], [0, -120]);
  const heroFade = useTransform(scrollYProgress, [0, 0.7], [1, 0]);

  return (
    <div ref={ref}>
      {/* HERO */}
      <section className="relative flex min-h-[100svh] flex-col items-center justify-center px-5 text-center">
        <motion.div style={{ y: heroY, opacity: heroFade }} className="relative z-10">
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
              className="mt-8"
            >
              <NeonButton variant="primary" size="lg" onClick={onBegin}>
                Choose your run →
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
