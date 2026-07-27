"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AudioEngine, AccentKind, MarketMood, ScorePhase } from "@/src/audio/AudioEngine";
import type { AmbienceId, SfxName, StingTone } from "@/src/audio/sfxBank";

const MUTE_KEY = "lp_muted";
const VOL = 0.85;

export type AudioApi = {
  unlock: (phase?: ScorePhase) => void;
  setPhase: (phase: ScorePhase, fade?: number) => void;
  setIntensity: (level: number) => void;
  setMarketMood: (mood: MarketMood) => void;
  swellWarmth: () => void;
  setBrainGlow: (level: number) => void;
  accent: (kind: AccentKind) => void;
  sfx: (name: SfxName) => void;
  sting: (tone: StingTone) => void;
  ambience: (id: AmbienceId | null) => void;
  muted: boolean;
  setMuted: (v: boolean) => void;
  started: boolean;
};

const noop: AudioApi = {
  unlock: () => {}, setPhase: () => {}, setIntensity: () => {}, setMarketMood: () => {}, swellWarmth: () => {}, setBrainGlow: () => {},
  accent: () => {}, sfx: () => {}, sting: () => {}, ambience: () => {}, muted: false, setMuted: () => {}, started: false,
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

export function AudioProvider({ children }: { children: ReactNode }) {
  const engineRef = useRef<AudioEngine | null>(null);
  const desiredPhase = useRef<ScorePhase>("menu");
  const bootingRef = useRef(false);
  const [started, setStarted] = useState(false);
  const [muted, setMutedState] = useState(false);
  const mutedRef = useRef(false);

  // initial mute pref: stored value wins, else default muted under reduced-motion/data
  useEffect(() => {
    let initial = false;
    try {
      const stored = localStorage.getItem(MUTE_KEY);
      if (stored === "1") initial = true;
      else if (stored === "0") initial = false;
      else initial = prefersReduced();
    } catch {
      initial = prefersReduced();
    }
    mutedRef.current = initial;
    setMutedState(initial);
  }, []);

  const unlock = useCallback((phase?: ScorePhase) => {
    if (typeof window === "undefined") return;
    const p = phase ?? desiredPhase.current;
    desiredPhase.current = p;
    const eng = engineRef.current;
    if (eng) {
      if (eng.isStarted) eng.setPhase(p);
      else void eng.start(p).then(() => { setStarted(true); eng.setVolume(mutedRef.current ? 0 : VOL, 0.05); });
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
        e.setVolume(mutedRef.current ? 0 : VOL, 0.05);
      });
    });
  }, []);

  const setPhase = useCallback((phase: ScorePhase, fade?: number) => {
    desiredPhase.current = phase;
    engineRef.current?.setPhase(phase, fade);
  }, []);

  const setIntensity = useCallback((level: number) => engineRef.current?.setIntensity(level), []);
  const setMarketMood = useCallback((mood: MarketMood) => engineRef.current?.setMarketMood(mood), []);
  const swellWarmth = useCallback(() => engineRef.current?.swellWarmth(), []);
  const setBrainGlow = useCallback((level: number) => engineRef.current?.setBrainGlow(level), []);
  const accent = useCallback((kind: AccentKind) => engineRef.current?.accent(kind), []);
  const sfx = useCallback((name: SfxName) => engineRef.current?.playSfx(name), []);
  const sting = useCallback((tone: StingTone) => engineRef.current?.playSting(tone), []);
  const ambience = useCallback((id: AmbienceId | null) => engineRef.current?.setAmbience(id), []);

  const setMuted = useCallback((v: boolean) => {
    mutedRef.current = v;
    setMutedState(v);
    try { localStorage.setItem(MUTE_KEY, v ? "1" : "0"); } catch {}
    engineRef.current?.setVolume(v ? 0 : VOL);
  }, []);

  // Self-heal from any AudioContext drop (mobile interruptions, tab switches,
  // momentary render overload). The engine's own statechange/watchdog hooks try
  // to resume automatically; these gesture/visibility listeners cover browsers
  // that only allow resume() inside a user gesture. This is what un-sticks
  // "the music and audio stopped completely" mid-run.
  useEffect(() => {
    const heal = () => void engineRef.current?.ensureRunning();
    const onVisible = () => { if (!document.hidden) heal(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", heal);
    window.addEventListener("pointerdown", heal, { capture: true, passive: true });
    window.addEventListener("keydown", heal, { capture: true });
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", heal);
      window.removeEventListener("pointerdown", heal, { capture: true });
      window.removeEventListener("keydown", heal, { capture: true });
    };
  }, []);

  // teardown on full unmount (fades first inside dispose)
  useEffect(() => {
    return () => {
      void engineRef.current?.dispose();
    };
  }, []);

  const api: AudioApi = {
    unlock, setPhase, setIntensity, setMarketMood, swellWarmth, setBrainGlow, accent, sfx, sting, ambience, muted, setMuted, started,
  };

  return <AudioCtx.Provider value={api}>{children}</AudioCtx.Provider>;
}
