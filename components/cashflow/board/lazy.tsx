"use client";

import dynamic from "next/dynamic";
import { TerminalOp } from "@/components/ui/TerminalOp";

/**
 * The board's chunks, kept out of every other bundle. Both are only ever mounted by
 * the cashflow screen. The dice overlay is the one piece that still needs WebGL, so
 * the probe that gates it lives here too (`useCashflowTurn` prefetches through it).
 */

// The board is flat 2D DOM — no WebGL, no canvas — but it is still the biggest
// component on the screen and nothing outside the cashflow shell renders it, so it
// stays split out of the landing bundle.
export const Board = dynamic(() => import("@/components/cashflow/board/Board").then((m) => m.Board), {
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
// bundle until the first roll on this screen, and are the only WebGL left in the
// game. Falls back to the classic timed roll when WebGL is unavailable or
// reduced motion is on.
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
