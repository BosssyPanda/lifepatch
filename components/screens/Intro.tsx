"use client";

import { motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { NeonButton } from "@/components/ui/NeonButton";
import { useAudio } from "@/hooks/useAudio";

const EASE = [0.2, 0.65, 0.3, 0.9] as const;

/** A hairline-separated ledger cell (mono, uppercase). */
function Cell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`eyebrow text-secondary ${className}`}
      style={{ fontSize: "0.55rem", letterSpacing: "0.22em" }}
    >
      {children}
    </span>
  );
}

export function Intro({ onBegin, onAlmanac }: { onBegin: () => void; onAlmanac: () => void }) {
  const audio = useAudio();

  // Arrival: open the signature title theme + fire the reveal swell once.
  const revealed = useRef(false);
  useEffect(() => {
    if (revealed.current) return;
    revealed.current = true;
    audio.setPhase("title");
    audio.accent("title");
  }, [audio]);

  return (
    <div className="relative bg-bg text-ink">
      {/* ===================== HERO — statement cover ===================== */}
      <section className="relative flex min-h-[100svh] flex-col">
        {/* top HUD rail */}
        <div className="flex items-stretch border-b border-hairline">
          <div className="flex items-center gap-2 border-r border-hairline px-4 py-3 sm:px-6">
            <span className="eyebrow text-ink" style={{ fontSize: "0.62rem", letterSpacing: "0.2em" }}>
              LIFEPATCH
            </span>
            <Cell>/ Survival</Cell>
          </div>
          <div className="ml-auto flex items-center gap-4 px-4 py-3 sm:px-6">
            <Cell className="hidden sm:inline">A Financial Survival Game</Cell>
            <span className="hidden h-3 w-px bg-hairline sm:block" />
            <Cell>Est. MMXXVI</Cell>
          </div>
        </div>

        {/* main block — left-anchored, asymmetric */}
        <div className="flex flex-1 flex-col justify-center px-5 py-16 sm:px-10 lg:px-16">
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="eyebrow text-secondary"
          >
            File No. 01 — Your Money
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06, duration: 0.6, ease: EASE }}
            className="font-anton mt-3 leading-[0.86] tracking-[-0.01em] text-ink"
            style={{ fontSize: "clamp(3.75rem, 18vw, 13rem)" }}
          >
            LIFEPATCH
          </motion.h1>

          <div className="mt-5 h-px w-full max-w-3xl bg-hairline" />

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.16, duration: 0.6 }}
            className="eyebrow mt-4 text-ink"
            style={{ letterSpacing: "0.24em" }}
          >
            Survive the Internet Economy
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.24, duration: 0.6, ease: EASE }}
            className="mt-5 max-w-xl font-body text-[0.98rem] leading-relaxed text-ink-dim"
          >
            You&apos;re running out of money fast, and every choice costs something. Nine months.
            One verdict.
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.32, duration: 0.6, ease: EASE }}
            className="voice mt-3 max-w-xl text-lg text-ink"
          >
            Try not to get financially cooked.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.42, duration: 0.6, ease: EASE }}
            className="mt-9 flex flex-wrap items-center gap-3"
          >
            <NeonButton variant="primary" size="lg" onClick={() => { audio.sfx("confirm"); onBegin(); }}>
              Enter →
            </NeonButton>
            <NeonButton variant="secondary" size="lg" onClick={onAlmanac}>
              Almanac
            </NeonButton>
          </motion.div>
        </div>

        {/* bottom ledger footer rail */}
        <div className="flex items-stretch border-t border-hairline">
          <div className="flex items-center gap-3 border-r border-hairline px-4 py-3 sm:px-6">
            <Cell>Modes</Cell>
            <Cell className="text-ink">Story · Infinite · Rat Race</Cell>
          </div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, y: [0, 3, 0] }}
            transition={{ opacity: { delay: 0.9 }, y: { duration: 1.8, repeat: Infinity } }}
            className="ml-auto flex items-center gap-2 px-4 py-3 sm:px-6"
          >
            <Cell>Scroll ↓</Cell>
          </motion.div>
        </div>
      </section>

      {/* ===================== PREMISE — framed statement ===================== */}
      <section className="px-5 py-20 sm:px-10 lg:px-16">
        <div className="mx-auto grid max-w-5xl gap-px border border-hairline bg-hairline sm:grid-cols-[1.4fr_1fr]">
          {/* left cell */}
          <div className="bg-bg p-6 sm:p-10">
            <p className="eyebrow text-secondary">The Setup</p>
            <h2 className="display-caps mt-3 text-2xl leading-tight text-ink sm:text-4xl">
              The economy is rigged.
              <br />
              You still have to play.
            </h2>
            <p className="mt-5 max-w-lg font-body text-[0.95rem] leading-relaxed text-ink-dim">
              Nine months. Rent, scams, debt traps, group-chat FOMO, and a market that hates you.
              Your choices move real numbers.
            </p>
          </div>

          {/* right cell — itemized threats + the house voice line */}
          <div className="flex flex-col justify-between bg-bg p-6 sm:p-10">
            <div className="space-y-2">
              {["Rent", "Scams", "Debt", "The Market"].map((t) => (
                <div key={t} className="flex items-baseline gap-2">
                  <span className="eyebrow text-ink" style={{ fontSize: "0.6rem" }}>{t}</span>
                  <span className="mt-1 flex-1 rule-dotted" />
                  <span className="num text-secondary" style={{ fontSize: "0.6rem" }}>PENDING</span>
                </div>
              ))}
            </div>
            <p className="voice mt-8 text-base text-ink">&ldquo;Welcome. I&apos;m the house.&rdquo;</p>
          </div>
        </div>
      </section>
    </div>
  );
}
