"use client";

import { animate, useMotionValue, useMotionValueEvent } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAudio } from "@/hooks/useAudio";
import { ACCENT_PREROLL_MS, useBeatClock } from "@/hooks/useBeatClock";
import { currency } from "@/lib/format";
import type { Outcome } from "@/lib/lifeEvents";
import { buzz, BUZZ } from "@/src/motion/haptics";
import type { juiceTier } from "@/src/motion/juice";
import { EASE, HITSTOP } from "@/src/motion/tokens";
import { useSkippable } from "@/src/motion/useSkippable";

/**
 * The consequence beat's clock: the phase ladder, the count-up, the landing and every
 * cue hung off them. It is the whole reason the ceremony is a ceremony, so it lives in
 * its own file — the component that renders it is then just the frame.
 *
 * ── beat-lock (see hooks/useBeatClock) ───────────────────────────────────────
 * The ladder below used to be raw milliseconds (140 / 470 / 1010 + an 1100ms
 * count) while the score runs at 76 BPM and quantizes its accents to the
 * transport's 8ths — so the picture and the music agreed by luck. Each boundary
 * now SNAPS to the nearest beat (or 8th) of that same grid: same shape, same
 * feel, but the landing is a downbeat and the `consequence` accent detonates on
 * it. The count-up's duration falls out of the snap as a whole number of beats.
 * A silent or muted player gets the identical ladder on a locally-anchored grid.
 *
 * ── impact (see src/motion/juice) ────────────────────────────────────────────
 * How hard the landing hits is one decision — `juiceTier(|Δ| as % of net worth)`
 * — feeding the shake amplitude, the bill/ash count, the stamp's entry scale and
 * the tick's brightness together, plus a HITSTOP freeze between the impact and
 * its follow-through.
 */

export type Phase = "stamp" | "hold" | "count" | "land" | "rows" | "done";

/** The pre-quantization ladder, in ms from mount — the shape being preserved. */
const LADDER = {
  full: { riser: 140, hold: 470, count: 1010, land: 2110 },
  minor: { count: 300, land: 1000 },
} as const;

/** Post-landing beats (from the land instant), kept on the existing ms feel. */
const ROWS_MS = 420;
const JOLT_MS = 360;
const FLASH_MS = 900;
const MINOR_FLASH_MS = 700;
const ROW_PRINT_MS = 140;
const ROWS_TAIL_MS = 260;

export function useConsequenceLadder({
  reduced,
  tier,
  primary,
  isGain,
  isLoss,
  tone,
  juice,
  rowCount,
  onDone,
}: {
  reduced: boolean;
  tier: "full" | "minor";
  primary: number;
  isGain: boolean;
  isLoss: boolean;
  tone: Outcome["tone"];
  juice: ReturnType<typeof juiceTier>;
  /** Drives how long the printed rows hold before the ceremony calls itself done. */
  rowCount: number;
  onDone: () => void;
}) {
  const audio = useAudio();
  const clock = useBeatClock();

  const [phase, setPhase] = useState<Phase>(reduced ? "done" : "stamp");
  // `count` is the SETTLED figure only — the tween itself never touches React state
  // (see the count-up effect below), so the ceremony doesn't re-render 60×/s while
  // it is simultaneously running a shake and staggered rows.
  const [count, setCount] = useState(reduced ? Math.abs(primary) : 0);
  const [jolt, setJolt] = useState(false);
  const [flash, setFlash] = useState(false);
  /** The one-shot bill/ash shower, armed by the landing's follow-through. */
  const [fall, setFall] = useState(false);
  const timers = useRef<number[]>([]);
  /** Count-up length in seconds — a whole number of beats, set when the ladder is laid. */
  const countSeconds = useRef((tier === "full" ? 1100 : 700) / 1000);
  const done = phase === "done";

  const figureRef = useRef<HTMLSpanElement>(null);
  const countMV = useMotionValue(reduced ? Math.abs(primary) : 0);
  const countAnim = useRef<{ stop: () => void } | null>(null);
  const signPrefix = isLoss ? "−" : isGain ? "+" : "";
  const fmtFigure = useCallback(
    (n: number) => `${signPrefix}${currency(Math.round(n))}`,
    [signPrefix],
  );
  // the tween writes straight to the DOM node; React never sees the interim values
  useMotionValueEvent(countMV, "change", (v) => {
    const el = figureRef.current;
    if (el) el.textContent = fmtFigure(v);
  });

  const at = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    countAnim.current?.stop();
    countAnim.current = null;
  }, []);

  // opening sequence: stamp → (hold) → count, quantized onto the score's grid.
  useEffect(() => {
    if (reduced) {
      audio.sting(isLoss ? "bad" : isGain ? "good" : "neutral");
      return;
    }
    // The stamp is the ceremony's own downbeat: it fires the instant the overlay
    // mounts and, when nothing is playing, the beat grid anchors right here. It
    // is deliberately NOT delayed onto the transport's next 8th — up to 395ms of
    // dead screen before the first frame reads as lag, not as rhythm.
    audio.sfx("stamp");

    // Accents are quantized by the engine to the next 8th, so a request has to
    // arrive slightly BEFORE the boundary it should sound on.
    const accentAt = (ms: number) => Math.max(0, ms - ACCENT_PREROLL_MS);

    if (tier === "full") {
      const L = LADDER.full;
      const riserAt = clock.snap(L.riser, "8n");
      const holdAt = clock.snap(L.hold, "8n", riserAt + 1);
      const countAt = clock.snap(L.count, "beat", holdAt + 1);
      // the landing is the ceremony's payoff — it gets the downbeat
      const landAt = clock.snap(L.land, "beat", countAt + 1);
      countSeconds.current = (landAt - countAt) / 1000;

      at(accentAt(riserAt), () => audio.accent("riser"));
      at(holdAt, () => setPhase("hold"));
      at(countAt, () => setPhase("count"));
      // pre-rolled so the stamp accents detonate ON the landing beat, not after it
      at(accentAt(landAt), () => {
        if (isGain) audio.accent("stampGood");
        else if (isLoss) audio.accent("stampBad");
        audio.accent("consequence");
      });
    } else {
      // A minor beat is trimmed and quick; locking it to whole beats would
      // stretch it by up to 40%, so it rides the 8th grid instead.
      const L = LADDER.minor;
      const countAt = clock.snap(L.count, "8n");
      const landAt = clock.snap(L.land, "8n", countAt + 1);
      countSeconds.current = (landAt - countAt) / 1000;

      at(countAt, () => setPhase("count"));
      at(accentAt(landAt), () => {
        if (isGain) audio.accent("stampGood");
        else if (isLoss) audio.accent("stampBad");
      });
    }
    return clearTimers;
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // count-up; hands off to "land" when the figure lands. Driven by a MotionValue
  // (one DOM textContent write per frame) instead of setState-per-rAF-frame.
  // Its duration is the gap between two grid boundaries, so the figure settles
  // exactly as the landing beat arrives.
  useEffect(() => {
    if (phase !== "count") return;
    const to = Math.abs(primary);
    audio.sfx("uitick", juice.pitch); // brighter tick the bigger the swing
    countMV.jump(0);
    const controls = animate(countMV, to, {
      duration: Math.max(0.2, countSeconds.current),
      ease: EASE,
      onComplete: () => {
        setCount(to);
        setPhase("land");
      },
    });
    countAnim.current = controls;
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Landing. The impact instant is bare: foley + haptic + the DEBIT/CREDIT stamp,
  // and then everything holds still for HITSTOP before the follow-through (shake,
  // rail flash, bill/ash fall) starts. Those few frames of stillness are what make
  // the hit read as a hit rather than as a wobble — the accents already fired,
  // quantized onto this exact beat by the pre-roll above.
  useEffect(() => {
    if (phase !== "land") return;
    if (isGain) {
      audio.sfx("cash");
      audio.sting("good");
    } else if (isLoss) {
      audio.sting(tone === "bad" ? "bad" : "warning");
    } else {
      audio.sting("neutral");
    }
    const freeze = HITSTOP * 1000;
    if (tier === "full") {
      buzz(BUZZ.land, audio.muted); // §13 #11 — impact haptic with the stamp
      at(freeze, () => {
        setJolt(true);
        setFlash(true);
        setFall(true);
      });
      at(freeze + JOLT_MS, () => setJolt(false));
      at(freeze + FLASH_MS, () => setFlash(false));
    } else {
      at(freeze, () => setFlash(true));
      at(freeze + MINOR_FLASH_MS, () => setFlash(false));
    }
    const rowsAt = clock.snap(freeze + ROWS_MS, "8n", freeze + 1);
    at(rowsAt, () => setPhase("rows"));
    at(rowsAt + rowCount * ROW_PRINT_MS + ROWS_TAIL_MS, () => setPhase("done"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const skip = useCallback(() => {
    if (done) {
      onDone();
      return;
    }
    clearTimers();
    countMV.jump(Math.abs(primary));
    setCount(Math.abs(primary));
    setJolt(false);
    setFlash(false);
    setPhase("done");
  }, [done, onDone, clearTimers, primary, countMV]);

  // Global input-skip: while the ceremony is still animating (!done), any pointer/key
  // anywhere jumps it to the final state. It unregisters at `done`, so ambient input
  // skips the animation but never advances — the Continue control below owns that.
  useSkippable(!done, skip);

  return {
    phase,
    done,
    jolt,
    flash,
    fall,
    figureRef,
    figureText: fmtFigure(count),
    skip,
  };
}
