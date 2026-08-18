"use client";

import { useEffect, useRef, useState } from "react";
import { BoardView } from "@/components/cashflow/board/BoardView";
import { RAT_BOARD, RAT_SQUARE_META } from "@/lib/cashflow/board";
import { useMotionCtx } from "@/src/motion/MotionProvider";

/**
 * The Arena's board, rendered by the same component the run renders.
 *
 * This used to be a three/R3F scene (`BoardScene`) with its own geometry, its
 * own tile palette and its own idea of what a square looks like — a second
 * board that had to be kept in sync with the real one by hand, for a section
 * nobody plays. It is now `BoardView`: the actual in-game board component, fed
 * the actual `RAT_BOARD` ring, with a scripted token walking the loop instead
 * of a player rolling dice. One board, one source of truth, zero WebGL.
 *
 * Reduced motion parks the token on square 01 and never starts the walk. The
 * walk also stops whenever the section is off-screen or the tab is hidden —
 * nothing should tick for an audience that isn't there.
 */

const STEP_MS = 900;
const SIZE = RAT_BOARD.length;

export function BoardPreview() {
  const { reduced } = useMotionCtx();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const [hoverCapable, setHoverCapable] = useState(false);

  useEffect(() => {
    setHoverCapable(window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  }, []);

  // Walk the ring — but only while somebody could be looking at it.
  useEffect(() => {
    if (reduced) return;
    const el = wrapRef.current;
    let onScreen = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const sync = () => {
      const shouldRun = onScreen && document.visibilityState === "visible";
      if (shouldRun && !timer) timer = setInterval(() => setPos((p) => (p + 1) % SIZE), STEP_MS);
      else if (!shouldRun) stop();
    };

    let io: IntersectionObserver | null = null;
    if (el && typeof IntersectionObserver !== "undefined") {
      onScreen = false;
      io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; sync(); }, { rootMargin: "80px 0px" });
      io.observe(el);
    }
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      stop();
      io?.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [reduced]);

  // Hover wins when there is a pointer; otherwise the readout follows the token,
  // so a touch device still gets a plate that says something true.
  const readIndex = hovered ?? pos;
  const readType = RAT_BOARD[readIndex].type;

  return (
    /* Decorative in full: the section's actual content — the heading, the prose
       and the per-type tally — is real text in `BoardDiorama`'s header. Left
       exposed, a readout that re-states the token's square every 900ms would
       announce itself to a screen reader roughly once a second, forever. */
    <div ref={wrapRef} aria-hidden>
      {/* `activeIndex` is the square you're READING, not the one the token is on —
          in the run those are the same square, here they are not. Flooding the
          chip under the token with accent would swallow the token's own keyline
          and cost the walk its only legible cue. */}
      <BoardView
        squares={RAT_BOARD}
        tokenIndex={pos}
        activeIndex={hovered}
        labelFor={(t) => RAT_SQUARE_META[t as keyof typeof RAT_SQUARE_META]?.short ?? "?"}
        describeFor={(t) => RAT_SQUARE_META[t as keyof typeof RAT_SQUARE_META]?.label ?? t}
        // "P" for Player — the glyph an unnamed run actually stamps on its token
        // (`engine.ts` defaults `playerName` to "Player"). Blank, the token is a
        // featureless ink square and reads as a chip that failed to render.
        playerInitial="P"
        title="Escape the Rat Race"
        onSquareHover={(sq) => setHovered(sq ? sq.index : null)}
      >
        <p className="num mt-2 text-ink" style={{ fontSize: "clamp(0.8rem, 4cqi, 1.05rem)", letterSpacing: "0.1em" }}>
          {String(pos + 1).padStart(2, "0")} / {SIZE}
        </p>
        <p className="eyebrow mt-1 text-tertiary" style={{ fontSize: "0.5rem" }}>
          No exit square
        </p>
      </BoardView>

      {/* readout plate — under the board, not floating over it, so it survives a
          390px stage without landing on top of a corner chip */}
      <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-t border-hairline pt-3">
        <span className="num text-ink" style={{ fontSize: "0.72rem", letterSpacing: "0.12em" }}>
          SQ {String(readIndex + 1).padStart(2, "0")} / {SIZE} — {RAT_SQUARE_META[readType].label.toUpperCase()}
        </span>
        <span className="eyebrow text-tertiary" style={{ fontSize: "0.55rem" }}>
          {hoverCapable
            ? "[ Hover a square to read it ]"
            : reduced
              ? "[ Twenty-four squares · one loop ]"
              : "[ The token walks the loop ]"}
        </span>
      </div>
    </div>
  );
}
