"use client";

import { useCallback, useMemo, useRef } from "react";
import { BeatClock } from "@/src/audio/BeatClock";
import {
  ACCENT_PREROLL_MS,
  MS_PER_BAR,
  MS_PER_BEAT,
  SCORE_BPM,
  SCORE_TIME_SIGNATURE,
} from "@/src/audio/tempo";
import { useAudio } from "./useAudio";

/**
 * The visual beat clock — the missing half of the score's timing.
 *
 * `AudioEngine.accent()` already quantizes every cinematic hit to the transport's
 * next 8th, but every visual timeline in the app is a hand-written setTimeout
 * ladder in milliseconds. At 76 BPM (beat = 789ms, bar = 3.158s) the two only
 * agree by accident. This hook hands a ceremony the same grid the music is on,
 * built on the (previously unused) `BeatClock` math.
 *
 * ── the silent grid ──────────────────────────────────────────────────────────
 * The pacing must not depend on whether anything is audible. Two cases:
 *
 *   • The Transport is running (audio unlocked — INCLUDING when muted, since mute
 *     only ramps the master gain to 0): the clock borrows the transport's own
 *     grid via `audio.grid()`, so a visual boundary and the accent quantized to
 *     the same boundary land on one instant.
 *   • The Transport is not running (never unlocked): the clock anchors an
 *     identical 789ms grid at `performance.now()` the first time the ceremony
 *     asks for a time — i.e. at the moment the ceremony starts.
 *
 * Same tempo, same unit lengths, same number of beats per phase either way. Only
 * the grid's PHASE differs, and phase is exactly the thing a silent player cannot
 * perceive. A muted run is never slower, faster, or looser than an unmuted one.
 *
 * The source is captured ONCE per hook instance: a ceremony that starts silent
 * and gets its audio unlocked mid-flight keeps the grid it began on rather than
 * jumping phase under the user.
 */

/** Grid resolutions, in beats. */
const UNIT_BEATS = { bar: 4, beat: 1, "8n": 0.5, "16n": 0.25 } as const;

export type BeatGrid = keyof typeof UNIT_BEATS;

export type BeatClockApi = {
  bpm: number;
  msPerBeat: number;
  msPerBar: number;
  /** Length of one `grid` unit, in ms. */
  unitMs: (grid?: BeatGrid) => number;
  /** ms until the next beat boundary (always > 0). */
  nextBeat: () => number;
  /** ms until the next bar boundary (always > 0). */
  nextBar: () => number;
  /** ms until the next boundary of any resolution (always > 0). */
  next: (grid?: BeatGrid) => number;
  /** ms until the `n`-th grid boundary from now (n = 1 → the next one). */
  after: (n: number, grid?: BeatGrid) => number;
  /**
   * Snap an existing ms offset to the NEAREST grid boundary — the way to
   * quantize a hand-built ladder without restretching it. `minMs` keeps a
   * ladder strictly ordered: a boundary that would land at or before the
   * previous one is pushed a whole unit later instead of collapsing onto it.
   */
  snap: (ms: number, grid?: BeatGrid, minMs?: number) => number;
  /** Run `cb` on the grid. Returns a canceller; call it on skip/unmount. */
  schedule: (
    cb: () => void,
    at: { beats?: number; bars?: number; ms?: number; grid?: BeatGrid },
  ) => () => void;
};

const nowMs = () => (typeof performance === "undefined" ? Date.now() : performance.now());

export function useBeatClock(): BeatClockApi {
  const audio = useAudio();
  const gridSource = audio.grid;
  const clockRef = useRef<BeatClock | null>(null);

  // Lazily built on first use, so the anchor is "when the ceremony started"
  // rather than "when React happened to render" — and so nothing reads
  // performance.now() during an SSR pass.
  const clock = useCallback((): BeatClock => {
    if (!clockRef.current) {
      const src = gridSource();
      clockRef.current = new BeatClock(
        src?.bpm ?? SCORE_BPM,
        SCORE_TIME_SIGNATURE,
        (src?.anchorMs ?? nowMs()) / 1000,
      );
    }
    return clockRef.current;
  }, [gridSource]);

  return useMemo<BeatClockApi>(() => {
    const unitSec = (grid: BeatGrid) => clock().secondsPerBeat * UNIT_BEATS[grid];
    const unitMs = (grid: BeatGrid = "beat") => unitSec(grid) * 1000;

    const next = (grid: BeatGrid = "beat") => {
      const c = clock();
      const u = unitSec(grid);
      const n = nowMs() / 1000;
      // strictly the NEXT boundary: sitting exactly on one buys the following one
      const k = Math.floor((n - c.startTime) / u + 1e-9) + 1;
      return (c.startTime + k * u - n) * 1000;
    };

    const after = (n: number, grid: BeatGrid = "beat") =>
      n <= 0 ? 0 : next(grid) + (n - 1) * unitMs(grid);

    const snap = (ms: number, grid: BeatGrid = "beat", minMs = 0) => {
      const c = clock();
      const u = unitSec(grid);
      const n = nowMs() / 1000;
      const k = Math.round((n + ms / 1000 - c.startTime) / u);
      let delay = (c.startTime + k * u - n) * 1000;
      const step = u * 1000;
      while (delay < minMs) delay += step;
      return delay;
    };

    const schedule: BeatClockApi["schedule"] = (cb, at) => {
      const grid = at.grid ?? (at.bars !== undefined ? "bar" : "beat");
      const delay =
        at.ms !== undefined
          ? snap(at.ms, grid)
          : at.bars !== undefined
            ? after(at.bars, "bar")
            : after(at.beats ?? 1, grid);
      const id = window.setTimeout(cb, Math.max(0, delay));
      return () => window.clearTimeout(id);
    };

    return {
      bpm: SCORE_BPM,
      msPerBeat: MS_PER_BEAT,
      msPerBar: MS_PER_BAR,
      unitMs,
      next,
      nextBeat: () => next("beat"),
      nextBar: () => next("bar"),
      after,
      snap,
      schedule,
    };
  }, [clock]);
}

export { ACCENT_PREROLL_MS };
