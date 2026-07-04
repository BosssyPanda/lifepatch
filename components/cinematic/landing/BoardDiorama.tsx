"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { RAT_BOARD, RAT_SQUARE_META } from "@/lib/cashflow/board";
import type { RatSquareType } from "@/lib/cashflow/types";
import { useMotionCtx } from "@/src/motion/MotionProvider";

/**
 * Landing set piece 003 — "THE ARENA" (spectacle Phase L).
 * The light shell around the live 3D board: a pinned stage inside a tall
 * section, framed like the dice overlay (double hairline rule). The heavy
 * three/R3F half (BoardScene) is fetched only when the section comes within
 * ~600px of the viewport; reduced motion or missing WebGL never fetches it
 * and shows the framed Blender poster still instead. Tile hover reports back
 * here and stamps a DOM plate with the square's real META label.
 */

const BoardScene = dynamic(() => import("./BoardScene").then((m) => m.BoardScene), { ssr: false });

type Hover = { index: number; type: RatSquareType } | null;

// derived, in first-appearance order — the honest contents of the ring
const TALLY = RAT_BOARD.reduce<{ type: RatSquareType; n: number }[]>((acc, sq) => {
  const hit = acc.find((t) => t.type === sq.type);
  if (hit) hit.n += 1;
  else acc.push({ type: sq.type, n: 1 });
  return acc;
}, []);

function supportsWebgl(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function Header() {
  return (
    <div>
      <p className="eyebrow text-secondary">003 — The Arena</p>
      <h2 id="arena-heading" className="display-caps mt-2 text-3xl text-ink sm:text-5xl">
        Twenty-four squares. No exits.
      </h2>
      <p className="mt-3 max-w-xl font-body text-sm leading-relaxed text-ink-dim">
        The real Rat Race ring, rebuilt live from the engine&apos;s board data — nothing staged.
        Scroll walks the camera.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {TALLY.map(({ type, n }) => (
          <span key={type} className="num border border-hairline px-2 py-1 text-tertiary" style={{ fontSize: "0.6rem" }}>
            {n}× {RAT_SQUARE_META[type].label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function BoardDiorama() {
  const { reduced } = useMotionCtx();
  const sectionRef = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const [docVisible, setDocVisible] = useState(true);
  const [webgl, setWebgl] = useState(false);
  const [hoverCapable, setHoverCapable] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [hover, setHover] = useState<Hover>(null);

  useEffect(() => {
    setWebgl(supportsWebgl());
    setHoverCapable(window.matchMedia("(hover: hover) and (pointer: fine)").matches);
    const onVisibility = () => setDocVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // arm the three fetch well before the pixels arrive; freeze frames off-screen
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || reduced) return;
    const nearIO = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setNear(true); nearIO.disconnect(); } },
      { rootMargin: "600px 0px" },
    );
    const liveIO = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { rootMargin: "120px 0px" });
    nearIO.observe(el);
    liveIO.observe(el);
    return () => { nearIO.disconnect(); liveIO.disconnect(); };
  }, [reduced]);

  const onHover = useCallback((sq: Hover) => setHover(sq), []);
  const onReady = useCallback(() => setSceneReady(true), []);

  const showScene = near && webgl && !reduced;

  // Reduced motion (or no WebGL at all): the framed poster as a plain document.
  if (reduced) {
    return (
      <section className="border-t border-hairline px-5 py-20 sm:px-10 lg:px-16" aria-labelledby="arena-heading">
        <Header />
        <div className="relative mt-8 border border-hairline">
          <img
            src="/board3d/board-poster.jpg"
            alt="The LIFEPATCH Rat Race board — 24 squares around a central ledger slab."
            className="w-full object-cover"
            loading="lazy"
            decoding="async"
          />
          <div aria-hidden className="pointer-events-none absolute inset-3 border border-hairline" />
        </div>
      </section>
    );
  }

  return (
    <section ref={sectionRef} className="relative h-[220svh] border-t border-hairline" aria-labelledby="arena-heading">
      <div className="sticky top-0 flex h-[100svh] flex-col overflow-hidden px-5 py-10 sm:px-10 lg:px-16">
        <Header />

        {/* the stage — dice-overlay frame language */}
        <div className="relative mt-6 min-h-0 flex-1 border border-hairline bg-bg">
          <img
            src="/board3d/board-poster.jpg"
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover transition-opacity duration-500"
            style={{ opacity: sceneReady ? 0 : 1 }}
            loading="lazy"
            decoding="async"
          />
          {showScene ? (
            <div
              aria-hidden
              className="absolute inset-0 transition-opacity duration-500"
              style={{ opacity: sceneReady ? 1 : 0 }}
            >
              <BoardScene
                targetRef={sectionRef}
                active={onScreen && docVisible}
                hoverCapable={hoverCapable}
                onHover={onHover}
                onReady={onReady}
              />
            </div>
          ) : null}
          <div aria-hidden className="pointer-events-none absolute inset-3 border border-hairline" />

          {/* hover readout plate */}
          <div
            className="pointer-events-none absolute bottom-5 left-5 border border-ink bg-bg px-3 py-2 transition-opacity duration-200"
            style={{ opacity: hover ? 1 : 0 }}
            aria-live="polite"
          >
            <span className="num text-ink" style={{ fontSize: "0.72rem", letterSpacing: "0.12em" }}>
              {hover
                ? `SQ ${String(hover.index + 1).padStart(2, "0")} / ${RAT_BOARD.length} — ${RAT_SQUARE_META[hover.type].label.toUpperCase()}`
                : ""}
            </span>
          </div>

          {/* operating hint */}
          <div className="pointer-events-none absolute right-5 top-5">
            <span className="eyebrow text-tertiary" style={{ fontSize: "0.55rem" }}>
              {hoverCapable ? "[ Scroll to orbit — hover a square to read it ]" : "[ Scroll to orbit the table ]"}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
