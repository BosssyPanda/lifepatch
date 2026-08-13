"use client";

import type { ReactNode } from "react";
import { Board, type BoardSquareView } from "./Board";

export type { BoardSquareView };

type Board3DProps = {
  squares: BoardSquareView[];
  position: number;
  labelFor: (type: string) => string;
  tokenLabel: string;
  title: string;
  /** fires when the token settles on its destination square (with % coords) */
  onLand?: (type: string, at: { xPct: number; yPct: number }) => void;
  /** bump to ink-flash the payday squares (a payday was passed) */
  paydayFlash?: number;
  /** accepted for call-site compatibility; the 2D board has no hover SFX */
  onTileHover?: (type: string) => void;
  children?: ReactNode;
};

/**
 * Board renderer. The former WebGL variant was removed — `Board` (the flat,
 * editorial 2D board) is now the only renderer. Kept as a thin pass-through so
 * the `CashflowGame` call site (and its dynamic import) stay unchanged.
 */
export function Board3D({ squares, position, labelFor, tokenLabel, title, onLand, paydayFlash, children }: Board3DProps) {
  return (
    <Board
      squares={squares}
      position={position}
      labelFor={labelFor}
      tokenLabel={tokenLabel}
      title={title}
      onLand={onLand}
      paydayFlash={paydayFlash}
    >
      {children}
    </Board>
  );
}

export default Board3D;
