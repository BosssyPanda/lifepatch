"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AudioEngine, type AccentKind, type ScorePhase } from "@/src/audio/AudioEngine";
import type { AmbienceId, SfxName, StingTone } from "@/src/audio/sfxBank";

const MUTE_KEY = "lp_muted";
const VOL = 0.85;

export type AudioApi = {
  unlock: (phase?: ScorePhase) => void;
  setPhase: (phase: ScorePhase, fade?: number) => void;
  setIntensity: (level: number) => void;
  swellWarmth: () => void;
  accent: (kind: AccentKind) => void;
  sfx: (name: SfxName) => void;
  sting: (tone: StingTone) => void;
  ambience: (id: AmbienceId | null) => void;
  muted: boolean;
  setMuted: (v: boolean) => void;
  started: boolean;
};

const noop: AudioApi = {
  unlock: () => {}, setPhase: () => {}, setIntensity: () => {}, swellWarmth: () => {},
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
  const [started, setStarted] = useState(false);
  const [muted, setMutedState] = useState(false);
  const mutedRef = useRef(false);

  // lazy singleton (client only)
  if (typeof window !== "undefined" && !engineRef.current) {
    engineRef.current = new AudioEngine();
  }

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
    const eng = engineRef.current;
    if (!eng) return;
    const p = phase ?? desiredPhase.current;
    desiredPhase.current = p;
    if (eng.isStarted) {
      eng.setPhase(p);
      return;
    }
    void eng.start(p).then(() => {
      setStarted(true);
      eng.setVolume(mutedRef.current ? 0 : VOL, 0.05);
    });
  }, []);

  const setPhase = useCallback((phase: ScorePhase, fade?: number) => {
    desiredPhase.current = phase;
    engineRef.current?.setPhase(phase, fade);
  }, []);

  const setIntensity = useCallback((level: number) => engineRef.current?.setIntensity(level), []);
  const swellWarmth = useCallback(() => engineRef.current?.swellWarmth(), []);
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

  // teardown on full unmount (fades first inside dispose)
  useEffect(() => {
    return () => {
      void engineRef.current?.dispose();
    };
  }, []);

  const api: AudioApi = {
    unlock, setPhase, setIntensity, swellWarmth, accent, sfx, sting, ambience, muted, setMuted, started,
  };

  return <AudioCtx.Provider value={api}>{children}</AudioCtx.Provider>;
}
