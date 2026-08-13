"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AudioEngine, AccentKind, ScorePhase } from "@/src/audio/AudioEngine";
import type { AmbienceId, SfxName, StingTone } from "@/src/audio/sfxBank";
import { SCORE_BPM } from "@/src/audio/tempo";

const MUTE_KEY = "lp_muted";
const VOLUME_KEY = "lp_volume";
/** Master gain when the mixer sits at its default — the house level. */
const VOL = 0.85;

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

/** Use the shared audio engine. Safe (no-op) if rendered outside a provider. */
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
  const [started, setStarted] = useState(false);
  const [muted, setMutedState] = useState(false);
  const mutedRef = useRef(false);
  // The mixer level, separate from mute: muting drops the master to 0 without
  // forgetting where the slider was, so unmuting restores the chosen level.
  const [volume, setVolumeState] = useState(VOL);
  const volumeRef = useRef(VOL);

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
      else void eng.start(p).then(() => { setStarted(true); eng.setVolume(masterLevel(), 0.05); });
      return;
    }
    // First user gesture: pull the audio engine (Tone.js) chunk on demand so it
    // never weighs down first paint, construct it, then start on the latest phase.
    if (bootingRef.current) return;
    bootingRef.current = true;
    void import("@/src/audio/AudioEngine").then(({ AudioEngine }) => {
      const e = new AudioEngine();
      engineRef.current = e;
      return e.start(desiredPhase.current).then(() => {
        setStarted(true);
        e.setVolume(masterLevel(), 0.05);
      });
    });
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

  const setVolume = useCallback((v: number) => {
    const next = clamp01(v);
    volumeRef.current = next;
    setVolumeState(next);
    try { localStorage.setItem(VOLUME_KEY, String(next)); } catch {}
    if (mutedRef.current) return; // stay silent; the level is remembered for unmute
    engineRef.current?.setVolume(next);
  }, []);

  const grid = useCallback((): ScoreGrid | null => {
    const anchorMs = engineRef.current?.transportAnchorMs() ?? null;
    return anchorMs === null ? null : { anchorMs, bpm: SCORE_BPM };
  }, []);

  // teardown on full unmount (fades first inside dispose)
  useEffect(() => {
    return () => {
      void engineRef.current?.dispose();
    };
  }, []);

  const api: AudioApi = {
    unlock, setPhase, setIntensity, swellWarmth, setBrainGlow, accent, sfx, sting, ambience,
    muted, setMuted, volume, setVolume, started, grid,
  };

  return <AudioCtx.Provider value={api}>{children}</AudioCtx.Provider>;
}
