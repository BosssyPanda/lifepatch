"use client";

import { useCallback, useRef, type ReactNode } from "react";
import { BoardView, type BoardSquareView } from "./BoardView";

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
  tokenLabel,
  title,
  onLand,
  paydayFlash = 0,
  children,
}: {
  squares: BoardSquareView[];
  position: number;
  labelFor: (type: string) => string;
  tokenLabel: string;
  title: string;
  /** Fires when the token settles on its destination square (post-hop), with the square's % coords. */
  onLand?: (type: string, at: { xPct: number; yPct: number }) => void;
  /** Bump this counter to ink-flash the payday squares (a payday was passed). */
  paydayFlash?: number;
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

  return (
    <BoardView
      squares={squares}
      tokenIndex={position}
      activeIndex={position}
      labelFor={labelFor}
      playerInitial={tokenLabel}
      title={title}
      onSettle={onSettle}
      paydayFlash={paydayFlash}
    >
      {children}
    </BoardView>
  );
}

export default Board;
