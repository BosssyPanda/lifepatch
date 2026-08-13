"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAudio } from "@/hooks/useAudio";

/**
 * Split-flap / Solari-board verdict display (Addendum A §7.1 / §13 #5) — prototype (b).
 * Each character cycles through glyphs and flips (CSS 3D rotateX) to rest on its target,
 * later characters settling last, with a mechanical clack per character as it locks.
 * Flat mono glyphs, hairline cells — LEDGER. Reduced motion renders the final word, no flaps.
 *
 * ── the conductor ─────────────────────────────────────────────────────────────
 * Every character used to run its OWN `setInterval(55)`: a 16-char verdict meant 16
 * uncoordinated timers, each calling `setState` on its own cell and each firing
 * `audio.sfx("uitick")` the instant it settled — the game's climax was also its
 * jankiest frame, and the clacks arrived as a machine-gun burst.
 *
 * One rAF loop drives the whole board now. It advances every cell off the same frame
 * clock at the same FLIP_MS cadence (so the Solari cascade is visually unchanged),
 * batches the result into a single `setState` per tick instead of one per character,
 * gates the clack to at most one per TICK_MIN_MS across the whole word, and lifts
 * `will-change: transform` off each cell the moment it locks.
 */

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const FLIP_MS = 55;
/** Global floor between clacks — 16 characters must not machine-gun the SFX bus. */
const TICK_MIN_MS = 70;
/** Stagger: later cells lock later (the Solari cascade), in flips. */
const flipsFor = (index: number) => 7 + index * 3;

type Cell = { ch: string; flip: number; settled: boolean };

function Flap({ cell, target, hex, reduced }: { cell: Cell; target: string; hex: string; reduced: boolean }) {
  const isSpace = target === " ";
  return (
    <span
      className="relative inline-flex items-center justify-center overflow-hidden border border-hairline bg-bg2"
      style={{ width: "0.86em", height: "1.2em", perspective: "220px" }}
      aria-hidden
    >
      {/* seam line across the flap middle */}
      <span className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-px -translate-y-1/2 bg-bg" />
      <motion.span
        key={cell.flip}
        initial={reduced ? false : { rotateX: -88, opacity: 0.4 }}
        animate={{ rotateX: 0, opacity: 1 }}
        transition={{ duration: 0.09, ease: "easeOut" }}
        className="font-anton leading-none"
        style={{
          color: cell.ch === target && !isSpace ? hex : "var(--color-ink)",
          transformOrigin: "center",
          // promoted only while this cell is still flipping, dropped when it locks
          willChange: cell.settled || isSpace ? undefined : "transform",
        }}
      >
        {isSpace ? " " : cell.ch}
      </motion.span>
    </span>
  );
}

export function SplitFlap({ text, hex, active, reduced = false, className = "" }: { text: string; hex: string; active: boolean; reduced?: boolean; className?: string }) {
  const audio = useAudio();
  const chars = useMemo(() => text.toUpperCase().split(""), [text]);
  const running = active && !reduced;

  const restingCells = useMemo(
    () => chars.map((ch) => ({ ch: reduced || ch === " " ? ch : GLYPHS[0], flip: 0, settled: reduced || ch === " " })),
    [chars, reduced],
  );
  const [cells, setCells] = useState<Cell[]>(restingCells);
  // The conductor owns the truth and pushes whole boards into React, so the per-tick
  // bookkeeping never has to be read back out of a state updater.
  const cellsRef = useRef<Cell[]>(cells);
  const audioRef = useRef(audio);
  audioRef.current = audio;

  useEffect(() => {
    if (!running) {
      cellsRef.current = restingCells;
      setCells(restingCells);
      return;
    }

    cellsRef.current = restingCells;
    setCells(restingCells);

    const start = performance.now();
    let lastClackAt = -Infinity; // last clack, shared by the whole board
    let lastStep = -1;
    let raf = 0;

    const loop = (now: number) => {
      // one shared frame clock: which flip step every cell should be on by now
      const step = Math.floor((now - start) / FLIP_MS);
      if (step !== lastStep) {
        lastStep = step;
        const prev = cellsRef.current;
        let changed = false;
        let settledNow = false;
        let allSettled = true;

        const next = prev.map((cell, i) => {
          const ch = chars[i];
          if (ch === " ") return cell;
          if (step >= flipsFor(i)) {
            if (cell.settled) return cell;
            changed = true;
            settledNow = true;
            return { ch, flip: cell.flip + 1, settled: true };
          }
          allSettled = false;
          if (step <= 0) return cell;
          changed = true;
          return { ch: GLYPHS[(Math.random() * GLYPHS.length) | 0], flip: step, settled: false };
        });

        if (changed) {
          cellsRef.current = next;
          setCells(next); // ONE render per shared tick, not one per character
        }
        // one clack per settle, throttled globally so 16 cells can't machine-gun
        if (settledNow && now - lastClackAt >= TICK_MIN_MS) {
          lastClackAt = now;
          try { audioRef.current.sfx("uitick"); } catch {}
        }
        if (allSettled) return; // board is locked — stop the loop
      }
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // `audio` is read through a ref; re-running on its identity would restart the board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, restingCells, chars]);

  if (!active && !reduced) {
    // pre-roll: hold a row of blanks so layout is stable (no CLS)
    return (
      <span className={`inline-flex gap-[0.12em] ${className}`} role="img" aria-label={text}>
        {chars.map((_, i) => (
          <span key={i} className="inline-flex border border-hairline bg-bg2" style={{ width: "0.86em", height: "1.2em" }} aria-hidden />
        ))}
      </span>
    );
  }

  // role="img" + aria-label, not role="text": the latter was dropped from ARIA and only
  // Safari implements it, so everywhere else the verdict read as loose letters or nothing.
  return (
    <span className={`inline-flex gap-[0.12em] ${className}`} role="img" aria-label={text}>
      {chars.map((ch, i) => (
        <Flap key={i} cell={cells[i] ?? { ch, flip: 0, settled: true }} target={ch} hex={hex} reduced={reduced} />
      ))}
    </span>
  );
}
