"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useLenis } from "@/hooks/useLenis";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import type { CaveState } from "./cave/CaveScene";
import { smoothstep, whiteIn } from "./cave/caveMotion";
import { PAINTINGS } from "./cave/paintings";

// three only loads behind this import (same split as IntroOre's OreScene)
const CaveScene = dynamic(() => import("./cave/CaveScene"), { ssr: false });

/** How far the page scrolls through scene two, in viewport heights. */
const SCENE_LENGTH = 2.4;
/** How long a painting's line stays up, in ms, unless another click replaces it. */
const LINE_FOR = 7000;

/**
 * Preview of the intro's scene two on its own: the cave, c. 30,000 BCE. It opens on the white scene
 * one ends on. The canvas is pinned and the page under it is only there to be scrolled. The ore
 * thread stitches the scenes into one journey at /intro; this route never replaces it. A click on
 * a group of paintings puts its one line on a plate (the intro UI rule: words on the scenes sit on
 * flat --color-bg plates).
 */
export function IntroCave() {
  const { reduced } = useMotionCtx();
  useLenis(true);

  const [ready, setReady] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const state = useRef<CaveState>({
    progress: 0,
    reduced: false,
    onReady: () => setReady(true),
    onPainting: (key) => {
      window.clearTimeout(timer.current);
      setLine(key ? PAINTINGS[key] : null);
      if (key) timer.current = window.setTimeout(() => setLine(null), LINE_FOR);
    },
  });
  const white = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLParagraphElement>(null);

  state.current.reduced = reduced;

  useEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
    let raf = 0;
    const loop = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      state.current.progress = p;
      if (white.current) white.current.style.opacity = String(whiteIn(p));
      if (end.current) end.current.style.opacity = String(smoothstep(0.96, 1, p));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <main id="main" className="relative bg-[var(--color-bg)]" style={{ height: `${(1 + SCENE_LENGTH) * 100}vh` }}>
      <div className="fixed inset-0">
        <CaveScene state={state} />
      </div>

      {/* where scene one left off: its white, thinning to the fire's glow */}
      <div ref={white} aria-hidden className="pointer-events-none fixed inset-0 bg-[var(--color-ink)]" />

      {!ready && (
        <div className="pointer-events-none fixed inset-0 flex items-center justify-center">
          <p className="eyebrow bg-[var(--color-bg)] px-3 py-2 text-[var(--color-ink-dim)]">Loading the cave</p>
        </div>
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-24 flex justify-center px-4" aria-live="polite">
        <p
          className="max-w-[40rem] bg-[var(--color-bg)] px-4 py-3 text-center text-[var(--color-ink)] transition-opacity duration-500"
          style={{ opacity: line ? 1 : 0 }}
        >
          {line ?? ""}
        </p>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-10 flex justify-center">
        <p ref={end} className="eyebrow bg-[var(--color-bg)] px-3 py-2 text-[var(--color-ink-dim)]" style={{ opacity: 0 }}>
          End of scene two. Lydia&rsquo;s coins come next.
        </p>
      </div>
    </main>
  );
}
