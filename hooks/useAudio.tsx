"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AudioEngine, AccentKind, ScorePhase } from "@/src/audio/AudioEngine";
import type { AmbienceId, SfxName, StingTone } from "@/src/audio/sfxBank";
import { SCORE_BPM } from "@/src/audio/tempo";

const MUTE_KEY = "lp_muted";
const VOLUME_KEY = "lp_volume";
/** Master gain when the mixer sits at its default — the house level. */
const VOL = 0.85;
/**
 * Trailing debounce on the volume WRITE. A fader drag fires ~100 input events and
 * `localStorage.setItem` is synchronous and blocking; the in-memory level and the
 * engine ramp stay immediate so the audio tracks the fader with no lag.
 */
const VOLUME_PERSIST_MS = 300;

/** The score's musical grid, expressed on the `performance.now()` clock. */
export type ScoreGrid = { anchorMs: number; bpm: number };

export type AudioApi = {
  unlock: (phase?: ScorePhase) => void;
  setPhase: (phase: ScorePhase, fade?: number) => void;
  setIntensity: (level: number) => void;
  swellWarmth: () => void;
  setBrainGlow: (level: number) => void;
  accent: (kind: AccentKind) => void;
  /** `transpose` (semitones) brightens the tick foley — see AudioEngine.playSfx. */
  sfx: (name: SfxName, transpose?: number) => void;
  sting: (tone: StingTone) => void;
  ambience: (id: AmbienceId | null) => void;
  muted: boolean;
  setMuted: (v: boolean) => void;
  /** 0..1 master level, persisted under `lp_volume`. Independent of mute. */
  volume: number;
  setVolume: (v: number) => void;
  started: boolean;
  /**
   * The running score's beat grid, or null when the Transport isn't going.
   * `useBeatClock` reads this once per ceremony; when it is null the ceremony
   * anchors its own grid at the same tempo, so muted / silent players get
   * identical pacing.
   */
  grid: () => ScoreGrid | null;
};

const noop: AudioApi = {
  unlock: () => {}, setPhase: () => {}, setIntensity: () => {}, swellWarmth: () => {}, setBrainGlow: () => {},
  accent: () => {}, sfx: () => {}, sting: () => {}, ambience: () => {}, muted: false, setMuted: () => {},
  volume: VOL, setVolume: () => {}, started: false, grid: () => null,
};

const AudioCtx = createContext<AudioApi | null>(null);

/**
 * Use the shared audio engine. Safe (no-op) if rendered outside a provider.
 *
 * Every method on the returned object is referentially stable for the life of
 * the provider; only `muted` / `volume` / `started` change. An effect that just
 * needs to make a sound should therefore destructure the method it wants
 * (`const { ambience } = useAudio()`) rather than depending on the whole object,
 * or a volume-slider drag will re-run it on every input event.
 */
export function useAudio(): AudioApi {
  return useContext(AudioCtx) ?? noop;
}

function prefersReduced(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      window.matchMedia("(prefers-reduced-data: reduce)").matches;
  } catch {
    return false;
  }
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : VOL);

export function AudioProvider({ children }: { children: ReactNode }) {
  const engineRef = useRef<AudioEngine | null>(null);
  const desiredPhase = useRef<ScorePhase>("menu");
  const bootingRef = useRef(false);
  // False between this provider's unmount and (under StrictMode / Fast Refresh)
  // its remount, so an in-flight boot can't attach an engine to a dead tree.
  const mountedRef = useRef(true);
  const [started, setStarted] = useState(false);
  const [muted, setMutedState] = useState(false);
  const mutedRef = useRef(false);
  // The mixer level, separate from mute: muting drops the master to 0 without
  // forgetting where the slider was, so unmuting restores the chosen level.
  const [volume, setVolumeState] = useState(VOL);
  const volumeRef = useRef(VOL);
  const volumeSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volumePendingRef = useRef<number | null>(null);

  /** The level the master should currently ramp to. */
  const masterLevel = useCallback(() => (mutedRef.current ? 0 : volumeRef.current), []);

  // initial prefs: stored values win, else default muted under reduced-motion/data
  useEffect(() => {
    let initialMuted = false;
    try {
      const stored = localStorage.getItem(MUTE_KEY);
      if (stored === "1") initialMuted = true;
      else if (stored === "0") initialMuted = false;
      else initialMuted = prefersReduced();
    } catch {
      initialMuted = prefersReduced();
    }
    mutedRef.current = initialMuted;
    setMutedState(initialMuted);

    let initialVol = VOL;
    try {
      const stored = localStorage.getItem(VOLUME_KEY);
      if (stored !== null) initialVol = clamp01(Number(stored));
    } catch {}
    volumeRef.current = initialVol;
    setVolumeState(initialVol);
  }, []);

  const unlock = useCallback((phase?: ScorePhase) => {
    if (typeof window === "undefined") return;
    const p = phase ?? desiredPhase.current;
    desiredPhase.current = p;
    const eng = engineRef.current;
    if (eng) {
      if (eng.isStarted) eng.setPhase(p);
      else {
        void eng.start(p)
          .then(() => { setStarted(true); eng.setVolume(masterLevel(), 0.05); })
          // A blocked AudioContext rejects here; swallow it so the next gesture retries.
          .catch(() => {});
      }
      return;
    }
    // First user gesture: pull the audio engine (Tone.js) chunk on demand so it
    // never weighs down first paint, construct it, then start on the latest phase.
    if (bootingRef.current) return;
    bootingRef.current = true;
    void import("@/src/audio/AudioEngine")
      .then(({ AudioEngine }) => {
        if (!mountedRef.current) return;
        const e = new AudioEngine();
        engineRef.current = e;
        return e.start(desiredPhase.current).then(() => {
          // Unmounted (or superseded) while Tone was starting: don't leave a live
          // graph behind and don't setState into a dead tree.
          if (!mountedRef.current || engineRef.current !== e) { void e.dispose(); return; }
          setStarted(true);
          e.setVolume(masterLevel(), 0.05);
        });
      })
      // A rejected `Tone.start()` (blocked AudioContext) or a failed chunk fetch
      // must NOT wedge audio for the rest of the session: drop the half-built
      // engine so a later gesture boots a fresh one. `finally` clears the boot
      // latch either way — leaving it stuck true was the bug.
      .catch(() => {
        if (engineRef.current && !engineRef.current.isStarted) engineRef.current = null;
      })
      .finally(() => { bootingRef.current = false; });
  }, [masterLevel]);

  const setPhase = useCallback((phase: ScorePhase, fade?: number) => {
    desiredPhase.current = phase;
    engineRef.current?.setPhase(phase, fade);
  }, []);

  const setIntensity = useCallback((level: number) => engineRef.current?.setIntensity(level), []);
  const swellWarmth = useCallback(() => engineRef.current?.swellWarmth(), []);
  const setBrainGlow = useCallback((level: number) => engineRef.current?.setBrainGlow(level), []);
  const accent = useCallback((kind: AccentKind) => engineRef.current?.accent(kind), []);
  const sfx = useCallback((name: SfxName, transpose?: number) => engineRef.current?.playSfx(name, transpose), []);
  const sting = useCallback((tone: StingTone) => engineRef.current?.playSting(tone), []);
  const ambience = useCallback((id: AmbienceId | null) => engineRef.current?.setAmbience(id), []);

  const setMuted = useCallback((v: boolean) => {
    mutedRef.current = v;
    setMutedState(v);
    try { localStorage.setItem(MUTE_KEY, v ? "1" : "0"); } catch {}
    // engine.setVolume always RAMPS — never an abrupt cut (see AudioEngine).
    engineRef.current?.setVolume(masterLevel());
  }, [masterLevel]);

  /** Write the last requested level now and cancel any pending write. */
  const flushVolume = useCallback(() => {
    if (volumeSaveRef.current !== null) {
      clearTimeout(volumeSaveRef.current);
      volumeSaveRef.current = null;
    }
    const v = volumePendingRef.current;
    if (v === null) return;
    volumePendingRef.current = null;
    try { localStorage.setItem(VOLUME_KEY, String(v)); } catch {}
  }, []);

  const setVolume = useCallback((v: number) => {
    const next = clamp01(v);
    volumeRef.current = next;
    setVolumeState(next);
    // Persistence is debounced; the level and the engine ramp below are not, so
    // the mix tracks the fader instantly while the disk write happens once.
    volumePendingRef.current = next;
    if (volumeSaveRef.current !== null) clearTimeout(volumeSaveRef.current);
    volumeSaveRef.current = setTimeout(() => { volumeSaveRef.current = null; flushVolume(); }, VOLUME_PERSIST_MS);
    if (mutedRef.current) return; // stay silent; the level is remembered for unmute
    engineRef.current?.setVolume(next);
  }, [flushVolume]);

  const grid = useCallback((): ScoreGrid | null => {
    const anchorMs = engineRef.current?.transportAnchorMs() ?? null;
    return anchorMs === null ? null : { anchorMs, bpm: SCORE_BPM };
  }, []);

  // teardown on full unmount (fades first inside dispose)
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Hand the engine off to dispose() and drop the ref in the same breath:
      // dispose clears `started` immediately but takes ~450ms to tear the graph
      // down, so a remount inside that window (StrictMode, Fast Refresh) must
      // not be able to call start() on the instance being destroyed.
      const eng = engineRef.current;
      engineRef.current = null;
      bootingRef.current = false;
      flushVolume();
      void eng?.dispose();
    };
  }, [flushVolume]);

  /**
   * One-time global first-gesture unlock.
   *
   * `unlock()` used to be reachable only from the Gate's begin handler (plus a
   * couple of Rat Race entry points), but a returning visitor is promoted
   * straight past the Gate (`sessionStorage.lp_introSeen`), so the whole second
   * visit of a session played silent. Browsers require a gesture before an
   * AudioContext may start; this listens for the first one anywhere in the app,
   * whatever it was, then takes itself off.
   *
   * Capture phase so it lands before the app's own handlers, which means an
   * explicit `unlock("intro")` fired by the same gesture still wins: it updates
   * `desiredPhase` before the pending boot reads it.
   *
   * Mute is respected, not overridden — unlocking starts the engine with the
   * master at `masterLevel()`, which is 0 for a muted player. That is deliberate:
   * the Transport has to run so `useBeatClock` gives muted players identical
   * pacing (see AudioEngine's header).
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const EVENTS = ["pointerdown", "keydown", "touchstart"] as const;
    let armed = true;
    const onGesture = () => {
      if (!armed) return;
      armed = false;
      EVENTS.forEach((e) => window.removeEventListener(e, onGesture, true));
      unlock();
    };
    EVENTS.forEach((e) => window.addEventListener(e, onGesture, true));
    return () => { armed = false; EVENTS.forEach((e) => window.removeEventListener(e, onGesture, true)); };
  }, [unlock]);

  // A tab closed mid-drag would otherwise lose the debounced level.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("pagehide", flushVolume);
    return () => window.removeEventListener("pagehide", flushVolume);
  }, [flushVolume]);

  // Every method above is a `useCallback` with stable deps, so this identity only
  // changes when one of the three scalars does. Before it was memoized, a single
  // volume-slider step handed every consumer a new `audio` object and re-fired
  // every effect that depends on it — which tore down and rebuilt the ambience bed.
  const api = useMemo<AudioApi>(() => ({
    unlock, setPhase, setIntensity, swellWarmth, setBrainGlow, accent, sfx, sting, ambience,
    muted, setMuted, volume, setVolume, started, grid,
  }), [
    unlock, setPhase, setIntensity, swellWarmth, setBrainGlow, accent, sfx, sting, ambience,
    muted, setMuted, volume, setVolume, started, grid,
  ]);

  return <AudioCtx.Provider value={api}>{children}</AudioCtx.Provider>;
}
