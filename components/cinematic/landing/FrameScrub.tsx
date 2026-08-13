"use client";

import { useMotionValueEvent, useScroll } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMotionCtx } from "@/src/motion/MotionProvider";

/**
 * Scroll-scrubbed image sequence — the Apple-style "the object turns as you scroll" set piece,
 * built the way it is actually done in production: a pre-rendered frame sequence painted to a
 * canvas, not a <video> seeked by scroll (browsers cannot seek a compressed stream smoothly
 * enough; on mobile Safari it stutters and sometimes refuses to seek at all while decoding).
 *
 * Cost discipline, because this is a landing-page luxury and not the game:
 *  • frames are fetched only once the section is near the viewport, never on first paint;
 *  • the poster carries the section until enough frames exist to scrub without holes;
 *  • Save-Data and reduced motion both collapse it to that single poster, and neither ever
 *    starts the sequence fetch.
 *
 * Painting is decoupled from React: scroll writes a target index to a ref and a single rAF
 * paints the newest one. A 90-frame scrub therefore causes zero re-renders.
 */

type Props = {
  /** How many frames exist, named `${prefix}${n}.webp` with `n` 1-based, zero-padded to 3. */
  count: number;
  /** e.g. "/film/globe/f_" */
  prefix: string;
  /** Shown before the sequence is ready, under reduced motion, and on Save-Data. */
  poster: string;
  /** Describes the whole sequence for anyone who never sees it animate. */
  alt: string;
  /** Intrinsic frame size, so the canvas is allocated once and never reflows. */
  width: number;
  height: number;
  className?: string;
};

const pad = (n: number) => String(n).padStart(3, "0");

export function FrameScrub({ count, prefix, poster, alt, width, height, className = "" }: Props) {
  const { reduced } = useMotionCtx();
  const sectionRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const frames = useRef<(HTMLImageElement | null)[]>([]);
  const wanted = useRef(0);
  const painted = useRef(-1);
  const raf = useRef(0);

  const [near, setNear] = useState(false);
  const [ready, setReady] = useState(false);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });

  // Arm the fetch before the section arrives, so the first scrubbed frame is already decoded.
  useEffect(() => {
    if (reduced) return;
    const el = sectionRef.current;
    if (!el) return;
    // Respect an explicit data-saving preference the same way the film beats do.
    const conn = (navigator as { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;

    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "700px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  // Load every frame. Decoding up front is the point: decoding *during* a scrub is what makes
  // these sequences stutter. The first frame flips `ready` so the poster can hand over early.
  useEffect(() => {
    if (!near || reduced) return;
    let alive = true;
    frames.current = new Array(count).fill(null);
    let loaded = 0;

    const load = (i: number) =>
      new Promise<void>((resolve) => {
        const img = new Image();
        img.decoding = "async";
        img.src = `${prefix}${pad(i + 1)}.webp`;
        const done = () => {
          if (!alive) return resolve();
          frames.current[i] = img;
          loaded += 1;
          if (i === 0) setReady(true);
          resolve();
        };
        img.decode().then(done, () => {
          // decode() rejects on some browsers for images that still paint fine.
          img.onload = done;
          img.onerror = () => resolve();
        });
      });

    // Fetch in order but a few at a time: the early frames are the ones needed first, and an
    // unthrottled burst of ~90 requests starves everything else on the page.
    (async () => {
      const LANES = 6;
      let next = 0;
      await Promise.all(
        Array.from({ length: LANES }, async () => {
          while (alive && next < count) {
            const i = next;
            next += 1;
            await load(i);
          }
        }),
      );
      if (alive && loaded > 0) setReady(true);
    })();

    return () => {
      alive = false;
    };
  }, [near, reduced, count, prefix]);

  const paint = useCallback(() => {
    raf.current = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const idx = wanted.current;
    if (idx === painted.current) return;

    // Fall back to the nearest earlier frame that has arrived, so a partly-loaded sequence
    // scrubs coarsely instead of flashing empty.
    let img = frames.current[idx];
    if (!img) {
      for (let i = idx; i >= 0; i--) {
        if (frames.current[i]) {
          img = frames.current[i];
          break;
        }
      }
    }
    if (!img) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    painted.current = idx;
  }, []);

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    if (reduced) return;
    const idx = Math.max(0, Math.min(count - 1, Math.round(p * (count - 1))));
    wanted.current = idx;
    if (!raf.current) raf.current = requestAnimationFrame(paint);
  });

  useEffect(() => {
    if (ready && !raf.current) raf.current = requestAnimationFrame(paint);
  }, [ready, paint]);

  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    },
    [],
  );

  // Reduced motion / Save-Data: one still frame and the description, no sequence, no scroll
  // height to travel — the section becomes a plain illustrated plate.
  if (reduced) {
    return (
      <div className={`relative border border-hairline ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={poster} alt={alt} width={width} height={height} className="w-full" loading="lazy" decoding="async" />
      </div>
    );
  }

  return (
    <div ref={sectionRef} className={`relative h-[260svh] ${className}`}>
      <div className="sticky top-0 flex h-[100svh] items-center justify-center overflow-hidden">
        <div className="relative w-full border border-hairline bg-bg">
          <canvas
            ref={canvasRef}
            width={width}
            height={height}
            aria-label={alt}
            role="img"
            className="block w-full"
            style={{ opacity: ready ? 1 : 0, transition: "opacity 220ms ease-out" }}
          />
          {/* The poster holds the frame until the first real frame has decoded, so the stage is
              never an empty box — and it keeps the layout at the exact final size. */}
          {!ready && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={poster}
              alt={alt}
              width={width}
              height={height}
              className="absolute inset-0 h-full w-full"
              decoding="async"
            />
          )}
          <div aria-hidden className="pointer-events-none absolute inset-3 border border-hairline" />
        </div>
      </div>
    </div>
  );
}
