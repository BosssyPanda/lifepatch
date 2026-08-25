"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { CheckIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/LedgerButton";
import { SectionMark } from "@/components/ui/SectionMark";
import { BACKGROUNDS } from "@/lib/backgrounds";
import { todaysDaily, type DailyPuzzle } from "@/lib/daily";
import { dailyStanding, type DailyStanding } from "@/lib/dailySave";
import { currency } from "@/lib/format";
import { netWorth, type RunState } from "@/lib/runEngine";
import { deriveVerdict } from "@/lib/verdict";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { EASE } from "@/src/motion/tokens";

/**
 * The Daily Ledger's front door.
 *
 * Not a fourth mode card. `ModeSelect` is a three-card composition on a
 * `lg:grid-cols-3` grid, and a fourth card would either break the row or demote all
 * three; the daily is also not a fifth way to play — it is one specific run of an
 * existing mode. So it lands as a docket ABOVE the cards: a folio number, a
 * hairline frame, and one line of state. That is the section grammar the rest of
 * the product already uses, and it leaves the three-card grid intact.
 *
 * It renders nothing on the server and nothing on the first client paint. The whole
 * strip is a statement about `localStorage`, which the server cannot see — painting
 * an optimistic "not played yet" and then correcting it is exactly the hydration
 * flicker the Opening screen was rewritten to avoid.
 */
export function DailyStrip({ onPlay }: { onPlay: (puzzle: DailyPuzzle, resume: RunState | null) => void }) {
  const { reduced } = useMotionCtx();
  const [puzzle, setPuzzle] = useState<DailyPuzzle | null>(null);
  const [standing, setStanding] = useState<DailyStanding | null>(null);

  useEffect(() => {
    const p = todaysDaily();
    setPuzzle(p);
    if (p) setStanding(dailyStanding(p.date));
  }, []);

  if (!puzzle || !standing) return null;

  const bg = BACKGROUNDS.find((b) => b.id === puzzle.backgroundId);
  const done = standing.kind === "done" ? standing.state : null;
  const open = standing.kind === "playing" ? standing.state : null;

  return (
    <motion.section
      initial={reduced ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE }}
      aria-labelledby="daily-heading"
      className="mt-10 border border-hairline-strong"
    >
      {/* Docket head. The puzzle number is the accent's quietest sanctioned job —
          a folio numeral marking WHERE you are, through the same component the
          landing's seven sections use. The strip's own button stays `secondary`:
          the screen's one primary belongs to the mode CTA below, and two orange
          fills in a viewport is how a 1–2% budget becomes a decoration. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-hairline px-4 py-2">
        <SectionMark n={String(puzzle.number).padStart(3, "0")} className="!text-[0.58rem]">
          Daily Ledger
        </SectionMark>
        <span className="eyebrow text-tertiary" style={{ fontSize: "0.58rem" }}>
          {bg ? `Everyone starts as ${bg.name}` : "One world for everybody"}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 px-4 py-4">
        <div className="min-w-0">
          <h2 id="daily-heading" className="display-caps text-2xl text-ink sm:text-3xl">
            {done ? "Today is filed" : open ? "Today is half-lived" : "One world. One life. Today only."}
          </h2>
          <p className="voice mt-1 text-sm text-ink/70">
            {done ? (
              <>
                {deriveVerdict(done).title} · {currency(Math.round(netWorth(done)))}. The next
                world opens at midnight UTC.
              </>
            ) : open ? (
              <>
                You are {standing.kind === "playing" ? standing.year : 1} years in. Pick up where you
                left off — the same cards are still waiting.
              </>
            ) : (
              <>
                The same markets, the same cards, the same opening as everyone else playing today.
                One attempt, and it stays on this device.
              </>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {done && (
            <span aria-hidden className="grid h-7 w-7 place-items-center border border-hairline-strong text-ink-dim">
              <CheckIcon size={14} />
            </span>
          )}
          <NeonButton variant="secondary" size="md" onClick={() => onPlay(puzzle, done ?? open)}>
            {done ? "Read the statement" : open ? "Resume today →" : "Play today →"}
          </NeonButton>
        </div>
      </div>
    </motion.section>
  );
}
