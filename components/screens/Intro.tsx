"use client";

import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { NeonButton } from "@/components/ui/NeonButton";
import { TitleAscii } from "@/components/cinematic/TitleAscii";
import { TitleTicker } from "@/components/cinematic/TitleTicker";
import { BracketCTA } from "@/components/cinematic/BracketCTA";
import { ScrollProgress } from "@/components/cinematic/landing/ScrollProgress";
import { FooterColophon, STORY_SEEN_KEY } from "@/components/cinematic/landing/FooterColophon";

// The below-the-fold landing set pieces load as their own chunks so the title
// screen's First Load stays lean; each renders a placeholder band meanwhile.
const sectionFallback = () => <div className="min-h-[40svh] border-t border-hairline" aria-hidden />;
const RunTour = dynamic(() => import("@/components/cinematic/landing/RunTour").then((m) => m.RunTour), { ssr: false, loading: sectionFallback });
const BoardDiorama = dynamic(() => import("@/components/cinematic/landing/BoardDiorama").then((m) => m.BoardDiorama), { ssr: false, loading: sectionFallback });
const MarketSection = dynamic(() => import("@/components/cinematic/landing/MarketSection").then((m) => m.MarketSection), { ssr: false, loading: sectionFallback });
const CompoundToy = dynamic(() => import("@/components/cinematic/landing/CompoundToy").then((m) => m.CompoundToy), { ssr: false, loading: sectionFallback });
const VerdictWall = dynamic(() => import("@/components/cinematic/landing/VerdictWall").then((m) => m.VerdictWall), { ssr: false, loading: sectionFallback });
const StatBand = dynamic(() => import("@/components/cinematic/landing/StatBand").then((m) => m.StatBand), { ssr: false, loading: sectionFallback });
import { useAudio } from "@/hooks/useAudio";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { useSkippable } from "@/src/motion/useSkippable";
import { useScramble } from "@/src/motion/useScramble";
import { DUR, EASE, SPRING } from "@/src/motion/tokens";

const TAGLINE = "SURVIVE THE INTERNET ECONOMY";

/** A hairline-separated ledger cell (mono, uppercase). */
function Cell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`eyebrow text-secondary ${className}`} style={{ fontSize: "0.55rem", letterSpacing: "0.22em" }}>
      {children}
    </span>
  );
}

/**
 * LIFEPATCH title — Spectacle S1 (Addendum A §6). A skippable ~2s attract: a
 * hairline frame prints in → the wordmark STAMPS (Anton, invert flash + thud) →
 * the tagline resolves via scramble → the live market ticker starts → the
 * bracketed `[ BEGIN A RUN ]` terminal CTA arrives. Reduced motion renders the
 * final composed frame; any input skips to it (global useSkippable).
 */
export function Intro({ onBegin, onAlmanac }: { onBegin: () => void; onAlmanac: () => void }) {
  const audio = useAudio();
  const { reduced } = useMotionCtx();

  const [stage, setStage] = useState(reduced ? 5 : 0);
  const [settled, setSettled] = useState(reduced);
  const [flash, setFlash] = useState(false);
  const timers = useRef<number[]>([]);
  // First visit: the run button lives ONLY at the end of the scroll story —
  // the hero pushes you down the page. Once the finale has been reached in
  // this session, the hero CTA comes back (server + first paint render the
  // gated state so hydration matches; promote after mount).
  const [seenStory, setSeenStory] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(STORY_SEEN_KEY) === "1") setSeenStory(true);
    } catch {}
  }, []);

  // one-shot choreographed timeline (skipped entirely under reduced motion)
  useEffect(() => {
    audio.setPhase("title");
    if (reduced) return;
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    at(60, () => setStage(1)); // frame prints in
    at(480, () => { setStage(2); setFlash(true); try { audio.accent("title"); } catch {} }); // stamp + thud
    at(640, () => setFlash(false));
    at(980, () => setStage(3)); // tagline scramble
    at(1300, () => setStage(4)); // ticker + subcopy
    at(1680, () => setStage(5)); // CTA
    at(2000, () => setSettled(true));
    return () => { timers.current.forEach(clearTimeout); timers.current = []; };
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const skip = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setFlash(false);
    setStage(5);
    setSettled(true);
  }, []);

  // global input-skip: any tap/key jumps the attract to its final composed frame
  useSkippable(!settled, skip);

  const framed = reduced || stage >= 1;
  const stamped = reduced || stage >= 2;
  const taglineOn = reduced || stage >= 3;
  const showMid = reduced || stage >= 4;
  const showCta = reduced || stage >= 5;

  const tagline = useScramble(TAGLINE, taglineOn, { reduced: reduced || settled, durationMs: 850 });

  const beginWithSfx = () => { try { audio.sfx("confirm"); } catch {} onBegin(); };

  return (
    <div className="relative bg-bg text-ink">
      <ScrollProgress />
      {/* ===================== HERO — statement cover ===================== */}
      <section className="relative isolate flex min-h-[100svh] flex-col overflow-hidden">
        {/* ASCII-rendered board-orbit loop, quantized to glyphs behind everything */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          initial={reduced ? false : { opacity: 0 }}
          animate={framed ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: DUR.scene, ease: EASE }}
        >
          <TitleAscii />
        </motion.div>

        {/* the frame prints in over the whole hero (hairline, clip-path reveal) */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-3 z-20 border border-hairline sm:inset-5"
          initial={reduced ? false : { clipPath: "inset(0 0 100% 0)", opacity: 0 }}
          animate={framed ? { clipPath: "inset(0 0 0% 0)", opacity: 1 } : { clipPath: "inset(0 0 100% 0)", opacity: 0 }}
          transition={{ duration: DUR.slow, ease: EASE }}
        />

        {/* top HUD rail */}
        <div className="flex items-stretch border-b border-hairline">
          <div className="flex items-center gap-2 border-r border-hairline px-4 py-3 sm:px-6">
            <span className="eyebrow text-ink" style={{ fontSize: "0.62rem", letterSpacing: "0.2em" }}>LIFEPATCH</span>
            <Cell>/ Survival</Cell>
          </div>
          <div className="ml-auto flex items-center gap-4 px-4 py-3 sm:px-6">
            <Cell className="hidden sm:inline">Form 01 · A Financial Survival Game</Cell>
            <span className="hidden h-3 w-px bg-hairline sm:block" />
            <Cell>Est. MMXXVI</Cell>
          </div>
        </div>

        {/* main block — left-anchored, asymmetric */}
        <div className="flex flex-1 flex-col justify-center px-5 py-14 sm:px-10 lg:px-16">
          <motion.p
            initial={reduced ? false : { opacity: 0 }}
            animate={framed ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: DUR.base, ease: EASE }}
            className="eyebrow text-secondary"
          >
            File No. 01 — Your Money
          </motion.p>

          {/* the wordmark STAMPS in with an invert flash */}
          <div className="relative mt-3 w-fit">
            <motion.span
              aria-hidden
              className="absolute inset-0 z-10 bg-ink"
              initial={{ opacity: 0 }}
              animate={flash ? { opacity: [0, 1, 0] } : { opacity: 0 }}
              transition={{ duration: 0.16, ease: "linear" }}
            />
            <motion.h1
              initial={reduced ? false : { opacity: 0, scaleY: 1.18, y: 6 }}
              animate={stamped ? { opacity: 1, scaleY: 1, y: 0 } : { opacity: 0, scaleY: 1.18, y: 6 }}
              transition={reduced ? { duration: 0 } : SPRING.pop}
              style={{ fontSize: "clamp(3.75rem, 18vw, 13rem)", transformOrigin: "left bottom" }}
              className="font-anton leading-[0.86] tracking-[-0.01em] text-ink"
            >
              LIFEPATCH
            </motion.h1>
          </div>

          <div className="mt-5 h-px w-full max-w-3xl bg-hairline" />

          {/* tagline resolves via scramble (fixed height so no CLS) */}
          <p
            className="num mt-4 text-ink"
            style={{ letterSpacing: "0.24em", fontSize: "0.82rem", minHeight: "1.2em", opacity: taglineOn ? 1 : 0 }}
          >
            {tagline}
          </p>

          <motion.p
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={showMid ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
            transition={{ duration: DUR.slow, ease: EASE }}
            className="mt-5 max-w-xl font-body text-[0.98rem] leading-relaxed text-ink-dim"
          >
            You&apos;re running out of money fast, and every choice costs something. Nine months.
            One verdict.
          </motion.p>

          <motion.p
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={showMid ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
            transition={{ duration: DUR.slow, ease: EASE, delay: reduced ? 0 : 0.06 }}
            className="voice mt-3 max-w-xl text-lg text-ink"
          >
            Try not to get financially cooked.
          </motion.p>

          {/* live market ticker — real lib/markets history */}
          <motion.div
            initial={reduced ? false : { opacity: 0 }}
            animate={showMid ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: DUR.base, ease: EASE }}
            className="mt-8 max-w-3xl"
          >
            <TitleTicker />
          </motion.div>

          {/* first visit: no CTA up top — the run is earned at the end of the
              file. Returning visitors (this session) get the shortcut back. */}
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={showCta ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
            transition={reduced ? { duration: 0 } : SPRING.pop}
            className="mt-9 flex flex-wrap items-center gap-3"
          >
            {seenStory ? (
              <>
                <BracketCTA label="Begin a Run" onClick={beginWithSfx} />
                <NeonButton variant="secondary" size="lg" onClick={onAlmanac}>Almanac</NeonButton>
              </>
            ) : (
              <div className="flex items-center gap-3 border border-hairline px-4 py-3">
                <span className="num text-ink" aria-hidden>[</span>
                <span className="eyebrow text-ink" style={{ fontSize: "0.66rem", letterSpacing: "0.22em" }}>
                  Read the file — the run waits at the end
                </span>
                <motion.span
                  aria-hidden
                  className="num text-ink"
                  animate={reduced ? {} : { y: [0, 3, 0] }}
                  transition={{ duration: 1.8, repeat: Infinity }}
                >
                  ↓
                </motion.span>
                <span className="num text-ink" aria-hidden>]</span>
              </div>
            )}
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
            animate={{ opacity: 1, y: reduced ? 0 : [0, 3, 0] }}
            transition={{ opacity: { delay: reduced ? 0 : 0.9 }, y: { duration: 1.8, repeat: Infinity } }}
            className="ml-auto flex items-center gap-2 px-4 py-3 sm:px-6"
          >
            <Cell>Scroll ↓</Cell>
          </motion.div>
        </div>
      </section>

      {/* ===================== PREMISE — framed statement ===================== */}
      <section className="px-5 py-20 sm:px-10 lg:px-16">
        <div className="mx-auto grid max-w-5xl gap-px border border-hairline bg-hairline sm:grid-cols-[1.4fr_1fr]">
          <div className="bg-bg p-6 sm:p-10">
            <p className="eyebrow text-secondary">001 — The Setup</p>
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

      {/* ================== LANDING SET PIECES (Phases K + L) ================== */}
      <RunTour />
      <BoardDiorama />
      <MarketSection />
      <CompoundToy />
      <VerdictWall />
      <StatBand />
      <FooterColophon onBegin={beginWithSfx} onAlmanac={onAlmanac} />
    </div>
  );
}
