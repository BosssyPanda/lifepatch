"use client";

import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import type { PointerEvent } from "react";
import { DataAtlas } from "./DataAtlas";
import { MuteButton } from "./Controls";
import { FilmLayer } from "./film/FilmLayer";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { EASE, SPRING } from "@/src/motion/tokens";

/** Drifting ink motes over the Atlas — Phase R "living" garnish (film exception). */
const MOTES = [
  { left: "18%", size: 2, dur: 11, delay: 0 },
  { left: "34%", size: 1.5, dur: 14, delay: 2.4 },
  { left: "48%", size: 2.5, dur: 9.5, delay: 1.1 },
  { left: "61%", size: 1.5, dur: 12.5, delay: 4.2 },
  { left: "72%", size: 2, dur: 10.5, delay: 0.8 },
  { left: "84%", size: 1.5, dur: 13.5, delay: 3.0 },
];

export function Gate({
  onBegin,
  muted,
  onToggleMute,
}: {
  onBegin: () => void;
  muted: boolean;
  onToggleMute: () => void;
}) {
  // via MotionCtx, not framer's hook: the provider holds `reduced` false through the
  // first client paint so this SSR-visible tree hydrates against matching markup.
  const { reduced: reduce } = useMotionCtx();

  // normalized pointer (−0.5..0.5), springed — drives layered parallax in DataAtlas
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 60, damping: 18 });
  const sy = useSpring(py, { stiffness: 60, damping: 18 });
  // Phase R: the whole illustration plane also TILTS toward the pointer (real
  // perspective depth on top of the per-layer translate parallax).
  const tiltX = useTransform(sy, [-0.5, 0.5], [3.5, -3.5]);
  const tiltY = useTransform(sx, [-0.5, 0.5], [-4.5, 4.5]);

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
  };

  return (
    <div
      onPointerMove={onMove}
      // The column is a fixed 100svh rather than a floor of it. `min-h` let the stack
      // grow past the screen instead of dividing it, which is how a 667px phone ended
      // up 896px tall with BEGIN stranded 121px below the fold. A definite height gives
      // the illustration below something to shrink against. lg keeps the old auto
      // height — the row layout there sizes itself and never overflowed.
      className="relative flex h-[100svh] min-h-[100svh] w-full flex-col items-center justify-center gap-6 overflow-hidden px-6 py-10 lg:h-auto lg:flex-row lg:items-center lg:justify-center lg:gap-10 lg:px-16 lg:py-16"
    >
      {/* ---------------- HUD: corner brackets ---------------- */}
      <div aria-hidden className="pointer-events-none absolute inset-3 z-20 lg:inset-5">
        <span className="absolute left-0 top-0 h-7 w-7 border-l-2 border-t-2 border-ink/40 lg:h-10 lg:w-10" />
        <span className="absolute right-0 top-0 h-7 w-7 border-r-2 border-t-2 border-ink/40 lg:h-10 lg:w-10" />
        <span className="absolute bottom-0 left-0 h-7 w-7 border-b-2 border-l-2 border-ink/40 lg:h-10 lg:w-10" />
        <span className="absolute bottom-0 right-0 h-7 w-7 border-b-2 border-r-2 border-ink/40 lg:h-10 lg:w-10" />
      </div>

      {/* ---------------- HUD: index readout (top-left) ---------------- */}
      <div aria-hidden className="pointer-events-none absolute left-6 top-6 z-20 hidden items-center gap-2 lg:flex">
        <span className="num text-[0.7rem] text-ink">001</span>
        <span className="h-px w-8 bg-ink-dim/50" />
        <span className="eyebrow text-ink-dim/70" style={{ fontSize: "0.55rem" }}>Survive the Internet Economy</span>
      </div>

      <div className="absolute right-4 top-4 z-20">
        <MuteButton muted={muted} onToggle={onToggleMute} />
      </div>

      {/* ---------------- illustration (tilting plane, Phase R) ---------------- */}
      <motion.div
        initial={reduce ? false : { opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1, ease: EASE }}
        style={{ perspective: 1100 }}
        // The atlas is the one part of the composition that can afford to give ground,
        // so it is what absorbs a short screen: `flex-1 min-h-0` lets it take the room
        // the title block leaves rather than holding 520px and pushing BEGIN off the
        // bottom. The svg carries preserveAspectRatio="xMidYMid meet", so it fits itself
        // into whatever height it is handed — no crop, no distortion. max-h pins the
        // natural size (2× the width cap, the viewBox being 600×1200) so tall phones
        // render exactly as before. Under 480px of viewport the share left over is too
        // thin to read as a drawing, so it steps out and lets the title carry the screen
        // alone — that is landscape, where the stack used to overflow by 680px.
        className="relative z-10 flex max-h-[520px] min-h-0 w-full max-w-[260px] flex-1 justify-center [@media(max-height:480px)]:hidden sm:max-h-[640px] sm:max-w-[320px] lg:h-[90svh] lg:max-h-[900px] lg:w-auto lg:max-w-none lg:flex-none"
      >
        <motion.div
          style={reduce ? undefined : { rotateX: tiltX, rotateY: tiltY }}
          className="relative flex h-full w-full justify-center overflow-hidden"
        >
          {/* h-full, not h-auto: the drawing now takes its size from the height it is
              given instead of deriving one from its width. lg already worked this way. */}
          <DataAtlas px={sx} py={sy} className="h-full w-full lg:w-auto" />
          {/* slow accent scanline sweep over the panel */}
          {!reduce && (
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              initial={{ y: "-42%" }}
              animate={{ y: ["-42%", "42%", "-42%"] }}
              transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
            >
              <span className="absolute inset-x-0 top-1/2 h-px bg-ink/20" />
            </motion.div>
          )}
          {/* drifting ink motes — rise slowly through the composition */}
          {!reduce && (
            <div aria-hidden className="pointer-events-none absolute inset-0">
              {MOTES.map((m, i) => (
                <motion.span
                  key={i}
                  className="absolute bg-ink"
                  style={{ left: m.left, bottom: "-2%", width: m.size, height: m.size }}
                  initial={{ y: 0, opacity: 0 }}
                  animate={{ y: "-104vh", opacity: [0, 0.4, 0.32, 0] }}
                  transition={{ duration: m.dur, delay: m.delay, repeat: Infinity, ease: "linear" }}
                />
              ))}
            </div>
          )}
        </motion.div>
      </motion.div>

      {/* ---------------- title block ---------------- */}
      {/* shrink-0: the eyebrow, the wordmark, BEGIN and the caption are the screen's
          reason for existing, so they keep their height and the illustration yields. */}
      <div className="relative z-10 flex w-full max-w-xl shrink-0 flex-col items-center text-center lg:items-start lg:text-left">
        {/* The eyebrow used to animate `letterSpacing` 0.5em → 0.28em, reflowing the
            text run every frame. The tracking is static now and the settle rides
            `scaleX` instead: 0.22em of extra tracking across 25 glyphs widened the
            line ~1.27×, and the origin follows the flex alignment (centred on
            mobile, left-anchored at lg) so the line converges from the same edge. */}
        <motion.p
          initial={reduce ? false : { opacity: 0, y: 10, scaleX: 1.27 }}
          animate={{ opacity: 1, y: 0, scaleX: 1 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="eyebrow origin-center tracking-[0.28em] text-ink lg:origin-left"
        >
          A Financial Survival Story
        </motion.p>

        {/* The wordmark is nine mono glyphs carrying 0.04em of tracking, so it renders
            at exactly 5.76× the font size (9 × 0.6em advance + 9 × 0.04em). At 19vw that
            came to 427px inside a 390px phone: the container's overflow was cutting the
            L and the H in half. Sizing off the width actually available — the viewport
            less the px-6 gutter the eyebrow, button and caption all sit inside — keeps
            the line as wide as the screen allows without ever crossing that gutter.
            0.168 is 0.97 fill ÷ 5.76; the 3% is slack for a fallback mono whose advance
            runs wider than 0.6em. sm and up already fit, so their ramp is untouched. */}
        <motion.h1
          initial={reduce ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32, ...SPRING.soft }}
          className="display-caps mt-4 text-[calc((100vw_-_3rem)*0.168)] leading-[0.82] sm:text-[14vw] lg:text-[clamp(4.5rem,8vw,9rem)]"
        >
          <span className="text-ink">Life</span>
          <span className="text-ink">patch</span>
        </motion.h1>

        <motion.button
          type="button"
          onClick={onBegin}
          initial={reduce ? false : { opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.55, type: "spring", stiffness: 220, damping: 16 }}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          className="group mt-9 flex items-center gap-3 border-2 border-ink bg-ink/5 px-9 py-4 text-ink transition-colors hover:bg-ink hover:text-bg"
        >
          <motion.span
            animate={reduce ? undefined : { scale: [1, 1.18, 1] }}
            transition={{ duration: 1.6, repeat: Infinity }}
            className="grid place-items-center"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M7 4l13 8-13 8z" />
            </svg>
          </motion.span>
          <span className="display-caps text-xl tracking-[0.2em]">Begin</span>
        </motion.button>

        <motion.p
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9 }}
          className="voice mt-6 text-sm text-ink-dim"
        >
          Best with sound on. Headphones recommended.
        </motion.p>
      </div>

      {/* ---------------- film vocabulary: grain + vignette (§ Film Exception) ---------------- */}
      <FilmLayer grain={0.4} vignette={0.5} className="z-[15]" />

      {/* ---------------- HUD: footer status ticker ---------------- */}
      <div aria-hidden className="pointer-events-none absolute inset-x-6 bottom-5 z-20 hidden items-center justify-between lg:flex">
        <div className="flex items-center gap-3 text-ink-dim/55">
          <span className="eyebrow" style={{ fontSize: "0.55rem" }}>System · Active</span>
          <span className="flex items-end gap-0.5">
            {[5, 9, 4, 11, 7, 10, 6, 8].map((h, i) => (
              <span key={i} className="w-0.5 bg-ink-dim/40" style={{ height: `${h}px` }} />
            ))}
          </span>
          <span className="num text-[0.6rem]">V1.0</span>
        </div>
        <div className="flex items-center gap-2 text-ink-dim/55">
          <span className="eyebrow" style={{ fontSize: "0.55rem" }}>Rendering</span>
          {!reduce && (
            <span className="flex gap-1">
              {[0, 0.2, 0.4].map((d, i) => (
                <motion.span key={i} data-radius="round" className="h-1 w-1 bg-ink/70"
                  animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.4, repeat: Infinity, delay: d }} />
              ))}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
