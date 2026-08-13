"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrainIcon, CheckIcon, FreedomIcon, ReplayIcon, TrophyIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/LedgerButton";
import { StreakChip } from "@/components/social/StreakChip";
import { useAudio } from "@/hooks/useAudio";
import { FIRST_YEAR, LAST_YEAR, sp500Return } from "@/lib/markets";
import { MODES, type ModeId } from "@/lib/modes";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { useSpotlightHandler } from "@/src/motion/useSpotlight";
import { EASE, SPRING } from "@/src/motion/tokens";

const ICON = { story: TrophyIcon, infinite: ReplayIcon, cashflow: FreedomIcon };

export function ModeSelect({
  onChoose,
  onBack,
  onLeaderboard,
  onMasteryMap,
}: {
  onChoose: (mode: ModeId) => void;
  onBack: () => void;
  onLeaderboard: () => void;
  onMasteryMap: () => void;
}) {
  const audio = useAudio();
  const { reduced } = useMotionCtx();
  const onSpot = useSpotlightHandler<HTMLButtonElement>();
  const modes: ModeId[] = ["story", "infinite", "cashflow"];
  const [picked, setPicked] = useState<ModeId | null>(null);

  return (
    <div className="mx-auto flex min-h-[100svh] w-full max-w-4xl flex-col justify-center px-5 py-14">
      <div className="mb-4 flex justify-end"><StreakChip /></div>
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <p className="eyebrow text-ink">Choose your run</p>
        <h1 className="display-caps mt-3 text-4xl text-ink sm:text-6xl">Three ways to play</h1>
        <div className="mx-auto mt-5 h-px w-24 bg-ink" />
      </motion.div>

      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {modes.map((id, i) => {
          const m = MODES[id];
          const Icon = ICON[id];
          const active = picked === id;
          return (
            <motion.button
              key={id}
              type="button"
              onClick={() => { audio.sfx("click"); setPicked(id); }}
              initial={{ opacity: 0, y: 26, rotate: i % 2 ? 1 : -1 }}
              animate={{ opacity: picked && !active ? 0.55 : 1, y: 0, rotate: active ? 0 : i % 2 ? 1 : -1, scale: active ? 1.03 : 1 }}
              transition={{ ...SPRING.pop, delay: i * 0.1 }}
              whileHover={reduced ? undefined : { y: -6 }}
              data-radius=""
              // 2px inset ink outline: `ring-*` is box-shadow, which the LEDGER reset kills,
              // so the "picked" card had no border treatment at all.
              style={active ? { outline: "2px solid var(--color-ink)", outlineOffset: "-2px" } : undefined}
              onPointerMove={onSpot}
              className="paper spotlight group relative overflow-hidden p-6 text-left"
            >
              {/* darker overlay + check on the chosen card */}
              {active && (
                <>
                  <span className="pointer-events-none absolute inset-0 bg-ink/15" />
                  <span data-radius="round" className="absolute right-3 top-3 z-10 grid h-7 w-7 place-items-center border-2 border-bg bg-ink text-bg">
                    <CheckIcon size={15} />
                  </span>
                </>
              )}
              {/* hover bracket corners (pointer devices) */}
              <span aria-hidden className="pointer-events-none absolute inset-2 opacity-0 transition-opacity duration-200 pointer-fine:group-hover:opacity-100">
                <span className="absolute left-0 top-0 h-3 w-3 border-l-2 border-t-2 border-ink" />
                <span className="absolute right-0 top-0 h-3 w-3 border-r-2 border-t-2 border-ink" />
                <span className="absolute bottom-0 left-0 h-3 w-3 border-b-2 border-l-2 border-ink" />
                <span className="absolute bottom-0 right-0 h-3 w-3 border-b-2 border-r-2 border-ink" />
              </span>
              <div className="relative">
                <div className="flex items-center justify-between border-b-2 border-ink pb-2">
                  <span className="eyebrow text-secondary">{m.meta}</span>
                  <span className="text-ink"><Icon size={22} /></span>
                </div>
                {/* live micro-preview window */}
                <div className="relative mt-3 h-20 overflow-hidden border border-hairline bg-bg">
                  <ModePreview id={id} reduced={reduced} />
                </div>
                <h2 className="display-caps mt-3 text-4xl text-ink">{m.name}</h2>
                <p className="mt-1 font-body text-sm italic text-ink/60">{m.tagline}</p>
                <p className="mt-3 font-body text-[0.95rem] leading-relaxed text-ink/80">{m.blurb}</p>
              </div>
            </motion.button>
          );
        })}
      </div>

      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <NeonButton variant="ghost" size="sm" onClick={onBack}>← Back to title</NeonButton>
        <NeonButton variant="ghost" size="sm" onClick={onLeaderboard}><TrophyIcon size={14} /> Leaderboards</NeonButton>
        <NeonButton variant="ghost" size="sm" onClick={onMasteryMap}><BrainIcon size={14} /> Money Brain</NeonButton>
        <span className="relative inline-flex">
          {/* bracket sweep arms the CTA once a card is chosen */}
          {picked && (
            <>
              <motion.span
                key={`${picked}-l`}
                initial={reduced ? false : { x: -10, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ duration: 0.25, ease: EASE }}
                aria-hidden
                className="pointer-events-none absolute -left-4 top-1/2 font-anton text-2xl text-ink"
                style={{ y: "-50%" }}
              >
                [
              </motion.span>
              <motion.span
                key={`${picked}-r`}
                initial={reduced ? false : { x: 10, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ duration: 0.25, ease: EASE }}
                aria-hidden
                className="pointer-events-none absolute -right-4 top-1/2 font-anton text-2xl text-ink"
                style={{ y: "-50%" }}
              >
                ]
              </motion.span>
            </>
          )}
          <NeonButton variant="primary" size="lg" disabled={!picked} onClick={() => { if (picked) { audio.sfx("confirm"); onChoose(picked); } }}>
            {picked ? `Start ${MODES[picked].name} →` : "Pick a mode"}
          </NeonButton>
        </span>
      </div>
    </div>
  );
}

/* ---------------- live micro-previews (Phase N) ---------------- */

function ModePreview({ id, reduced }: { id: ModeId; reduced: boolean }) {
  if (id === "cashflow") return <BoardPreview reduced={reduced} />;
  if (id === "story") return <MarketSparkline reduced={reduced} />;
  return <YearTicker reduced={reduced} />;
}

/** Rat Race — the Phase G board orbit, muted, playing only while on screen. */
function BoardPreview({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void el.play().catch(() => {});
        else el.pause();
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  if (reduced) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/board3d/board-poster.jpg" alt="" className="h-full w-full object-cover" />;
  }
  return (
    <video ref={ref} muted loop playsInline preload="none" poster="/board3d/board-poster.jpg" aria-hidden className="h-full w-full object-cover">
      <source src="/board3d/board-orbit.webm" type="video/webm" />
      <source src="/board3d/board-orbit.mp4" type="video/mp4" />
    </video>
  );
}

/** Story — the real S&P cumulative line from lib/markets (no year labels: spoiler-safe). */
function MarketSparkline({ reduced }: { reduced: boolean }) {
  const d = useMemo(() => {
    const values: number[] = [];
    let level = 1;
    for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) {
      level *= 1 + sp500Return(y) / 100;
      values.push(Math.log(level));
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    return values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * 196 + 2;
        const y = 58 - ((v - min) / span) * 52;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, []);

  return (
    <svg viewBox="0 0 200 64" className="h-full w-full" aria-hidden preserveAspectRatio="none">
      <motion.path
        d={d}
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth="1.5"
        initial={reduced ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: reduced ? 0 : 1.6, ease: EASE }}
      />
      <circle cx="198" cy="6" r="2.5" fill="var(--color-gain)" />
    </svg>
  );
}

/** Infinite — a relative-year counter (never calendar years: spoiler-safe). */
const YEAR_TICK_MS = 340;
const YEAR_LOOP_MAX = 99;

function YearTicker({ reduced }: { reduced: boolean }) {
  const [n, setN] = useState(1);

  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => setN((v) => (v >= YEAR_LOOP_MAX ? 1 : v + 1)), YEAR_TICK_MS);
    return () => window.clearInterval(id);
  }, [reduced]);

  return (
    <div className="flex h-full items-center justify-center gap-2">
      <span className="font-anton text-3xl tracking-[0.06em] text-ink" aria-hidden>
        YEAR {String(n).padStart(2, "0")}
      </span>
      <span className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-ink-dim" aria-hidden>
        + counting
      </span>
    </div>
  );
}
