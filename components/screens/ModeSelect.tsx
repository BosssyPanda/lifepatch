"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { BrainIcon, CheckIcon, FreedomIcon, ReplayIcon, TrophyIcon } from "@/components/icons";
import { BoardView } from "@/components/cashflow/board/BoardView";
import { DailyStrip } from "@/components/screens/DailyStrip";
import { NeonButton } from "@/components/ui/LedgerButton";
import { SoundCell } from "@/components/ui/SoundCell";
import { StreakChip } from "@/components/social/StreakChip";
import { useAudio } from "@/hooks/useAudio";
import { RAT_BOARD, RAT_SQUARE_META } from "@/lib/cashflow/board";
import type { DailyPuzzle } from "@/lib/daily";
import { FIRST_YEAR, LAST_YEAR, sp500Return } from "@/lib/markets";
import { MODES, type ModeId } from "@/lib/modes";
import type { RunState } from "@/lib/runEngine";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { useSpotlightHandler } from "@/src/motion/useSpotlight";
import { EASE, SPRING } from "@/src/motion/tokens";

const ICON = { story: TrophyIcon, infinite: ReplayIcon, cashflow: FreedomIcon };

export function ModeSelect({
  onChoose,
  onBack,
  onLeaderboard,
  onMasteryMap,
  onDaily,
}: {
  onChoose: (mode: ModeId) => void;
  onBack: () => void;
  onLeaderboard: () => void;
  onMasteryMap: () => void;
  /** Start, resume or re-read today's Daily Ledger. */
  onDaily: (puzzle: DailyPuzzle, resume: RunState | null) => void;
}) {
  const audio = useAudio();
  const { reduced } = useMotionCtx();
  const onSpot = useSpotlightHandler<HTMLButtonElement>();
  const modes: ModeId[] = ["story", "infinite", "cashflow"];
  const [picked, setPicked] = useState<ModeId | null>(null);

  return (
    <div className="mx-auto flex min-h-[100svh] w-full max-w-4xl flex-col justify-center px-5 py-14">
      {/* The screen's chrome row: the streak the player has earned, and the sound
          control every non-run screen now carries in the same corner. */}
      <div className="mb-4 flex flex-wrap items-center justify-end gap-3"><StreakChip /><SoundCell /></div>
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <p className="eyebrow text-ink">Choose your run</p>
        <h1 className="display-caps mt-3 text-4xl text-ink sm:text-6xl">Three ways to play</h1>
        <div className="mx-auto mt-5 h-px w-24 bg-ink" />
      </motion.div>

      {/* Above the cards, never a fourth one — see components/screens/DailyStrip.tsx. */}
      <DailyStrip onPlay={onDaily} />

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {modes.map((id, i) => {
          const m = MODES[id];
          const Icon = ICON[id];
          const active = picked === id;
          return (
            <motion.button
              key={id}
              type="button"
              onClick={() => { audio.sfx("click"); setPicked(id); }}
              aria-pressed={active}
              initial={{ opacity: 0, y: 26, rotate: i % 2 ? 1 : -1 }}
              // 0.8 is the floor for the recede: the blurb's faintest text is text-ink/60,
              // which starts near 4.5:1, so anything lower drops it through the contrast floor.
              animate={{ opacity: picked && !active ? 0.8 : 1, y: 0, rotate: active ? 0 : i % 2 ? 1 : -1, scale: active ? 1.03 : 1 }}
              transition={{ ...SPRING.pop, delay: i * 0.1 }}
              whileHover={reduced ? undefined : { y: -6 }}
              data-radius=""
              // 2px inset ACCENT outline: `ring-*` is box-shadow, which the LEDGER reset
              // kills, so the "picked" card had no border treatment at all. Orange because
              // the chosen card is the primary path — the one thing on this screen that is
              // about to happen. The wash under it stays ink: a hue would fight the board.
              style={active ? { outline: "2px solid var(--color-accent)", outlineOffset: "-2px" } : undefined}
              onPointerMove={onSpot}
              className="paper spotlight group relative overflow-hidden p-6 text-left"
            >
              {/* darker overlay + check on the chosen card */}
              {active && (
                <>
                  <span className="pointer-events-none absolute inset-0 bg-ink/15" />
                  <span data-radius="round" className="absolute right-3 top-3 z-10 grid h-7 w-7 place-items-center border-2 border-bg bg-accent text-bg">
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
                <p className="voice mt-1 text-sm text-ink/60">{m.tagline}</p>
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
  if (id === "cashflow") return <BoardPreview />;
  if (id === "story") return <MarketSparkline reduced={reduced} />;
  return <YearTicker reduced={reduced} />;
}

/**
 * Rat Race — the REAL board, in miniature.
 *
 * This window used to play `/board3d/board-orbit.webm`, an orbiting render of a 3D
 * board that no longer exists in this game: you picked Rat Race off a card showing
 * one board and landed on a completely different one. It now mounts `BoardView` —
 * the same component the run and the landing's Arena render (see
 * `components/cinematic/landing/BoardPreview.tsx`, which drives it the same way,
 * without game state) — so the card cannot drift from the board again.
 *
 * Static and inert by construction, not by flag: no `onSquareHover` means BoardView
 * attaches no listeners at all, and a `tokenIndex` that never changes means no hop
 * path, no springs, no timers — nothing here ticks whether or not motion is reduced.
 * `describeFor` is deliberately omitted too: `title` tooltips inside a <button> are
 * noise. The card is a button, so the whole preview is `aria-hidden` — the mode's
 * name, tagline and blurb are the real text under it.
 *
 * The board is laid out at its own natural size and scaled into the 80px window, so
 * the tiles keep the proportions (and the container-query type scale) they have in
 * the game instead of collapsing at a size the labels were never solved for.
 */
const CARD_BOARD_PX = 232;
const CARD_WINDOW_PX = 80;
/** One "you are here" square, so the card carries the board's accent the way the run does. */
const CARD_ACTIVE_SQUARE = 5;

function BoardPreview() {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      {/* Centred by margin, not by `place-items-center`: the window is a scroll
          container (overflow: hidden), and CSS box alignment treats centring in a
          scroll container as SAFE — an item bigger than the box falls back to
          start-alignment rather than overflowing both ways. The 232px board did
          exactly that and hung out of the bottom of the frame. Half-negative
          margins put its centre on the window's centre with no alignment involved,
          and `scale` about that centre keeps it there. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: CARD_BOARD_PX,
          height: CARD_BOARD_PX,
          marginLeft: -CARD_BOARD_PX / 2,
          marginTop: -CARD_BOARD_PX / 2,
          transform: `scale(${CARD_WINDOW_PX / CARD_BOARD_PX})`,
          transformOrigin: "center",
        }}
      >
        <BoardView
          squares={RAT_BOARD}
          tokenIndex={CARD_ACTIVE_SQUARE}
          activeIndex={CARD_ACTIVE_SQUARE}
          labelFor={(t) => RAT_SQUARE_META[t as keyof typeof RAT_SQUARE_META]?.short ?? "?"}
          playerInitial="P"
          title="Rat Race"
        />
      </div>
    </div>
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
