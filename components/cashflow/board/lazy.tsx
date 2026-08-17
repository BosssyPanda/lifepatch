"use client";

import dynamic from "next/dynamic";
import { TerminalOp } from "@/components/ui/TerminalOp";

/**
 * The board's heavy chunks, kept out of every other bundle. Both are only ever mounted by
 * the cashflow screen, and both have a non-WebGL path, so the WebGL probe that decides
 * between them lives here too.
 */

// WebGL board is loaded only inside the cashflow shell (never the landing bundle).
// It self-falls-back to the flat 2D <Board> when WebGL is unavailable.
export const Board3D = dynamic(() => import("@/components/cashflow/board/Board3D").then((m) => m.Board3D), {
  ssr: false,
  // A bare empty box read as "the board area is broken" on first load — a hairline
  // frame + terminal caret, same grammar as AppShell's screen fallback.
  loading: () => (
    <div className="mx-auto grid aspect-square w-full max-w-[560px] place-items-center border border-hairline bg-bg2">
      <TerminalOp label="Setting the board" center />
    </div>
  ),
});

// Physics roll overlay (Addendum §13 #10) — three/R3F/Rapier stay out of every
// bundle until the first roll on this screen. Falls back to the classic timed
// roll when WebGL is unavailable or reduced motion is on.
export const DiceRollOverlay = dynamic(() => import("@/components/cashflow/board/DiceRollOverlay"), { ssr: false });

let webglProbe: boolean | null = null;
export function hasWebGL(): boolean {
  if (webglProbe !== null) return webglProbe;
  try {
    const c = document.createElement("canvas");
    webglProbe = !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    webglProbe = false;
  }
  return webglProbe;
}
