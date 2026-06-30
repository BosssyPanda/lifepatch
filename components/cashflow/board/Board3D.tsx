"use client";

import type { ReactNode } from "react";
import { Board, type BoardSquareView } from "./Board";

export type { BoardSquareView };

type Board3DProps = {
  squares: BoardSquareView[];
  position: number;
  colorFor: (type: string) => string;
  labelFor: (type: string) => string;
  tokenLabel: string;
  title: string;
  /** accepted for call-site compatibility; the 2D board has no settle/hover SFX */
  onLand?: (type: string) => void;
  onTileHover?: (type: string) => void;
  children?: ReactNode;
};

/**
 * Board renderer. The former WebGL variant was removed — `Board` (the flat,
 * editorial 2D board) is now the only renderer. Kept as a thin pass-through so
 * the `CashflowGame` call site (and its dynamic import) stay unchanged.
 */
export function Board3D({ squares, position, colorFor, labelFor, tokenLabel, title, children }: Board3DProps) {
  return (
    <Board
      squares={squares}
      position={position}
      colorFor={colorFor}
      labelFor={labelFor}
      tokenLabel={tokenLabel}
      title={title}
    >
      {children}
    </Board>
  );
}

export default Board3D;
