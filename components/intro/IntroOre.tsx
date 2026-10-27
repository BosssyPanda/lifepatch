"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useLenis } from "@/hooks/useLenis";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import type { OreState } from "./ore/OreScene";
import { smoothstep, whiteOut } from "./ore/oreMotion";

// three only loads behind this import (same split as ColdOpen's BillVortex)
const OreScene = dynamic(() => import("./ore/OreScene"), { ssr: false });

/** How far the page scrolls through scene one, in viewport heights. */
const SCENE_LENGTH = 2.6;

/**
 * Preview of the intro's scene one: the gold ore. The canvas is pinned; the page under it is only
 * there to be scrolled, and its scroll position drives the scene. Words sit on flat --color-bg
 * plates (the intro UI rule: bare text on the scenes fails contrast).
 */
export function IntroOre() {
  const { reduced } = useMotionCtx();
  useLenis(true);

  const [ready, setReady] = useState(false);
  const [dragged, setDragged] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const state = useRef<OreState>({
    progress: 0,
    reduced: false,
    onReady: () => setReady(true),
    onFirstDrag: () => setDragged(true),
  });
  const white = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLParagraphElement>(null);

  state.current.reduced = reduced;

  useEffect(() => {
    // a scroll intro starts at its beginning, even on reload
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
    let raf = 0;
    const loop = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      state.current.progress = p;
      if (white.current) white.current.style.opacity = String(whiteOut(p));
      if (end.current) end.current.style.opacity = String(smoothstep(0.96, 1, p));
      setAtTop(p <= 0.01);
      if (p > 0.01) setScrolled(true);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // "Drag to turn" goes for good after the first drag, "Scroll to begin" after the first scroll
  // (Cindy's cards, 2026-10-27); the plate only shows while the ore is the user's to turn.
  const showDrag = !dragged;
  const showScroll = !scrolled;
  const showHint = ready && atTop && (showDrag || showScroll);

  return (
    <main id="main" className="relative bg-[var(--color-bg)]" style={{ height: `${(1 + SCENE_LENGTH) * 100}vh` }}>
      <div className="fixed inset-0">
        <OreScene state={state} />
      </div>

      {/* the end of the dive: the crack's light fills the screen */}
      <div
        ref={white}
        aria-hidden
        className="pointer-events-none fixed inset-0 bg-[var(--color-ink)]"
        style={{ opacity: 0 }}
      />

      <div className="pointer-events-none fixed inset-x-0 bottom-10 flex justify-center">
        <p
          className="eyebrow flex bg-[var(--color-bg)] px-3 py-2 text-[var(--color-ink-dim)] transition-opacity duration-700"
          style={{ opacity: showHint ? 1 : 0 }}
          aria-hidden={!showHint}
        >
          <Phrase shown={showDrag}>Drag to turn</Phrase>
          <Phrase shown={showDrag && showScroll}>&nbsp;·&nbsp;</Phrase>
          <Phrase shown={showScroll}>Scroll to begin</Phrase>
        </p>
      </div>

      {!ready && (
        <div className="pointer-events-none fixed inset-0 flex items-center justify-center">
          <p className="eyebrow bg-[var(--color-bg)] px-3 py-2 text-[var(--color-ink-dim)]">Loading the ore</p>
        </div>
      )}

      {/* preview only: there is no scene two yet */}
      <div className="pointer-events-none fixed inset-0 flex items-center justify-center">
        <p ref={end} className="eyebrow text-[var(--color-bg)]" style={{ opacity: 0 }}>
          End of scene one. The cave comes next.
        </p>
      </div>
    </main>
  );
}

/** One part of the hint plate: when it goes, it fades and the plate closes up round the rest. */
function Phrase({ shown, children }: { shown: boolean; children: React.ReactNode }) {
  return (
    <span
      className="inline-block overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-500"
      style={{ maxWidth: shown ? "16em" : 0, opacity: shown ? 1 : 0 }}
    >
      {children}
    </span>
  );
}
