"use client";

import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { NeonButton } from "@/components/ui/LedgerButton";
import { TitleAscii } from "@/components/cinematic/TitleAscii";
import { FilmLayer } from "@/components/cinematic/film/FilmLayer";
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
import { useLenis } from "@/hooks/useLenis";
import { prefersReducedMotionNow, useMotionCtx } from "@/src/motion/MotionProvider";
import { useSkippable } from "@/src/motion/useSkippable";
import { useScramble } from "@/src/motion/useScramble";
import { DUR, EASE, SPRING } from "@/src/motion/tokens";
import { SectionMark } from "@/components/ui/SectionMark";
import { SoundCell } from "@/components/ui/SoundCell";

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
export function Intro({
  onBegin,
  onAlmanac,
  onReplayIntro,
}: {
  onBegin: () => void;
  onAlmanac: () => void;
  /** Replay the cold open. Rendered as a rail cell — see the note on the rail. */
  onReplayIntro?: () => void;
}) {
  const audio = useAudio();
  const { reduced: reducedCtx } = useMotionCtx();
  // MotionProvider holds `reduced` false for exactly one render — its docblock says why
  // (an ungated matchMedia read mismatches the server markup and throws React #418).
  // Intro mounts inside that very render, so it is the one screen for which "one render"
  // is the whole opening ceremony. The effect below promotes this on the first tick.
  const [reducedNow, setReducedNow] = useState(false);
  const reduced = reducedCtx || reducedNow;
  // Smooth scrolling belongs HERE — this is the long scroll story, with pinned
  // sections, scroll-linked WebGL set pieces and a scroll-progress rail. It was
  // only ever mounted on YearLoop (an app-like screen with no scroll narrative).
  // The hook no-ops under prefers-reduced-motion; overlays that can open above the
  // landing (Almanac, Leaderboard, Money Brain) carry `data-lenis-prevent` on their
  // scroll containers so their inner scrolling is never hijacked.
  useLenis(true);

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
    // NOT the context's `reduced`: this effect is pinned to [] and Intro mounts inside
    // MotionProvider's first commit, where `reduced` is still false by design. Reading
    // the closure value ran the whole attract — the stamp's full-frame ink invert
    // included — for someone who asked for no motion. Ask the browser instead.
    if (prefersReducedMotionNow()) {
      setReducedNow(true);
      setStage(5);
      setSettled(true);
      return;
    }
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

  const { ref: taglineRef, text: tagline } = useScramble(TAGLINE, taglineOn, { reduced: reduced || settled, durationMs: 850 });

  const beginWithSfx = () => { try { audio.sfx("confirm"); } catch {} onBegin(); };

  // Phase R "Living Atlas": pointer parallax separating the hero's depth planes
  // (ascii backdrop ← back letters ← statue ← front letters). Mouse only —
  // touch scroll must never fight the layers.
  const hx = useMotionValue(0);
  const hy = useMotionValue(0);
  const shx = useSpring(hx, { stiffness: 55, damping: 17 });
  const shy = useSpring(hy, { stiffness: 55, damping: 17 });
  // two planes only: the title moves gently, the statue in the right bay moves
  // a touch more — depth without ever shearing a glyph.
  const backX = useTransform(shx, [-0.5, 0.5], [-5, 5]);
  const backY = useTransform(shy, [-0.5, 0.5], [-4, 4]);
  const midX = useTransform(shx, [-0.5, 0.5], [-11, 11]);
  const midY = useTransform(shy, [-0.5, 0.5], [-8, 8]);
  const onHeroMove = (e: PointerEvent<HTMLElement>) => {
    if (reduced || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    hx.set((e.clientX - r.left) / r.width - 0.5);
    hy.set((e.clientY - r.top) / r.height - 0.5);
  };

  return (
    <div className="relative bg-bg text-ink">
      <ScrollProgress />
      {/* ===================== HERO — statement cover ===================== */}
      <section onPointerMove={onHeroMove} className="relative isolate flex min-h-[100svh] flex-col overflow-hidden">
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

        {/* the Atlas — standing in the hero's right bay over the ASCII board
            zone (xl+ only: below that the text column owns the full width, and
            "no overlap" beats presence — the Gate still shows it everywhere) */}
        <div
          aria-hidden
          className="pointer-events-none absolute right-[5%] top-1/2 z-0 hidden -translate-y-1/2 select-none xl:block"
        >
          <motion.div
            style={{ x: midX, y: midY }}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: stamped ? 0.95 : 0 }}
            transition={reduced ? { duration: 0 } : { duration: DUR.slow, ease: EASE, delay: 0.25 }}
          >
            {/* 597KB of unoptimised PNG became a 92KB WebP (q85, alpha kept; SSIM
                0.978 against the original over the near-black ground — the halftone
                engraving is indistinguishable at 1:1, and it renders through
                grayscale() anyway). Intrinsic dimensions are declared so the bay
                reserves its box, and it decodes off the main thread. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/img/atlas-engraving.webp"
              alt=""
              width={473}
              height={958}
              loading="lazy"
              decoding="async"
              draggable={false}
              className="h-[70svh] max-h-[760px] w-auto"
              style={{ filter: "grayscale(1) brightness(0.95)" }}
            />
          </motion.div>
        </div>

        {/* top HUD rail.
            Both live controls sit HERE, in the document, rather than floating over the
            page. The intro-replay chip used to be `fixed left-4 top-14`, and probed at
            eleven scroll offsets it overlapped content at every single one — 15,498px²
            of it on other controls. A rail cell cannot overlap anything, and this is
            where a returning visitor arrives, which is the moment the mute is wanted. */}
        <div className="flex items-stretch border-b border-hairline">
          <div className="flex min-w-0 items-center gap-2 border-r border-hairline px-4 py-3 sm:px-6">
            <span className="eyebrow text-ink" style={{ fontSize: "0.62rem", letterSpacing: "0.2em" }}>LIFEPATCH</span>
            {/* Dropped below `sm`: two controls joined this rail, and at 390px the
                strapline wrapped onto a second line and pushed VOL's right edge to
                within 3px of the viewport. */}
            <Cell className="hidden sm:inline">/ Survival</Cell>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2.5 px-3 py-2 sm:gap-4 sm:px-6">
            <Cell className="hidden lg:inline">Form 01 · A Financial Survival Game</Cell>
            <span className="hidden h-3 w-px bg-hairline lg:block" />
            <Cell className="hidden sm:inline">Est. MMXXVI</Cell>
            {onReplayIntro && (
              <button
                type="button"
                onClick={onReplayIntro}
                aria-label="Replay the intro film"
                data-radius=""
                className="relative flex items-center gap-1.5 border border-hairline-strong bg-bg px-2.5 py-1.5 text-ink-dim transition-colors hover:border-ink hover:text-ink before:absolute before:-inset-x-[8px] before:-inset-y-[9px] before:content-['']"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M7 4l13 8-13 8z" /></svg>
                <span className="eyebrow" style={{ fontSize: "0.56rem" }}>Intro</span>
              </button>
            )}
            <SoundCell />
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
            {/* The hero's folio, and the first orange thing on the site: the same
                numeral-in-accent rule the seven `SectionMark`s below it follow, so the
                signature is introduced in the first frame instead of arriving at 001. */}
            File No. <span className="text-accent">01</span> — Your Money
          </motion.p>

          {/* the wordmark STAMPS in with an invert flash — one SOLID plane.
              (The R interleave sheared the glyphs under parallax and read as a
              misprint at wide viewports; the Atlas stands in the right bay now.) */}
          <div className="relative mt-3 w-fit">
            <motion.span
              aria-hidden
              className="absolute inset-0 z-10 bg-ink"
              initial={{ opacity: 0 }}
              animate={flash ? { opacity: [0, 1, 0] } : { opacity: 0 }}
              transition={{ duration: 0.16, ease: "linear" }}
            />
            <motion.div
              initial={reduced ? false : { opacity: 0, scaleY: 1.18, y: 6 }}
              animate={stamped ? { opacity: 1, scaleY: 1, y: 0 } : { opacity: 0, scaleY: 1.18, y: 6 }}
              transition={reduced ? { duration: 0 } : SPRING.pop}
              style={{ transformOrigin: "left bottom" }}
            >
              <motion.h1
                style={{ fontSize: "clamp(3.75rem, 18vw, 13rem)", x: backX, y: backY }}
                className="font-anton leading-[0.86] tracking-[-0.01em] text-ink"
              >
                LIFEPATCH
              </motion.h1>
            </motion.div>
          </div>

          <div className="mt-5 h-px w-full max-w-3xl bg-hairline" />

          {/* tagline resolves via scramble (fixed height so no CLS) */}
          <p
            ref={taglineRef as React.RefObject<HTMLParagraphElement>}
            className="num mt-4 text-ink"
            style={{ letterSpacing: "0.24em", fontSize: "0.82rem", minHeight: "1.2em", opacity: taglineOn ? 1 : 0 }}
          >
            {tagline}
          </p>

          <motion.p
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={showMid ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
            transition={reduced ? { duration: 0 } : { duration: DUR.slow, ease: EASE }}
            className="mt-5 max-w-xl font-body text-[0.98rem] leading-relaxed text-ink-dim"
          >
            You&apos;re running out of money fast, and every choice costs something. Nine months.
            One verdict.
          </motion.p>

          <motion.p
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={showMid ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
            transition={reduced ? { duration: 0 } : { duration: DUR.slow, ease: EASE, delay: 0.06 }}
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
              /* The bracketed terminal prompt, in the same orange keyline `BracketCTA`
                 wears — on a first visit this IS the CTA, it just asks you to scroll
                 instead of to click, and the hero would otherwise be the one screen on
                 the site with no signature on it at all. The sentence stays ink. */
              <div className="flex items-center gap-3 border border-accent px-4 py-3">
                <span className="num text-accent" aria-hidden>[</span>
                <span className="eyebrow text-ink" style={{ fontSize: "0.66rem", letterSpacing: "0.22em" }}>
                  Read the file — the run waits at the end
                </span>
                {/* On a first visit there is no CTA up here — scrolling IS the primary
                    path, so the arrow that says so is the thing that carries the accent. */}
                <motion.span
                  aria-hidden
                  className="num text-accent"
                  animate={reduced ? {} : { y: [0, 3, 0] }}
                  transition={{ duration: 1.8, repeat: Infinity }}
                >
                  ↓
                </motion.span>
                <span className="num text-accent" aria-hidden>]</span>
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

        {/* film vocabulary over the hero only (§ Film Exception) — grain +
            vignette persist; the flash frame fires with the wordmark stamp so
            ColdOpen Act III cuts into an identical-feeling frame. */}
        <FilmLayer grain={0.45} vignette={0.4} flashKey={flash ? "stamp" : null} className="z-40" />
      </section>

      {/* ===================== PREMISE — framed statement ===================== */}
      <section className="px-5 py-20 sm:px-10 lg:px-16">
        <div className="mx-auto grid max-w-5xl gap-px border border-hairline bg-hairline sm:grid-cols-[1.4fr_1fr]">
          <div className="bg-bg p-6 sm:p-10">
            <SectionMark n="001">The Setup</SectionMark>
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
