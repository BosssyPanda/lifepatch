"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useAudio } from "@/hooks/useAudio";

/**
 * Split-flap / Solari-board verdict display (Addendum A §7.1 / §13 #5) — prototype (b).
 * Each character cycles through glyphs and flips (CSS 3D rotateX) to rest on its target,
 * later characters settling last, with a mechanical clack per character as it locks.
 * Flat mono glyphs, hairline cells — LEDGER. Reduced motion renders the final word, no flaps.
 */

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const FLIP_MS = 55;

function Flap({ target, index, hex, reduced, onSettle }: { target: string; index: number; hex: string; reduced: boolean; onSettle: () => void }) {
  const isSpace = target === " ";
  const [state, setState] = useState<{ ch: string; flip: number }>(() => ({ ch: reduced || isSpace ? target : GLYPHS[0], flip: 0 }));

  useEffect(() => {
    if (reduced || isSpace) return;
    const flips = 7 + index * 3; // stagger: later cells lock later (Solari cascade)
    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      if (n >= flips) {
        window.clearInterval(id);
        setState((s) => ({ ch: target, flip: s.flip + 1 }));
        onSettle();
      } else {
        setState((s) => ({ ch: GLYPHS[(Math.random() * GLYPHS.length) | 0], flip: s.flip + 1 }));
      }
    }, FLIP_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, index, reduced]);

  return (
    <span
      className="relative inline-flex items-center justify-center overflow-hidden border border-hairline bg-bg2"
      style={{ width: "0.86em", height: "1.2em", perspective: "220px" }}
      aria-hidden
    >
      {/* seam line across the flap middle */}
      <span className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-px -translate-y-1/2 bg-bg" />
      <motion.span
        key={state.flip}
        initial={reduced ? false : { rotateX: -88, opacity: 0.4 }}
        animate={{ rotateX: 0, opacity: 1 }}
        transition={{ duration: 0.09, ease: "easeOut" }}
        className="font-anton leading-none"
        style={{ color: state.ch === target && !isSpace ? hex : "var(--color-ink)", transformOrigin: "center" }}
      >
        {isSpace ? " " : state.ch}
      </motion.span>
    </span>
  );
}

export function SplitFlap({ text, hex, active, reduced = false, className = "" }: { text: string; hex: string; active: boolean; reduced?: boolean; className?: string }) {
  const audio = useAudio();
  const chars = text.toUpperCase().split("");
  const settledRef = useRef(0);

  const onSettle = () => {
    settledRef.current += 1;
    try { audio.sfx("uitick"); } catch {} // one clack as each character locks
  };

  if (!active && !reduced) {
    // pre-roll: hold a row of blanks so layout is stable (no CLS)
    return (
      <span className={`inline-flex gap-[0.12em] ${className}`} aria-label={text}>
        {chars.map((_, i) => (
          <span key={i} className="inline-flex border border-hairline bg-bg2" style={{ width: "0.86em", height: "1.2em" }} aria-hidden />
        ))}
      </span>
    );
  }

  return (
    <span className={`inline-flex gap-[0.12em] ${className}`} role="text" aria-label={text}>
      {chars.map((ch, i) => (
        <Flap key={i} target={ch} index={i} hex={hex} reduced={reduced} onSettle={onSettle} />
      ))}
    </span>
  );
}
