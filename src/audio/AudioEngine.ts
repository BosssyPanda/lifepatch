"use client";

import * as Tone from "tone";
import type { AmbienceId, SfxName, StingTone } from "./sfxBank";

/**
 * LifePatch adaptive score — one continuous "tense lo-fi documentary" piece in
 * A minor @ 76 BPM that morphs between game phases. See .claude/audio/qc/cue-plan.md.
 *
 * Hard rules:
 *  - The Transport never stops between screens; phase/intensity changes only
 *    RAMP stem gains, so music is seamless (never a hard cut).
 *  - Every teardown fades first (see dispose()).
 *  - All material is original (generic tonal voicings, no transcribed works).
 */

export type ScorePhase = "intro" | "menu" | "gameplay" | "recapGood" | "recapBad";
export type AccentKind =
  | "thump" | "hit" | "stab" | "riser" | "title"
  | "rise" | "ping" | "thud" | "stampGood" | "stampBad";

type StemId = "sub" | "pad" | "rhodes" | "tick" | "crackle" | "tension" | "warmth";

// --- musical material (A minor, 76 BPM, 8-bar / 4-segment cycle) ---
const BPM = 76;
// chord voicings per 2-bar segment: Am(add9) → Fmaj7 → Cmaj7 → G6/B
const CHORDS: string[][] = [
  ["A3", "C4", "E4", "B4"],
  ["F3", "A3", "C4", "E4"],
  ["C4", "E4", "G4", "B4"],
  ["B3", "D4", "G4", "E4"],
];
const ROOTS = ["A1", "F1", "C2", "B1"]; // sub follows the bass root per segment
// 4-note Rhodes leitmotif (1 b3 5 4) placed over the 2-bar segment, sparse.
const MOTIF: (string | null)[] = ["A4", null, "C5", null, "E5", null, "D5", null];

// phase → target gain per stem (intensity adjusts gameplay further)
const PRESETS: Record<ScorePhase, Record<StemId, number>> = {
  intro:     { sub: 0.5,  pad: 0.5,  rhodes: 0.18, tick: 0.4,  crackle: 0.06, tension: 0.5,  warmth: 0.0 },
  menu:      { sub: 0.35, pad: 0.45, rhodes: 0.5,  tick: 0.15, crackle: 0.06, tension: 0.0,  warmth: 0.1 },
  gameplay:  { sub: 0.4,  pad: 0.4,  rhodes: 0.25, tick: 0.3,  crackle: 0.06, tension: 0.0,  warmth: 0.0 },
  recapGood: { sub: 0.45, pad: 0.5,  rhodes: 0.6,  tick: 0.25, crackle: 0.06, tension: 0.0,  warmth: 0.6 },
  recapBad:  { sub: 0.5,  pad: 0.4,  rhodes: 0.2,  tick: 0.2,  crackle: 0.06, tension: 0.55, warmth: 0.0 },
};

export class AudioEngine {
  private started = false;
  private phase: ScorePhase = "menu";
  private intensity = 0.3;
  private seg = 0;

  private master!: Tone.Gain;
  private musicBus!: Tone.Gain;
  private accentBus!: Tone.Gain;
  private sfxBus!: Tone.Gain;
  private ambBus!: Tone.Gain;
  private stems!: Record<StemId, Tone.Gain>;
  private currentAmb: { id: AmbienceId; out: Tone.Gain; dispose: () => void } | null = null;

  // voices
  private pad!: Tone.PolySynth;
  private sub!: Tone.Synth;
  private rhodes!: Tone.FMSynth;
  private kick!: Tone.MembraneSynth;
  private hat!: Tone.NoiseSynth;
  private crackleNoise!: Tone.Noise;
  private tensionA!: Tone.Oscillator;
  private tensionB!: Tone.Oscillator;
  private warmthOsc!: Tone.Oscillator;

  private loops: { dispose(): void }[] = [];

  get isStarted() {
    return this.started;
  }

  /** Build the graph + start the Transport. Must be called after a user gesture. */
  async start(initialPhase: ScorePhase = "menu"): Promise<void> {
    if (this.started) {
      this.setPhase(initialPhase);
      return;
    }
    await Tone.start();
    const t = Tone.getTransport();
    t.bpm.value = BPM;

    this.master = new Tone.Gain(0.85).toDestination();
    this.musicBus = new Tone.Gain(1).connect(this.master);
    this.accentBus = new Tone.Gain(0.9).connect(this.master);
    this.sfxBus = new Tone.Gain(0.9).connect(this.master);
    this.ambBus = new Tone.Gain(0.8).connect(this.master);

    // per-stem gains start silent and ramp in via setPhase()
    this.stems = {
      sub: new Tone.Gain(0).connect(this.musicBus),
      pad: new Tone.Gain(0).connect(this.musicBus),
      rhodes: new Tone.Gain(0).connect(this.musicBus),
      tick: new Tone.Gain(0).connect(this.musicBus),
      crackle: new Tone.Gain(0).connect(this.musicBus),
      tension: new Tone.Gain(0).connect(this.musicBus),
      warmth: new Tone.Gain(0).connect(this.musicBus),
    };

    // --- harmony pad: warm detuned saws, soft low-pass ---
    const padFilter = new Tone.Filter(900, "lowpass").connect(this.stems.pad);
    this.pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 3, spread: 22 },
      envelope: { attack: 1.1, decay: 0.5, sustain: 0.85, release: 3 },
      volume: -10,
    }).connect(padFilter);

    // --- sub bass (sine), follows the root ---
    this.sub = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.06, decay: 0.3, sustain: 0.9, release: 1.2 },
      volume: -6,
    }).connect(this.stems.sub);

    // --- Rhodes-ish electric piano (FM) for the leitmotif ---
    const rhodesChorus = new Tone.Chorus(1.2, 2.5, 0.3).start().connect(this.stems.rhodes);
    this.rhodes = new Tone.FMSynth({
      harmonicity: 2.01,
      modulationIndex: 6,
      oscillator: { type: "sine" },
      modulation: { type: "sine" },
      envelope: { attack: 0.004, decay: 0.7, sustain: 0.08, release: 1.4 },
      modulationEnvelope: { attack: 0.01, decay: 0.4, sustain: 0.1, release: 0.6 },
      volume: -9,
    }).connect(rhodesChorus);

    // --- percussion: soft kick on the 1, hat tick on the beat ---
    this.kick = new Tone.MembraneSynth({
      pitchDecay: 0.05, octaves: 5,
      envelope: { attack: 0.001, decay: 0.32, sustain: 0 },
      volume: -8,
    }).connect(this.stems.tick);
    const hatHP = new Tone.Filter(2000, "highpass").connect(this.stems.tick);
    this.hat = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.03, sustain: 0 },
      volume: -22,
    }).connect(hatHP);

    // --- always-on vinyl/tape crackle (the glue) ---
    const crackleBP = new Tone.Filter(1600, "bandpass").connect(this.stems.crackle);
    crackleBP.Q.value = 0.6;
    this.crackleNoise = new Tone.Noise({ type: "pink", volume: -20 }).connect(crackleBP).start();

    // --- tension drone: two detuned oscillators a semitone apart (b9 grind) ---
    const tensionFilter = new Tone.Filter(700, "lowpass").connect(this.stems.tension);
    this.tensionA = new Tone.Oscillator("A2", "sawtooth").connect(tensionFilter);
    this.tensionB = new Tone.Oscillator("A#2", "sawtooth").connect(tensionFilter);
    this.tensionA.volume.value = -14; this.tensionB.volume.value = -16;
    this.tensionA.start(); this.tensionB.start();

    // --- warmth shimmer: high major-6th sine, breathes via a slow tremolo ---
    const warmthTrem = new Tone.Tremolo(0.15, 0.5).start().connect(this.stems.warmth);
    this.warmthOsc = new Tone.Oscillator("F#5", "triangle").connect(warmthTrem);
    this.warmthOsc.volume.value = -22;
    this.warmthOsc.start();

    // --- scheduled musical loops (route to stem gains, so muting = ramp gain) ---
    // chords + sub: advance segment every 2 measures
    const harmonyLoop = new Tone.Loop((time) => {
      const chord = CHORDS[this.seg];
      const root = ROOTS[this.seg];
      this.pad.triggerAttackRelease(chord, "2m", time);
      this.sub.triggerAttackRelease(root, "1m", time);
      this.sub.triggerAttackRelease(root, "1m", time + Tone.Time("1m").toSeconds());
      this.seg = (this.seg + 1) % CHORDS.length;
    }, "2m").start(0);

    // rhodes motif: sparse 8th-note sequence, restated each 2 measures
    const motifSeq = new Tone.Sequence(
      (time, note) => {
        if (note) this.rhodes.triggerAttackRelease(note, "8n", time, 0.8);
      },
      MOTIF, "8n",
    ).start(0);
    motifSeq.loop = true;

    // pulse: kick on beat 1 of each bar, hat on every beat
    const pulseLoop = new Tone.Loop((time) => {
      this.hat.triggerAttackRelease("32n", time);
    }, "4n").start(0);
    const kickLoop = new Tone.Loop((time) => {
      this.kick.triggerAttackRelease("A1", "8n", time);
    }, "1m").start(0);

    this.loops = [harmonyLoop, motifSeq, pulseLoop, kickLoop];

    t.start();
    this.started = true;
    this.setPhase(initialPhase, 0.6);
  }

  /** Crossfade stem gains to a phase preset. Transport keeps running. */
  setPhase(phase: ScorePhase, fade = 1.1): void {
    this.phase = phase;
    if (!this.started) return;
    const target = this.targetGains();
    const now = Tone.now();
    (Object.keys(this.stems) as StemId[]).forEach((id) => {
      this.stems[id].gain.cancelScheduledValues(now);
      this.stems[id].gain.linearRampTo(target[id], fade, now);
    });
  }

  /** 0..1 adaptive intensity (mainly affects the gameplay mix). */
  setIntensity(level: number, fade = 1.4): void {
    this.intensity = Math.max(0, Math.min(1, level));
    if (!this.started || this.phase !== "gameplay") return;
    const target = this.targetGains();
    const now = Tone.now();
    (["tension", "warmth", "rhodes", "tick", "sub"] as StemId[]).forEach((id) => {
      this.stems[id].gain.cancelScheduledValues(now);
      this.stems[id].gain.linearRampTo(target[id], fade, now);
    });
  }

  /** Brief warmth swell (e.g. a win) that settles back. */
  swellWarmth(amount = 0.5, hold = 1.8): void {
    if (!this.started) return;
    const g = this.stems.warmth.gain;
    const now = Tone.now();
    g.cancelScheduledValues(now);
    g.linearRampTo(amount, 0.4, now);
    g.linearRampTo(this.targetGains().warmth, 1.2, now + hold);
  }

  private targetGains(): Record<StemId, number> {
    const base = { ...PRESETS[this.phase] };
    if (this.phase === "gameplay") {
      const i = this.intensity;
      base.tension = Math.max(base.tension, (i - 0.45) > 0 ? (i - 0.45) * 1.1 : 0);
      base.warmth = base.warmth; // swells handled separately
      base.tick = 0.22 + i * 0.22;
      base.rhodes = 0.3 - i * 0.12; // motif recedes as it gets tense
      base.sub = 0.36 + i * 0.18;
    }
    return base;
  }

  /** One-shot cinematic accent, quantized to the next 8th when running. */
  accent(kind: AccentKind): void {
    if (!this.started) return;
    const t = Tone.getTransport();
    const now = Tone.now();
    let at = now + 0.02;
    if (t.state === "started") {
      const next = t.nextSubdivision("8n");
      if (Number.isFinite(next) && next >= now) at = next;
    }
    this.fireAccent(kind, at);
  }

  private fireAccent(kind: AccentKind, at: number): void {
    const bus = this.accentBus;
    const mk = {
      membrane: (note: string, dur: string, vol = 0) => {
        const m = new Tone.MembraneSynth({ pitchDecay: 0.06, octaves: 6, volume: vol }).connect(bus);
        m.triggerAttackRelease(note, dur, at);
        this.disposeLater(m, 2.5);
      },
      noiseHit: (dur: number, hp: number, vol = -6) => {
        const n = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.002, decay: dur, sustain: 0 }, volume: vol });
        const f = new Tone.Filter(hp, "highpass").connect(bus);
        n.connect(f);
        n.triggerAttackRelease(dur, at);
        this.disposeLater(n, dur + 1); this.disposeLater(f, dur + 1.1);
      },
      chord: (notes: string[], type: "sine" | "triangle" | "sawtooth" | "square", dur: string, vol = -8) => {
        const p = new Tone.PolySynth(Tone.Synth, { oscillator: { type }, envelope: { attack: 0.01, decay: 0.6, sustain: 0.3, release: 2 }, volume: vol }).connect(bus);
        p.triggerAttackRelease(notes, dur, at);
        this.disposeLater(p, 4);
      },
    };

    switch (kind) {
      case "thump": mk.membrane("A1", "4n", -2); mk.noiseHit(0.12, 200, -14); break;
      case "hit": mk.membrane("F1", "4n", 0); mk.noiseHit(0.2, 120, -8); break;
      case "stab": mk.chord(["A3", "A#3", "E4"], "sawtooth", "8n", -10); mk.membrane("A1", "8n", -4); break;
      case "riser": this.riser(at); break;
      case "title": mk.membrane("A1", "2n", 0); mk.chord(["A3", "C4", "E4", "A4", "E5"], "triangle", "1m", -6); mk.noiseHit(0.5, 300, -10); break;
      case "rise": this.riser(at, 0.7); break;
      case "ping": mk.chord(["A5", "E6"], "triangle", "4n", -10); break;
      case "thud": mk.membrane("C1", "4n", -4); mk.noiseHit(0.18, 90, -16); break;
      case "stampGood": mk.chord(["C4", "E4", "G4", "C5"], "triangle", "1m", -6); mk.membrane("C2", "2n", -2); break;
      case "stampBad": mk.chord(["A3", "A#3", "D#4"], "sawtooth", "1m", -7); mk.membrane("A1", "2n", -2); mk.noiseHit(0.4, 120, -12); break;
    }
  }

  private riser(at: number, len = 1.4): void {
    const n = new Tone.Noise("white");
    const bp = new Tone.Filter({ type: "bandpass", frequency: 300, Q: 6 }).connect(this.accentBus);
    const g = new Tone.Gain(0).connect(bp);
    n.connect(g).start(at);
    bp.frequency.setValueAtTime(300, at);
    bp.frequency.exponentialRampToValueAtTime(3500, at + len);
    g.gain.linearRampTo(0.5, len * 0.85, at);
    g.gain.linearRampTo(0.0001, len * 0.2, at + len * 0.85);
    n.stop(at + len + 0.1);
    this.disposeLater(n, len + 0.5); this.disposeLater(bp, len + 0.6); this.disposeLater(g, len + 0.6);
  }

  private disposeLater(node: { dispose(): void }, after: number): void {
    setTimeout(() => { try { node.dispose(); } catch {} }, after * 1000);
  }

  // ===========================================================================
  // SFX + scenario ambience (synthesized in-engine; original, no samples).
  // The file-based path in sfxBank.ts can override these later with real
  // recorded foley without touching callers. Routed through sfxBus/ambBus so
  // mute + fades apply uniformly and nothing ever hard-cuts.
  // ===========================================================================

  /** One-shot UI / foley effect. */
  playSfx(name: SfxName): void {
    if (!this.started) return;
    const at = Tone.now() + 0.01;
    const bus = this.sfxBus;
    switch (name) {
      case "click": this.noiseBurst(at, 0.012, 4000, "highpass", -16); break;
      case "hover": this.blip(at, 2100, "sine", 0.03, -28); break;
      case "uitick": this.noiseBurst(at, 0.01, 5000, "highpass", -22); break;
      case "paper":
        this.noiseBurst(at, 0.05, 2600, "bandpass", -12, 1.2);
        this.noiseBurst(at + 0.06, 0.045, 3400, "bandpass", -14, 1.2);
        break;
      case "confirm": this.blip(at, 523.25, "triangle", 0.09, -12); this.blip(at + 0.07, 783.99, "triangle", 0.12, -12); break;
      case "coins": [0, 0.045, 0.09, 0.14].forEach((d, i) => this.ping(at + d, 1400 + i * 260 + Math.random() * 120)); break;
      case "cash":
        this.noiseBurst(at, 0.08, 3200, "bandpass", -14, 0.9); // riffle
        this.thock(at + 0.05, "C2", -6); // drawer
        break;
      case "stamp": this.thock(at, "G1", -3); this.noiseBurst(at, 0.05, 600, "lowpass", -12); break;
      case "page": this.swish(at, 0.26); break;
      case "chime": [523.25, 659.25, 783.99].forEach((f, i) => this.blip(at + i * 0.015, f, "triangle", 0.9, -14)); break;
      case "soft": this.blip(at, 320, "sine", 0.16, -16, 200); break;
      case "modal": this.blip(at, 220, "sine", 0.26, -14, 520); break;
      case "dice": {
        // tumbling rattle: a scatter of small wooden clacks + bandpassed clicks
        const hits = [0, 0.05, 0.1, 0.155, 0.21, 0.27];
        hits.forEach((d, i) => {
          this.thock(at + d + Math.random() * 0.012, i % 2 ? "F2" : "B1", -12 - (i % 3) * 2);
          this.noiseBurst(at + d, 0.016, 2400 + Math.random() * 1000, "bandpass", -22, 1.6);
        });
        break;
      }
      case "diceLand": {
        // firm settle: low knock + crisp top click
        this.thock(at, "C2", -4);
        this.noiseBurst(at, 0.03, 1700, "bandpass", -13, 1.1);
        this.noiseBurst(at + 0.02, 0.018, 3200, "highpass", -20);
        break;
      }
    }
  }

  /** Reveal sting keyed to an outcome tone. */
  playSting(tone: StingTone): void {
    if (!this.started) return;
    const at = Tone.now() + 0.01;
    switch (tone) {
      case "good": [523.25, 659.25, 783.99].forEach((f, i) => this.blip(at + i * 0.06, f, "triangle", 0.5, -10)); break;
      case "bad": this.chordShot(["A3", "D#4"], "sawtooth", 0.6, -10, at); this.thock(at, "A1", -4); break;
      case "warning": this.chordShot(["D5", "G5"], "triangle", 0.4, -12, at); break;
      case "neutral": this.blip(at, 440, "sine", 0.35, -14); break;
    }
  }

  // --- one-shot primitives (each disposes itself) ---
  private noiseBurst(at: number, dur: number, freq: number, type: BiquadFilterType, vol: number, q = 1): void {
    const n = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.002, decay: dur, sustain: 0 }, volume: vol });
    const f = new Tone.Filter({ type, frequency: freq, Q: q }).connect(this.sfxBus);
    n.connect(f);
    n.triggerAttackRelease(dur, at);
    this.disposeLater(n, dur + 0.8); this.disposeLater(f, dur + 0.9);
  }
  private blip(at: number, freq: number, type: "sine" | "triangle" | "square" | "sawtooth", dur: number, vol: number, glideTo?: number): void {
    const s = new Tone.Synth({ oscillator: { type }, envelope: { attack: 0.004, decay: dur, sustain: 0, release: 0.05 }, volume: vol }).connect(this.sfxBus);
    if (glideTo) { s.frequency.setValueAtTime(freq, at); s.frequency.exponentialRampToValueAtTime(glideTo, at + dur); }
    s.triggerAttackRelease(freq, dur, at);
    this.disposeLater(s, dur + 0.8);
  }
  private ping(at: number, freq: number): void {
    const m = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.12, release: 0.05 }, harmonicity: 5.1, modulationIndex: 32, resonance: 3500, octaves: 1.4, volume: -22 }).connect(this.sfxBus);
    m.triggerAttackRelease(freq, "16n", at);
    this.disposeLater(m, 1);
  }
  private thock(at: number, note: string, vol: number): void {
    const m = new Tone.MembraneSynth({ pitchDecay: 0.04, octaves: 4, envelope: { attack: 0.001, decay: 0.18, sustain: 0 }, volume: vol }).connect(this.sfxBus);
    m.triggerAttackRelease(note, "16n", at);
    this.disposeLater(m, 1);
  }
  private swish(at: number, len: number): void {
    const n = new Tone.Noise("white");
    const bp = new Tone.Filter({ type: "bandpass", frequency: 1200, Q: 2.5 }).connect(this.sfxBus);
    const g = new Tone.Gain(0).connect(bp);
    n.connect(g).start(at);
    bp.frequency.setValueAtTime(1200, at);
    bp.frequency.exponentialRampToValueAtTime(4200, at + len);
    g.gain.linearRampTo(0.4, len * 0.4, at);
    g.gain.linearRampTo(0.0001, len * 0.6, at + len * 0.4);
    n.stop(at + len + 0.05);
    this.disposeLater(n, len + 0.5); this.disposeLater(bp, len + 0.6); this.disposeLater(g, len + 0.6);
  }
  private chordShot(notes: string[], type: "sine" | "triangle" | "square" | "sawtooth", dur: number, vol: number, at: number): void {
    const p = new Tone.PolySynth(Tone.Synth, { oscillator: { type }, envelope: { attack: 0.005, decay: dur, sustain: 0.1, release: 0.4 }, volume: vol }).connect(this.sfxBus);
    p.triggerAttackRelease(notes, dur, at);
    this.disposeLater(p, dur + 1);
  }

  /** Crossfade the looping scenario ambience (null = fade current out). */
  setAmbience(id: AmbienceId | null): void {
    if (!this.started) return;
    if (this.currentAmb?.id === id) return;
    const now = Tone.now();
    if (this.currentAmb) {
      const prev = this.currentAmb;
      prev.out.gain.cancelScheduledValues(now);
      prev.out.gain.linearRampTo(0, 0.7, now);
      setTimeout(() => { try { prev.dispose(); } catch {} }, 900);
      this.currentAmb = null;
    }
    if (!id) return;
    const built = this.buildAmbience(id);
    built.out.gain.linearRampTo(0.85, 0.8, now);
    this.currentAmb = { id, ...built };
  }

  private buildAmbience(id: AmbienceId): { out: Tone.Gain; dispose: () => void } {
    const out = new Tone.Gain(0).connect(this.ambBus);
    const parts: { dispose(): void }[] = [out];
    const loops: { dispose(): void }[] = [];
    const bed = (type: "white" | "pink" | "brown", freq: number, filt: BiquadFilterType, vol: number, q = 1) => {
      const f = new Tone.Filter({ type: filt, frequency: freq, Q: q }).connect(out);
      const n = new Tone.Noise({ type, volume: vol }).connect(f).start();
      parts.push(n, f);
    };
    const hum = (freq: number, vol: number) => {
      const o = new Tone.Oscillator(freq, "sine").connect(out);
      o.volume.value = vol; o.start();
      parts.push(o);
    };
    const every = (interval: string, cb: (time: number) => void) => {
      const l = new Tone.Loop(cb, interval).start(0);
      loops.push(l);
    };

    switch (id) {
      case "amb_office": bed("pink", 520, "lowpass", -26); hum(60, -30); every("8n", (t) => { if (Math.random() < 0.5) this.ambTickInto(out, t, 3500); }); break;
      case "amb_room": bed("brown", 420, "lowpass", -24); hum(55, -32); break;
      case "amb_keys": bed("pink", 600, "lowpass", -27); every("4n", (t) => { if (Math.random() < 0.35) this.ambTickInto(out, t, 2600); }); break;
      case "amb_hospital": bed("pink", 2400, "highpass", -34); every("2n", (t) => this.ambBeepInto(out, t, 880)); break;
      case "amb_coins": bed("white", 3200, "bandpass", -34, 1.5); every("2n", (t) => { if (Math.random() < 0.4) this.ambBeepInto(out, t, 2000, 0.05); }); break;
      case "amb_feed": bed("pink", 700, "lowpass", -30); every("1n", (t) => { if (Math.random() < 0.5) this.ambBeepInto(out, t, 1320, 0.08); }); break;
      case "amb_unease": {
        const fa = new Tone.Filter(300, "lowpass").connect(out);
        const fb = new Tone.Filter(300, "lowpass").connect(out);
        const a = new Tone.Oscillator("A1", "sawtooth").connect(fa);
        const b = new Tone.Oscillator("A#1", "sawtooth").connect(fb);
        a.volume.value = -26; b.volume.value = -28; a.start(); b.start();
        parts.push(a, b, fa, fb);
        break;
      }
      case "amb_shimmer": { const trem = new Tone.Tremolo(0.2, 0.6).start().connect(out); const o = new Tone.Oscillator("E5", "triangle").connect(trem); o.volume.value = -30; o.start(); parts.push(o, trem); break; }
      case "amb_hiss": bed("pink", 2200, "bandpass", -30, 0.7); break;
    }

    return {
      out,
      dispose: () => {
        loops.forEach((l) => { try { l.dispose(); } catch {} });
        parts.forEach((p) => { try { p.dispose(); } catch {} });
      },
    };
  }
  private ambTickInto(out: Tone.Gain, at: number, freq: number): void {
    const n = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.02, sustain: 0 }, volume: -30 });
    const f = new Tone.Filter({ type: "highpass", frequency: freq, Q: 1 }).connect(out);
    n.connect(f); n.triggerAttackRelease(0.02, at);
    this.disposeLater(n, 0.6); this.disposeLater(f, 0.7);
  }
  private ambBeepInto(out: Tone.Gain, at: number, freq: number, dur = 0.12): void {
    const s = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.01, decay: dur, sustain: 0, release: 0.05 }, volume: -28 }).connect(out);
    s.triggerAttackRelease(freq, dur, at);
    this.disposeLater(s, dur + 0.6);
  }

  /** Master volume (0..1), ramped — used by mute. Never an abrupt cut. */
  setVolume(v: number, fade = 0.12): void {
    if (!this.started) return;
    const now = Tone.now();
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.linearRampTo(v, fade, now);
  }

  /** Fade out fully, then stop transport + free nodes. Only on teardown. */
  async dispose(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    try {
      this.setVolume(0, 0.4);
      try { this.currentAmb?.out.gain.linearRampTo(0, 0.3, Tone.now()); } catch {}
      await new Promise((r) => setTimeout(r, 450));
      Tone.getTransport().stop();
      this.loops.forEach((l) => { try { l.dispose(); } catch {} });
      try { this.currentAmb?.dispose(); } catch {}
      this.currentAmb = null;
      [this.pad, this.sub, this.rhodes, this.kick, this.hat, this.crackleNoise, this.tensionA, this.tensionB, this.warmthOsc].forEach((n) => { try { n.dispose(); } catch {} });
      Object.values(this.stems).forEach((g) => { try { g.dispose(); } catch {} });
      this.musicBus.dispose(); this.accentBus.dispose(); this.sfxBus.dispose(); this.ambBus.dispose(); this.master.dispose();
    } catch {}
  }
}
