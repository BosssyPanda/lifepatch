"use client";

import { RAT_BOARD, RAT_SQUARE_META } from "@/lib/cashflow/board";
import type { RatSquareType } from "@/lib/cashflow/types";
import { BoardPreview } from "./BoardPreview";
import { SectionMark } from "@/components/ui/SectionMark";

/**
 * Landing set piece 003 — "THE ARENA".
 *
 * The section that shows you the ring you are about to be stuck in. It used to
 * pin 220svh of scroll to orbit a three/R3F rebuild of the board; it now frames
 * the real in-game board component (`BoardView`, via `BoardPreview`) fed the
 * real `RAT_BOARD` data. Same claim — "nothing staged" — except now it is
 * literally true, and it costs a few hundred DOM nodes instead of a GL context,
 * a scroll-driven camera and a poster fallback for everyone without WebGL.
 *
 * Scroll height went with it: a section only earns 220svh if 220svh of scroll
 * is doing something. This one is a normal section now.
 */

// derived, in first-appearance order — the honest contents of the ring
const TALLY = RAT_BOARD.reduce<{ type: RatSquareType; n: number }[]>((acc, sq) => {
  const hit = acc.find((t) => t.type === sq.type);
  if (hit) hit.n += 1;
  else acc.push({ type: sq.type, n: 1 });
  return acc;
}, []);

export function BoardDiorama() {
  return (
    <section className="border-t border-hairline px-5 py-20 sm:px-10 lg:px-16" aria-labelledby="arena-heading">
      <SectionMark n="003">The Arena</SectionMark>
      <h2 id="arena-heading" className="display-caps mt-2 text-3xl text-ink sm:text-5xl">
        Twenty-four squares. No exits.
      </h2>
      <p className="mt-3 max-w-xl font-body text-sm leading-relaxed text-ink-dim">
        The real Rat Race ring, rendered by the same component the game renders — nothing staged, and in the exact
        order a player meets it.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {TALLY.map(({ type, n }) => (
          <span key={type} className="num border border-hairline px-2 py-1 text-tertiary" style={{ fontSize: "0.6rem" }}>
            {n}× {RAT_SQUARE_META[type].label}
          </span>
        ))}
      </div>

      {/* The stage — dice-overlay frame language, double hairline rule. Capped and
          left-aligned under the heading: the board is 560px at its widest, and a
          full-bleed 1440px frame around it read as a small board lost in a big
          empty box. */}
      <div className="relative mt-8 max-w-[720px] border border-hairline bg-bg">
        <div aria-hidden className="pointer-events-none absolute inset-3 border border-hairline" />
        <div className="relative px-5 py-7 sm:px-10 sm:py-12">
          <BoardPreview />
        </div>
      </div>
    </section>
  );
}
