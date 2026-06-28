"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type BedKind = "intro" | "outroGood" | "outroBad";
export type SoundName =
  | "thump" | "hit" | "stab" | "riser" | "title"
  | "tick" | "ping" | "thud" | "rise" | "stampGood" | "stampBad";

const VOL = 0.22;
const MUTE_KEY = "lp_muted";

/**
 * Procedural cinematic score via Web Audio. Every call is wrapped so audio
 * failure can never break the game. Created lazily on a user gesture (unlock).
 */
export function useScore() {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const bedRef = useRef<AudioNode[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [muted, setMutedState] = useState(false);

  useEffect(() => {
    try {
      setMutedState(localStorage.getItem(MUTE_KEY) === "1");
    } catch {}
  }, []);

  const ensure = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    try {
      if (!ctxRef.current) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return null;
        const ctx = new AC();
        const master = ctx.createGain();
        master.gain.value = muted ? 0 : VOL;
        master.connect(ctx.destination);
        ctxRef.current = ctx;
        masterRef.current = master;
      }
      return ctxRef.current;
    } catch {
      return null;
    }
  }, [muted]);

  const unlock = useCallback(() => {
    const ctx = ensure();
    try {
      ctx?.resume();
    } catch {}
  }, [ensure]);

  const setMuted = useCallback((v: boolean) => {
    setMutedState(v);
    try {
      localStorage.setItem(MUTE_KEY, v ? "1" : "0");
    } catch {}
    const m = masterRef.current;
    const ctx = ctxRef.current;
    if (m && ctx) {
      try {
        m.gain.cancelScheduledValues(ctx.currentTime);
        m.gain.linearRampToValueAtTime(v ? 0 : VOL, ctx.currentTime + 0.08);
      } catch {}
    }
  }, []);

  // ---- primitives ----
  const env = (g: GainNode, t: number, peak: number, attack: number, dur: number) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
  };

  const tone = useCallback((freq: number, type: OscillatorType, t: number, peak: number, attack: number, dur: number, glideTo?: number) => {
    const ctx = ctxRef.current, master = masterRef.current;
    if (!ctx || !master) return;
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t + attack + dur);
      env(g, t, peak, attack, dur);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + attack + dur + 0.05);
    } catch {}
  }, []);

  const noise = useCallback((t: number, peak: number, dur: number, hp = 300, lp = 6000) => {
    const ctx = ctxRef.current, master = masterRef.current;
    if (!ctx || !master) return;
    try {
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const hpf = ctx.createBiquadFilter(); hpf.type = "highpass"; hpf.frequency.value = hp;
      const lpf = ctx.createBiquadFilter(); lpf.type = "lowpass"; lpf.frequency.value = lp;
      const g = ctx.createGain();
      env(g, t, peak, 0.004, dur);
      src.connect(hpf).connect(lpf).connect(g).connect(master);
      src.start(t);
      src.stop(t + dur + 0.05);
    } catch {}
  }, []);

  const chord = useCallback((freqs: number[], type: OscillatorType, t: number, peak: number, attack: number, dur: number) => {
    freqs.forEach((f, i) => tone(f, type, t, peak / (1 + i * 0.4), attack, dur));
  }, [tone]);

  // ---- named sounds ----
  const play = useCallback((name: SoundName) => {
    const ctx = ensure();
    if (!ctx) return;
    const t = ctx.currentTime + 0.001;
    switch (name) {
      case "thump": tone(90, "sine", t, 0.7, 0.006, 0.5, 45); noise(t, 0.18, 0.12, 80, 1200); break;
      case "hit": tone(70, "sine", t, 0.9, 0.005, 0.7, 38); noise(t, 0.3, 0.2, 60, 1600); break;
      case "stab": chord([220, 233], "sawtooth", t, 0.5, 0.005, 0.32); tone(55, "sine", t, 0.7, 0.005, 0.5, 40); break;
      case "riser": {
        // upward noise sweep tension
        const ctx2 = ctxRef.current!, master = masterRef.current!;
        try {
          const len = Math.floor(ctx2.sampleRate * 1.4);
          const buf = ctx2.createBuffer(1, len, ctx2.sampleRate);
          const d = buf.getChannelData(0);
          for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
          const src = ctx2.createBufferSource(); src.buffer = buf;
          const bp = ctx2.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 6;
          bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(3500, t + 1.4);
          const g = ctx2.createGain(); g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.16, t + 1.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
          src.connect(bp).connect(g).connect(master); src.start(t); src.stop(t + 1.55);
        } catch {}
        break;
      }
      case "title": chord([110, 165, 220, 330], "triangle", t, 0.5, 0.02, 2.0); tone(55, "sine", t, 0.9, 0.006, 1.4, 41); noise(t, 0.3, 0.3, 60, 2000); break;
      case "tick": noise(t, 0.08, 0.03, 1500, 7000); break;
      case "ping": tone(880, "triangle", t, 0.4, 0.005, 0.4); tone(1320, "sine", t, 0.2, 0.005, 0.5); break;
      case "thud": tone(60, "sine", t, 0.8, 0.005, 0.6, 32); noise(t, 0.2, 0.18, 40, 900); break;
      case "rise": tone(180, "sine", t, 0.25, 0.02, 2.2, 520); break;
      case "stampGood": chord([130.8, 196, 261.6, 392], "triangle", t, 0.55, 0.015, 2.0); tone(65, "sine", t, 0.9, 0.006, 1.2, 44); break;
      case "stampBad": chord([110, 130.8, 155.6], "sawtooth", t, 0.5, 0.02, 2.0); tone(55, "sine", t, 0.9, 0.006, 1.4, 30); noise(t, 0.25, 0.3, 50, 1200); break;
    }
  }, [ensure, tone, noise, chord]);

  const startBed = useCallback((kind: BedKind) => {
    const ctx = ensure();
    if (!ctx || !masterRef.current) return;
    stopBedInternal();
    try {
      const master = masterRef.current;
      const t = ctx.currentTime;
      const bedGain = ctx.createGain();
      bedGain.gain.setValueAtTime(0.0001, t);
      bedGain.gain.linearRampToValueAtTime(kind === "intro" ? 0.5 : 0.45, t + 2.5);
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 320;
      bedGain.connect(lp).connect(master);
      const freqs = kind === "outroGood" ? [55, 82.4, 110] : kind === "outroBad" ? [55, 58.3, 82.4] : [55, 55.4, 110];
      const oscs: OscillatorNode[] = freqs.map((f) => {
        const o = ctx.createOscillator();
        o.type = "sawtooth"; o.frequency.value = f;
        o.connect(bedGain); o.start(t);
        return o;
      });
      bedRef.current = [...oscs, bedGain, lp];
      if (kind === "intro") {
        tickRef.current = setInterval(() => play("tick"), 500);
      }
    } catch {}
  }, [ensure, play]);

  const stopBedInternal = () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    const ctx = ctxRef.current;
    bedRef.current.forEach((n) => {
      try {
        if ("stop" in n && typeof (n as OscillatorNode).stop === "function") {
          (n as OscillatorNode).stop((ctx?.currentTime ?? 0) + 0.3);
        }
        (n as AudioNode).disconnect?.();
      } catch {}
    });
    bedRef.current = [];
  };

  const stopAll = useCallback(() => {
    stopBedInternal();
  }, []);

  useEffect(() => () => { stopBedInternal(); try { ctxRef.current?.close(); } catch {} }, []);

  return { unlock, play, startBed, stopAll, muted, setMuted };
}
