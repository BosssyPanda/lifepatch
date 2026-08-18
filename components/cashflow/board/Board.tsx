"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BoardView, type BoardDelta, type BoardSquareView } from "./BoardView";

export type { BoardSquareView };

/**
 * `Board` — the run's board.
 *
 * All the pixels live in `BoardView` (pure presentation, no game state, safe to
 * mount on a marketing page). This wrapper is the game-shaped face of it: it
 * speaks the run's vocabulary — `position`, `tokenLabel`, `onLand(type, …)` —
 * and translates it into view props. `CashflowGame` sees the API it always saw.
 */
export function Board({
  squares,
  position,
  labelFor,
  describeFor,
  tokenLabel,
  title,
  onLand,
  paydayFlash = 0,
  cash,
  children,
}: {
  squares: BoardSquareView[];
  position: number;
  labelFor: (type: string) => string;
  /** Full name for a square type — the tile's hover `title`. */
  describeFor?: (type: string) => string;
  tokenLabel: string;
  title: string;
  /** Fires when the token settles on its destination square (post-hop), with the square's % coords. */
  onLand?: (type: string, at: { xPct: number; yPct: number }) => void;
  /** Bump this counter to ink-flash the payday squares (a payday was passed). */
  paydayFlash?: number;
  /** The run's cash. Every change to it stamps a signed figure over the current square. */
  cash?: number;
  children?: ReactNode;
}) {
  // The view reports the ring INDEX it settled on; the turn machine wants the
  // square TYPE. Read through a ref so a fresh `onLand` closure each render never
  // re-identifies the callback and restarts the view's settle timer mid-hop.
  const onLandRef = useRef(onLand);
  onLandRef.current = onLand;
  const squaresRef = useRef(squares);
  squaresRef.current = squares;

  const onSettle = useCallback((index: number, at: { xPct: number; yPct: number }) => {
    const sq = squaresRef.current[index];
    if (sq) onLandRef.current?.(sq.type, at);
  }, []);

  // ── money stamps ───────────────────────────────────────────────────────────
  // Derived here rather than plumbed down from the screen, because "cash moved"
  // is the only signal that covers every way a square can cost or pay: a payday,
  // a doodad, a deal you bought, a market sale, a bank loan. The view is handed a
  // fact (`this much money moved on that square`) and decides how loudly to say
  // it; a `null` cash prop (any board that isn't a run) stamps nothing at all.
  const [delta, setDelta] = useState<BoardDelta | null>(null);
  const lastCash = useRef(cash);
  const seq = useRef(0);
  useEffect(() => {
    if (cash === undefined) return;
    const before = lastCash.current;
    lastCash.current = cash;
    if (before === undefined || cash === before) return;
    seq.current += 1;
    setDelta({ id: seq.current, index: position, amount: cash - before });
    // `position` is read, not watched: a move with no money in it is not a stamp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cash]);

  return (
    <BoardView
      squares={squares}
      tokenIndex={position}
      activeIndex={position}
      labelFor={labelFor}
      describeFor={describeFor}
      playerInitial={tokenLabel}
      title={title}
      onSettle={onSettle}
      paydayFlash={paydayFlash}
      delta={delta}
    >
      {children}
    </BoardView>
  );
}

export default Board;
