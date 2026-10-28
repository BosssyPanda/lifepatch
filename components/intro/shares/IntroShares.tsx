"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useLenis } from "@/hooks/useLenis";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import type { SharesState } from "./SharesScene";
import { smoothstep } from "./sharesMotion";

// three only loads behind this import (same split as the ore's)
const SharesScene = dynamic(() => import("./SharesScene"), { ssr: false });

/** How far the page scrolls through the scene, in viewport heights. */
const SCENE_LENGTH = 3;

/**
 * Preview of the intro's era five, the first company shares, on its own route. The canvas is pinned;
 * the page under it is only there to be scrolled, and its scroll position drives the scene. Words sit
 * on flat --color-bg plates (the intro UI rule: bare text on the scenes fails contrast).
 */
export function IntroShares() {
  const { reduced } = useMotionCtx();
  useLenis(true);

  const [ready, setReady] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const state = useRef<SharesState>({ progress: 0, reduced: false, onReady: () => setReady(true) });
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
      if (end.current) end.current.style.opacity = String(smoothstep(0.96, 1, p));
      setAtTop(p <= 0.01);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <main id="main" className="relative bg-[var(--color-bg)]" style={{ height: `${(1 + SCENE_LENGTH) * 100}vh` }}>
      <div className="fixed inset-0">
        <SharesScene state={state} />
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-10 flex justify-center">
        <p
          className="eyebrow bg-[var(--color-bg)] px-3 py-2 text-[var(--color-ink-dim)] transition-opacity duration-700"
          style={{ opacity: ready && atTop ? 1 : 0 }}
          aria-hidden={!(ready && atTop)}
        >
          Scroll
        </p>
      </div>

      {!ready && (
        <div className="pointer-events-none fixed inset-0 flex items-center justify-center">
          <p className="eyebrow bg-[var(--color-bg)] px-3 py-2 text-[var(--color-ink-dim)]">Loading 1602</p>
        </div>
      )}

      {/* preview only: the next era is its own scene */}
      <div className="pointer-events-none fixed inset-x-0 top-10 flex justify-center">
        <p ref={end} className="eyebrow bg-[var(--color-bg)] px-3 py-2 text-[var(--color-ink-dim)]" style={{ opacity: 0 }}>
          End of era five. Era six comes next.
        </p>
      </div>
    </main>
  );
}
