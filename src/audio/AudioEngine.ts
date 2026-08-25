"use client";

import * as Tone from "tone";
import type { AmbienceId, SfxName, StingTone } from "./sfxBank";
import { SCORE_BPM } from "./tempo";
import {
  BARS_PER_SEGMENT, BASS_LINE, BEATS_PER_BAR, BRAIN_GLOW, CARRIAGE_RETURN,
  CHORDS, COUNTER_LINE, COUNTER_NOTE_VALUE,
  GRIDS, INTENSITY_RULES, KEYS_FIGURES, LEAD_THEME, MIX, POLYPHONY, PRESETS, ROOTS,
  SFX_PRIMITIVES, SNARE_PATTERN, STINGERS, STINGER_PRIMITIVES, STINGER_TIMBRES,
  STING_TONES, SWELL_STEM, TICKS_PATTERN, TICK_STAMP_BARS, VELOCITY, VOICES, rampGain,
  type IntensityRamp, type StemId, type StingerSpec, type StingerTimbre,
  AMBIENCE_CEILING_HZ,
  segmentAtTicks,
} from "./score";

/**
 * LifePatch adaptive score — "The Debtor's March": one continuous defiant march
 * in D minor @ 108 BPM that morphs between game phases by gain alone.
 * See `.claude/audio/qc/cue-plan.md`.
 *
 * **This file owns no music.** Every pitch, pattern, gain, voice parameter and
 * stinger lives in `src/audio/score.ts`; what is here is the wiring that plays
 * it. The offline preview renderer (`scripts/audio/render-previews.mjs`) builds
 * the same graph from the same data, which is the only reason a preview WAV can
 * be trusted to sound like the game — so retuning the score is a data edit and
 * never an engine edit.
 *
 * The bed is nine stems (bass, brass, keys, snare, ticks, lead, tension, air,
 * counter) over a 16-bar harmonic cycle of 35.556s. All nine always PLAY; the
 * phase mix decides which are audible, which is what makes a phase change a set
 * of ramps rather than a re-scheduling.
 *
 * Hard rules:
 *  - The Transport never stops between screens; phase/intensity changes only
 *    RAMP stem gains, so music is seamless (never a hard cut).
 *  - Every teardown fades first (see dispose()).
 *  - No accent may still be sounding a bar after it fires (score.ts's
 *    STINGER_MAX_SOUNDING_SEC). Sustained chord stacks with nowhere to go are
 *    what the player heard as "loud beeping"; every accent here is a pluck.
 *  - All material is original (composed for this project — no samples, nothing
 *    transcribed).
 */

export type ScorePhase = "intro" | "title" | "menu" | "gameplay" | "recapGood" | "recapBad";
export type AccentKind =
  // the cold open's authored beats reach these through lib/cinematic's own union
  | "thump" | "hit" | "stab" | "riser" | "title"
  | "rise" | "thud" | "stampGood" | "stampBad"
  // v2 learning/social milestones (celebratory, grid-quantized)
  | "mastered" | "levelup" | "streak"
  // Addendum B: the money-consequence land motif (build→impact→settle, D minor)
  | "consequence";

// The tempo is shared with the visual beat grid (src/audio/tempo.ts) so the
// ceremonies can land their phase boundaries on the same instants as the score.
const BPM = SCORE_BPM;

/**
 * The accents whose material is data (see `STINGERS` in score.ts). `riser` and
 * `rise` are excluded: they are filtered-noise sweeps with no pitch material at
 * all, so there is nothing for a score to say about them and the engine keeps
 * owning them outright (see `riser()`).
 */
type StingerKind = Exclude<AccentKind, "riser" | "rise">;

/** An accent voice built from `STINGER_TIMBRES` (the piano-ish one is FM). */
type PluckVoice = Tone.PolySynth<Tone.Synth> | Tone.PolySynth<Tone.FMSynth>;

/**
 * The intensity rows for a phase, or `undefined` when the phase ignores
 * intensity entirely. `INTENSITY_RULES` is deliberately partial — only
 * `gameplay` and `intro` respond — so this is the single place that knows how
 * to ask it about a phase which may not be in it.
 */
function intensityRulesFor(phase: ScorePhase): Partial<Record<StemId, IntensityRamp>> | undefined {
  return (INTENSITY_RULES as Partial<Record<ScorePhase, Partial<Record<StemId, IntensityRamp>>>>)[phase];
}

/** Transpose a note name down an octave ("C#5" → "C#4"), for octave doubles. */
function octaveDown(note: string): string {
  const m = /^([A-G][#b]?)(\d)$/.exec(note);
  return m ? `${m[1]}${Math.max(0, Number(m[2]) - 1)}` : note;
}

/**
 * Global floor between repeats of the money / tick foley, in ms — the same
 * idiom the split-flap board uses (components/cinematic/SplitFlap.tsx). Anything
 * driven by a counter, a drag or a cascade can call these far faster than they
 * decay, and each call allocates voices; below its floor the request is dropped
 * rather than piled onto the bus. Deliberate one-per-action sounds (confirm,
 * stamp, page, chime, modal) are left unthrottled.
 */
const SFX_MIN_MS: Partial<Record<SfxName, number>> = {
  coins: 90, cash: 90, dice: 140, diceLand: 90, uitick: 55, click: 45, hover: 45,
};

/** Reusable coin-ping voices — see `ping()`. */
const PING_VOICES = 4;

/**
 * Which engine currently owns the shared Tone Transport. `dispose()` fades for
 * ~450ms before tearing down, and a remount inside that window (StrictMode,
 * Fast Refresh) builds a second engine — the old one must not stop the Transport
 * the new one just started.
 */
let transportOwner: AudioEngine | null = null;

export class AudioEngine {
  private started = false;
  private phase: ScorePhase = "menu";
  private intensity = 0.3;
  private brainGlow = 0; // 0..1 Money-Brain progress → warms the menu/recap bed

  private master!: Tone.Gain;
  private musicBus!: Tone.Gain;
  private accentBus!: Tone.Gain;
  private sfxBus!: Tone.Gain;
  private ambBus!: Tone.Gain;
  private stems!: Record<StemId, Tone.Gain>;
  private currentAmb: { id: AmbienceId; out: Tone.Gain; dispose: () => void } | null = null;

  // voices — one per entry of score.ts's VOICES book
  /** Chord voicings. PolySynth of MONOsynths so each voice gets the filter env. */
  private brass!: Tone.PolySynth<Tone.MonoSynth>;
  private keys!: Tone.PolySynth<Tone.FMSynth>;
  /** The tune, two detuned oscillators beating against each other. */
  private leadA!: Tone.PolySynth<Tone.Synth>;
  private leadB!: Tone.PolySynth<Tone.Synth>;
  private sub!: Tone.Synth;
  private marchA!: Tone.Synth;
  private marchB!: Tone.Synth;
  private snareNoise!: Tone.NoiseSynth;
  private snareBody!: Tone.Synth;
  private tick!: Tone.NoiseSynth;
  private stampThock!: Tone.MembraneSynth;
  private ding!: Tone.Synth;
  private tensionA!: Tone.Oscillator;
  private tensionB!: Tone.Oscillator;
  private airNoise!: Tone.Noise;
  private counter!: Tone.Synth;
  /** The carriage-return zip, built once and re-automated per cycle (see start). */
  private zipNoise!: Tone.Noise;
  private zipGain!: Tone.Gain;
  private zipFilter!: Tone.Filter;
  /** Filters/effects/LFOs the voices run through; torn down with them. */
  private musicNodes: { dispose(): void }[] = [];
  /** Pooled coin-ping voices (see `ping`), round-robined by `pingIdx`. */
  private pings: Tone.MetalSynth[] = [];
  private pingIdx = 0;

  private loops: { dispose(): void }[] = [];
  /** Last time each throttled SFX actually fired, on the performance clock. */
  private lastSfxAt: Partial<Record<SfxName, number>> = {};
  private swellTimer: ReturnType<typeof setTimeout> | null = null;
  /** In-flight `disposeLater` timers and the nodes they are waiting to free. */
  private pendingDisposals = new Map<ReturnType<typeof setTimeout>, { dispose(): void }>();

  get isStarted() {
    return this.started;
  }

  /**
   * Where the score's beat 1 sits on the `performance.now()` clock, so a visual
   * timeline can quantize to the grid the accents actually land on. Returns null
   * when the Transport isn't running — there is no grid to borrow yet, and the
   * caller falls back to its own performance.now()-anchored one (same tempo, so
   * the pacing is identical; only the phase differs).
   */
  transportAnchorMs(): number | null {
    if (!this.started || typeof performance === "undefined") return null;
    try {
      const t = Tone.getTransport();
      if (t.state !== "started") return null;
      const pos = t.seconds;
      if (!Number.isFinite(pos)) return null;
      return performance.now() - pos * 1000;
    } catch {
      return null;
    }
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

    this.master = new Tone.Gain(MIX.master).toDestination();
    this.musicBus = new Tone.Gain(MIX.music).connect(this.master);
    this.accentBus = new Tone.Gain(MIX.accent).connect(this.master);
    this.sfxBus = new Tone.Gain(MIX.sfx).connect(this.master);
    this.ambBus = new Tone.Gain(MIX.ambience).connect(this.master);

    // per-stem gains start silent and ramp in via setPhase()
    this.stems = {
      bass: new Tone.Gain(0).connect(this.musicBus),
      brass: new Tone.Gain(0).connect(this.musicBus),
      keys: new Tone.Gain(0).connect(this.musicBus),
      snare: new Tone.Gain(0).connect(this.musicBus),
      ticks: new Tone.Gain(0).connect(this.musicBus),
      lead: new Tone.Gain(0).connect(this.musicBus),
      tension: new Tone.Gain(0).connect(this.musicBus),
      air: new Tone.Gain(0).connect(this.musicBus),
      counter: new Tone.Gain(0).connect(this.musicBus),
    };

    const V = VOICES;
    const G = GRIDS;

    // --- brass: a PolySynth of MONOsynths, because the filter ENVELOPE has to
    //     be per voice. That sweep (380 → 1600Hz in 50ms, falling back over
    //     350ms) is the "bwah" that separates a brass section leaning into a
    //     chord from a pad. `octaves` is derived so base × 2^octaves is the
    //     score's stated peak. ---
    this.brass = new Tone.PolySynth(Tone.MonoSynth, {
      volume: V.brass.volume,
      oscillator: { ...V.brass.oscillator },
      envelope: { ...V.brass.envelope },
      filter: { type: V.brass.filter.type, Q: V.brass.filter.Q, rolloff: V.brass.filter.rolloff },
      filterEnvelope: {
        attack: V.brass.filter.envAttack,
        decay: V.brass.filter.envDecay,
        sustain: V.brass.filter.envSustain,
        release: V.brass.filter.envRelease,
        baseFrequency: V.brass.filter.base,
        octaves: Math.log2(V.brass.filter.peak / V.brass.filter.base),
        exponent: V.brass.filter.envExponent,
      },
    }).connect(this.stems.brass);
    this.brass.maxPolyphony = POLYPHONY.brass;

    // --- keys: the compressed upright, FM, hammer-then-decay ---
    this.keys = new Tone.PolySynth(Tone.FMSynth, { ...V.keys }).connect(this.stems.keys);
    this.keys.maxPolyphony = POLYPHONY.keys;

    // --- lead: two detuned oscillators → drive → tempo-synced delay. Drive sits
    //     BEFORE the delay so the echoes repeat an already-shaped note instead
    //     of re-distorting every tail.
    //     The high-pass is a DC blocker and it is not optional; see
    //     `VOICES.lead.dcBlock` in score.ts for why the pulse voice needs one. ---
    const leadDC = new Tone.Filter({
      type: "highpass", frequency: V.lead.dcBlock.hz, rolloff: V.lead.dcBlock.rolloff,
    }).connect(this.stems.lead);
    const leadDelay = new Tone.FeedbackDelay({
      delayTime: V.lead.delay.time, feedback: V.lead.delay.feedback, wet: V.lead.delay.wet,
    }).connect(leadDC);
    const leadDrive = new Tone.Distortion({ distortion: V.lead.drive, oversample: "2x" })
      .connect(leadDelay);
    this.leadA = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: V.lead.a.type, width: V.lead.a.width },
      envelope: { ...V.lead.envelope },
      volume: V.lead.volume,
    }).connect(leadDrive);
    this.leadB = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: V.lead.b.type },
      envelope: { ...V.lead.envelope },
      volume: V.lead.volume - V.lead.b.under,
      detune: V.lead.b.detune,
    }).connect(leadDrive);
    this.leadA.maxPolyphony = POLYPHONY.lead;
    this.leadB.maxPolyphony = POLYPHONY.lead;
    this.musicNodes.push(leadDC, leadDelay, leadDrive);

    // --- bass: sine sub for the weight, plus a march "oom" that survives a
    //     phone speaker where the sub is simply gone ---
    const bassHP = new Tone.Filter({
      type: "highpass", frequency: V.subBass.highpass.hz, rolloff: V.subBass.highpass.rolloff,
    }).connect(this.stems.bass);
    this.sub = new Tone.Synth({
      oscillator: { ...V.subBass.oscillator },
      envelope: { ...V.subBass.envelope },
      volume: V.subBass.volume,
    }).connect(bassHP);
    this.marchA = new Tone.Synth({
      oscillator: { type: V.marchBass.a.type },
      envelope: { ...V.marchBass.envelope },
      volume: V.marchBass.volume,
    }).connect(bassHP);
    this.marchB = new Tone.Synth({
      oscillator: { type: V.marchBass.b.type },
      envelope: { ...V.marchBass.envelope },
      volume: V.marchBass.volume - V.marchBass.b.under,
    }).connect(bassHP);
    this.musicNodes.push(bassHP);

    // --- snare: noise crack + tuned body, high-passed to leave the low end
    //     to the bass (noise alone is a "tss", tone alone is a tom) ---
    const snareHP = new Tone.Filter(V.snare.highpass, "highpass").connect(this.stems.snare);
    // The ceiling goes on the crack alone: unbounded noise up there is hiss, not
    // drum. The body bypasses it — see VOICES.snare.
    const snareLP = new Tone.Filter(V.snare.noise.ceilingHz, "lowpass").connect(snareHP);
    this.snareNoise = new Tone.NoiseSynth({
      noise: { type: V.snare.noise.type },
      envelope: { attack: V.snare.noise.attack, decay: V.snare.noise.decay, sustain: 0 },
      volume: V.snare.noise.volume,
    }).connect(snareLP);
    this.snareBody = new Tone.Synth({
      oscillator: { type: V.snare.body.type },
      envelope: { attack: V.snare.body.attack, decay: V.snare.body.decay, sustain: 0 },
      volume: V.snare.body.volume,
    }).connect(snareHP);
    this.musicNodes.push(snareHP, snareLP);

    // --- ticks: typewriter clacks, the 4-bar stamp, the carriage-return bell ---
    // The clack runs high-pass -> low-pass. The ceiling is what makes it a
    // typewriter instead of a hiss; see VOICES.tick for the measurement.
    const tickLP = new Tone.Filter(V.tick.band.lowpassHz, "lowpass").connect(this.stems.ticks);
    const tickHP = new Tone.Filter(V.tick.band.highpassHz, "highpass").connect(tickLP);
    this.tick = new Tone.NoiseSynth({
      noise: { type: V.tick.noise.type },
      envelope: { attack: V.tick.attack, decay: V.tick.decay, sustain: 0 },
      volume: V.tick.volume,
    }).connect(tickHP);
    this.stampThock = new Tone.MembraneSynth({
      pitchDecay: V.stampThock.pitchDecay, octaves: V.stampThock.octaves,
      envelope: { attack: V.stampThock.attack, decay: V.stampThock.decay, sustain: 0 },
      volume: V.stampThock.volume,
    }).connect(this.stems.ticks);
    this.ding = new Tone.Synth({
      oscillator: { ...V.carriageDing.oscillator },
      envelope: { attack: V.carriageDing.attack, decay: V.carriageDing.decay, sustain: 0 },
      volume: V.carriageDing.volume,
    }).connect(this.stems.ticks);
    this.musicNodes.push(tickHP, tickLP);

    // --- tension: two saws a minor second apart (D2 + Eb2) under a slow filter
    //     LFO. min/max fully define the cutoff — connecting a signal to
    //     filter.frequency overrides the filter's own value — so the breathing
    //     is expressed as a range around the score's stated cutoff. ---
    const tensionFilter = new Tone.Filter(V.tension.filter.frequency, V.tension.filter.type)
      .connect(this.stems.tension);
    const tensionLfo = new Tone.LFO({
      frequency: V.tension.lfo.rate,
      min: V.tension.filter.frequency - V.tension.lfo.depth,
      max: V.tension.filter.frequency + V.tension.lfo.depth,
      type: "sine",
    });
    tensionLfo.connect(tensionFilter.frequency);
    tensionLfo.start();
    this.tensionA = new Tone.Oscillator(V.tension.a.note, V.tension.a.type).connect(tensionFilter);
    this.tensionB = new Tone.Oscillator(V.tension.b.note, V.tension.b.type).connect(tensionFilter);
    this.tensionA.volume.value = V.tension.a.volume;
    this.tensionB.volume.value = V.tension.b.volume;
    this.tensionA.start(); this.tensionB.start();
    this.musicNodes.push(tensionFilter, tensionLfo);

    // --- air: the always-on room (the crackle's successor). Why silence in
    //     this game sounds like a room and not a dropped audio context. ---
    const airFilter = new Tone.Filter({
      type: V.air.filter.type, frequency: V.air.filter.frequency, Q: V.air.filter.Q,
    }).connect(this.stems.air);
    this.airNoise = new Tone.Noise({ type: V.air.noise.type, volume: V.air.volume }).connect(airFilter);
    this.airNoise.start();
    this.musicNodes.push(airFilter);

    // --- counter: the countermelody, breathing through a slow tremolo. A
    //     Tremolo that is never started does not modulate at all. ---
    const counterTrem = new Tone.Tremolo(V.counter.tremolo.rate, V.counter.tremolo.depth)
      .connect(this.stems.counter);
    counterTrem.start();
    this.counter = new Tone.Synth({
      oscillator: { ...V.counter.oscillator },
      envelope: { ...V.counter.envelope },
      volume: V.counter.volume,
    }).connect(counterTrem);
    this.musicNodes.push(counterTrem);

    // -----------------------------------------------------------------------
    // Scheduled patterns. Every one routes to a stem gain, so muting a layer is
    // a ramp and never a re-schedule; and every callback forwards its own `time`
    // argument, which is what keeps scheduling sample-accurate rather than
    // quantized to whenever the callback happened to run.
    // -----------------------------------------------------------------------

    // harmony: chord voicing + sub root + counter tone, one segment per 2 bars.
    //
    // The segment index is DERIVED from the transport rather than counted up in
    // this callback, and that is not a style preference. Every other part here
    // is a Tone.Sequence, and a Sequence takes its index from the transport's
    // own position — so a counter is only in agreement with the melody as long
    // as both started together. They do not always: the Transport deliberately
    // keeps running across a teardown (see `transportOwner`), so an engine built
    // by a Fast Refresh or a StrictMode remount inherits a transport that is
    // already mid-cycle. Its Sequences pick up at the right bar of the tune; a
    // counter starting from 0 would put the chords somewhere else entirely, and
    // the result is a march playing its own harmony against its own melody.
    const ticksPerSegment = t.PPQ * BEATS_PER_BAR * BARS_PER_SEGMENT;
    const harmonyLoop = new Tone.Loop((time) => {
      const seg = segmentAtTicks(t.getTicksAtTime(time), ticksPerSegment, CHORDS.length);
      this.brass.triggerAttackRelease([...CHORDS[seg]], "2m", time, VELOCITY.brass);
      this.sub.triggerAttackRelease(ROOTS[seg], "2m", time, VELOCITY.sub);
      this.counter.triggerAttackRelease(COUNTER_LINE[seg], COUNTER_NOTE_VALUE, time, VELOCITY.counter);
    }, G.harmony.subdivision).start(0);

    // the tune — always scheduled, audible only where the phase opens `lead`
    const leadSeq = new Tone.Sequence<string | null>((time, note) => {
      if (!note) return;
      this.leadA.triggerAttackRelease(note, "8n", time, VELOCITY.leadA);
      this.leadB.triggerAttackRelease(note, "8n", time, VELOCITY.leadB);
    }, [...LEAD_THEME], G.lead.subdivision).start(0);

    // the piano's comping figures (the tune's shadow, an octave down)
    const keysSeq = new Tone.Sequence<string | null>((time, note) => {
      if (!note) return;
      this.keys.triggerAttackRelease(note, "8n", time, VELOCITY.keys);
    }, [...KEYS_FIGURES], G.keys.subdivision).start(0);

    // the march "oom": root on 1, fifth on 3
    const bassSeq = new Tone.Sequence<string>((time, note) => {
      this.marchA.triggerAttackRelease(note, "4n", time, VELOCITY.marchA);
      this.marchB.triggerAttackRelease(note, "4n", time, VELOCITY.marchB);
    }, [...BASS_LINE], G.bass.subdivision).start(0);

    // Velocities, not pitches: 0 is a rest, and the ghost notes are what make
    // the pattern a march rather than a metronome. NoiseSynth takes velocity as
    // its THIRD argument (it has no note), unlike every pitched voice here.
    const snareSeq = new Tone.Sequence<number>((time, v) => {
      if (!v) return;
      this.snareNoise.triggerAttackRelease(V.snare.noise.decay, time, v);
      this.snareBody.triggerAttackRelease(V.snare.body.frequency, V.snare.body.decay, time, v * VELOCITY.snareBodyScale);
    }, [...SNARE_PATTERN], G.snare.subdivision).start(0);

    const ticksSeq = new Tone.Sequence<number>((time, v) => {
      if (!v) return;
      this.tick.triggerAttackRelease(V.tick.decay, time, v);
    }, [...TICKS_PATTERN], G.ticks.subdivision).start(0);

    // The 4-bar stamp: one Loop per stamped bar, each firing once per cycle.
    // (The offline renderer schedules these as absolute-time triggers because
    // its transport ends; here it runs forever, so a Loop is the honest form.)
    const stampLoops = TICK_STAMP_BARS.map((bar) => new Tone.Loop((time) => {
      this.stampThock.triggerAttackRelease(V.stampThock.note, "8n", time, VELOCITY.stamp);
    }, `${GRIDS.harmony.bars}m`).start(`${bar}m`));

    // The once-per-cycle carriage return, on the last beat of the last bar: the
    // page finishing right as the next one starts. The noise, its band-pass and
    // its gain are built ONCE here and only re-automated in the callback —
    // allocating a fresh graph every 35 seconds forever is how a long session
    // ends up with thousands of dead nodes.
    const cr = CARRIAGE_RETURN;
    this.zipFilter = new Tone.Filter({ type: "bandpass", frequency: cr.zip.fromHz, Q: cr.zip.bandpassQ })
      .connect(this.stems.ticks);
    this.zipGain = new Tone.Gain(0).connect(this.zipFilter);
    this.zipNoise = new Tone.Noise("white").connect(this.zipGain);
    this.zipNoise.start();
    const zipPeak = Math.pow(10, cr.zip.volume / 20) * cr.zip.peakScale;
    const carriageLoop = new Tone.Loop((time) => {
      this.ding.triggerAttackRelease(cr.ding, "8n", time, VELOCITY.ding);
      this.zipFilter.frequency.setValueAtTime(cr.zip.fromHz, time);
      this.zipFilter.frequency.exponentialRampToValueAtTime(cr.zip.toHz, time + cr.zip.durationSec);
      this.zipGain.gain.setValueAtTime(0, time);
      this.zipGain.gain.linearRampToValueAtTime(zipPeak, time + cr.zip.durationSec * cr.zip.rampFraction);
      this.zipGain.gain.linearRampToValueAtTime(0, time + cr.zip.durationSec);
    }, `${GRIDS.harmony.bars}m`).start(`${cr.bar}:${cr.beat}:0`);

    this.loops = [harmonyLoop, leadSeq, keysSeq, bassSeq, snareSeq, ticksSeq, ...stampLoops, carriageLoop];

    // Pooled coin pings, built once instead of per call (see `ping`).
    this.pings = Array.from({ length: PING_VOICES }, () =>
      new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.12, release: 0.05 }, harmonicity: 5.1, modulationIndex: 32, resonance: 3500, octaves: 1.4, volume: -22 }).connect(this.sfxBus));
    this.pingIdx = 0;

    t.start();
    transportOwner = this;
    this.started = true;
    this.setPhase(initialPhase, 0.6);

    // Dev-only probe for the headless audio journey (scripts/qa/): which phase
    // the engine actually reached is otherwise invisible from outside the React
    // tree, and "the music changed" is exactly the assertion a smoke test wants
    // to make. A getter, so it never goes stale; never read by app code, and
    // never defined in a production build.
    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
      Object.defineProperty(window, "__lpAudio", {
        configurable: true,
        get: () => ({ phase: this.phase, intensity: this.intensity, started: this.started }),
      });
    }
  }

  /**
   * Crossfade stem gains to a phase preset. Transport keeps running.
   *
   * No `cancelScheduledValues` here (nor in setIntensity / setBrainGlow /
   * setVolume): cancelling an in-flight ramp deletes its END event, so the param
   * snaps back to its last anchor before the new ramp starts — an audible zipper
   * whenever these are called rapidly. `Tone.Param.linearRampTo` already
   * re-anchors at the current value, which is exactly the behaviour we want.
   */
  setPhase(phase: ScorePhase, fade = 1.1): void {
    this.phase = phase;
    if (!this.started) return;
    const target = this.targetGains();
    const now = Tone.now();
    (Object.keys(this.stems) as StemId[]).forEach((id) => {
      this.stems[id].gain.linearRampTo(target[id], fade, now);
    });
  }

  /**
   * 0..1 adaptive intensity — financial stress in `gameplay`, the cold open's
   * beat-by-beat build in `intro`.
   *
   * Which stems move, and by how much, is `INTENSITY_RULES` in score.ts; a phase
   * that is absent from that table ignores intensity entirely and keeps its
   * preset row. (This used to return early unless the phase was `gameplay`,
   * which meant `ColdOpen`'s escalation was inaudible — it set a number nothing
   * read. The rule lives in the score now so the engine and the offline renderer
   * cannot disagree about what the cold open does.)
   *
   * Same no-`cancelScheduledValues` rationale as setPhase.
   */
  setIntensity(level: number, fade = 1.4): void {
    this.intensity = Math.max(0, Math.min(1, level));
    if (!this.started) return;
    const rules = intensityRulesFor(this.phase);
    if (!rules) return;
    const target = this.targetGains();
    const now = Tone.now();
    (Object.keys(rules) as StemId[]).forEach((id) => {
      this.stems[id].gain.linearRampTo(target[id], fade, now);
    });
  }

  /**
   * Brief warmth swell (e.g. a win) that settles back. The warmth of this score
   * is the countermelody (`SWELL_STEM`), which is why the method keeps its name
   * while the stem it opens has changed — ~25 call sites say `swellWarmth()`.
   *
   * The settle is a timer rather than a pre-scheduled second ramp: by the time
   * the swell ends the phase may have moved on, and the restore has to aim at
   * the bed that is playing THEN, not the one that was playing when it fired.
   * (It also keeps setPhase free of the cancelScheduledValues it used to need to
   * clear a stale queued restore.)
   */
  swellWarmth(amount = 0.5, hold = 1.8): void {
    if (!this.started) return;
    // Clamped because this is a public method with ~25 call sites and a stem
    // gain is a raw multiplier: a caller who reads "amount" as a percentage and
    // passes 50 does not get a louder swell, it gets the mix 34 dB into clipping.
    const level = Math.max(0, Math.min(1, amount));
    this.stems[SWELL_STEM].gain.linearRampTo(level, 0.4, Tone.now());
    if (this.swellTimer !== null) clearTimeout(this.swellTimer);
    this.swellTimer = setTimeout(() => {
      this.swellTimer = null;
      if (!this.started) return;
      this.stems[SWELL_STEM].gain.linearRampTo(this.targetGains()[SWELL_STEM], 1.2, Tone.now());
    }, hold * 1000);
  }

  /**
   * The mix the current phase/intensity/glow asks for — the whole dramaturgy of
   * the score, and none of it decided here: `PRESETS` is the phase row,
   * `INTENSITY_RULES` + `rampGain` are how a stem answers stress (the engine
   * must not own that arithmetic, or a preview could drift from the game by a
   * rounding convention), and `BRAIN_GLOW` is the one-directional warming.
   */
  private targetGains(): Record<StemId, number> {
    const base: Record<StemId, number> = { ...PRESETS[this.phase] };
    const rules = intensityRulesFor(this.phase);
    if (rules) {
      (Object.keys(rules) as StemId[]).forEach((id) => {
        const ramp = rules[id];
        if (ramp) base[id] = rampGain(ramp, this.intensity);
      });
    }
    if ((BRAIN_GLOW.phases as readonly ScorePhase[]).includes(this.phase)) {
      (Object.keys(BRAIN_GLOW.perStem) as StemId[]).forEach((id) => {
        const per = BRAIN_GLOW.perStem[id as keyof typeof BRAIN_GLOW.perStem] ?? 0;
        base[id] = Math.max(0, Math.min(1, base[id] + this.brainGlow * per));
      });
    }
    return base;
  }

  /** 0..1 Money-Brain progress. Warms the calm (menu/title/recap) bed a touch. */
  setBrainGlow(level: number, fade = 1.6): void {
    this.brainGlow = Math.max(0, Math.min(1, level));
    if (!this.started) return;
    if (!(BRAIN_GLOW.phases as readonly ScorePhase[]).includes(this.phase)) return;
    const target = this.targetGains();
    const now = Tone.now();
    (Object.keys(BRAIN_GLOW.perStem) as StemId[]).forEach((id) => {
      this.stems[id].gain.linearRampTo(target[id], fade, now);
    });
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
    // The two noise sweeps have no pitch material, so the score has nothing to
    // say about them and they stay here.
    if (kind === "riser") { this.riser(at); return; }
    if (kind === "rise") { this.riser(at, 0.7); return; }
    this.fireStinger(kind, at);
  }

  /**
   * Render one entry of `STINGERS` — the accent's material, entirely as data.
   *
   * There is deliberately no "hold a chord" primitive here any more. Every
   * accent is a pluck, a membrane, a noise transient or a snare ruff, each of
   * which is physically incapable of the failure this rewrite exists to remove:
   * the old `title` / `stampGood` / `stampBad` accents held PolySynth chord
   * stacks for a full measure over a beating drone, which is what the player was
   * describing as "loud beeping". See STINGER_MAX_SOUNDING_SEC in score.ts.
   */
  private fireStinger(kind: StingerKind, at: number): void {
    const bus = this.accentBus;
    const spec: StingerSpec = STINGERS[kind];

    for (const layer of spec.layers) {
      const t0 = at + (layer.atSec ?? 0);
      switch (layer.kind) {
        case "pluck": {
          this.pluck(layer.timbre, layer.volume)
            .triggerAttackRelease([...layer.notes], layer.duration, t0, VELOCITY.pluck);
          if (layer.octaveDoubleVolume !== undefined) {
            this.pluck(layer.timbre, layer.octaveDoubleVolume)
              .triggerAttackRelease(layer.notes.map(octaveDown), layer.duration, t0, VELOCITY.pluckOctaveDouble);
          }
          break;
        }
        case "arp": {
          const v = this.pluck(layer.timbre, layer.volume);
          layer.notes.forEach((n, i) =>
            v.triggerAttackRelease(n, layer.duration, t0 + i * layer.stepSec, VELOCITY.pluck));
          if (layer.octaveDoubleVolume !== undefined) {
            const d = this.pluck(layer.timbre, layer.octaveDoubleVolume);
            layer.notes.forEach((n, i) =>
              d.triggerAttackRelease(octaveDown(n), layer.duration, t0 + i * layer.stepSec, VELOCITY.pluckOctaveDouble));
          }
          break;
        }
        case "membrane": {
          const m = new Tone.MembraneSynth({ ...STINGER_PRIMITIVES.membrane, volume: layer.volume }).connect(bus);
          m.triggerAttackRelease(layer.note, layer.duration, t0);
          this.disposeLater(m, 2.5);
          break;
        }
        case "noise": {
          // band, not a bare high-pass: the ceiling is what stops the impact
          // reading as a hiss burst. See STINGER_PRIMITIVES.noise.
          const lp = new Tone.Filter(STINGER_PRIMITIVES.noise.ceilingHz, "lowpass").connect(bus);
          const f = new Tone.Filter(layer.highpassHz, "highpass").connect(lp);
          const n = new Tone.NoiseSynth({
            noise: { type: "white" },
            envelope: { attack: STINGER_PRIMITIVES.noise.attack, decay: layer.durationSec, sustain: 0 },
            volume: layer.volume,
          }).connect(f);
          n.triggerAttackRelease(layer.durationSec, t0);
          this.disposeLater(n, layer.durationSec + 1); this.disposeLater(f, layer.durationSec + 1.1);
          this.disposeLater(lp, layer.durationSec + 1.2);
          break;
        }
        case "ruff": {
          const R = STINGER_PRIMITIVES.ruff;
          const rlp = new Tone.Filter(R.ceilingHz, "lowpass").connect(bus);
          const hp = new Tone.Filter(R.highpassHz, "highpass").connect(rlp);
          const s = new Tone.NoiseSynth({
            noise: { type: "white" },
            envelope: { attack: 0.001, decay: R.decaySec, sustain: 0 },
            volume: layer.volume,
          }).connect(hp);
          layer.velocities.forEach((v, i) => s.triggerAttackRelease(R.decaySec, t0 + i * layer.stepSec, v));
          this.disposeLater(s, 2.5); this.disposeLater(hp, 2.6); this.disposeLater(rlp, 2.7);
          break;
        }
      }
    }
  }

  /**
   * One accent voice from `STINGER_TIMBRES`, disposed once it has rung out.
   *
   * `volume` overrides the timbre's own level, which is what an octave-doubling
   * layer uses to sit its lower copy underneath the original.
   */
  private pluck(timbre: StingerTimbre, volume?: number): PluckVoice {
    const bus = this.accentBus;
    let v: PluckVoice;
    if (timbre === "keysPluck") {
      v = new Tone.PolySynth(Tone.FMSynth, { ...STINGER_TIMBRES.keysPluck }).connect(bus);
    } else {
      const t = STINGER_TIMBRES[timbre];
      v = new Tone.PolySynth(Tone.Synth, {
        oscillator: { ...t.oscillator },
        envelope: { ...t.envelope },
        volume: t.volume,
      }).connect(bus);
    }
    if (volume !== undefined) v.volume.value = volume;
    this.disposeLater(v, 3);
    return v;
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

  /**
   * Free a one-shot voice once it has rung out.
   *
   * The handle is tracked so `dispose()` can cancel it. Without that, tearing
   * the engine down leaves every in-flight SFX holding a timer that fires into a
   * dead graph seconds later — harmless in itself (the call is guarded), but it
   * keeps the disposed nodes reachable, so the teardown does not actually finish
   * until the last SFX would have finished ringing.
   */
  private disposeLater(node: { dispose(): void }, after: number): void {
    const handle = setTimeout(() => {
      this.pendingDisposals.delete(handle);
      try { node.dispose(); } catch {}
    }, after * 1000);
    this.pendingDisposals.set(handle, node);
  }

  // ===========================================================================
  // SFX + scenario ambience (synthesized in-engine; original, no samples).
  // The file-based path in sfxBank.ts can override these later with real
  // recorded foley without touching callers. Routed through sfxBus/ambBus so
  // mute + fades apply uniformly and nothing ever hard-cuts.
  // ===========================================================================

  /**
   * One-shot UI / foley effect.
   *
   * `transpose` (semitones) shifts the FILTER of the tick foley only — it is
   * band-limited noise with no pitch class, so a brighter tick reads as "this
   * one matters more" without adding a note to the score. `juiceTier().pitch`
   * is what drives it. Every other effect ignores it.
   */
  playSfx(name: SfxName, transpose = 0): void {
    if (!this.started) return;
    const floor = SFX_MIN_MS[name];
    if (floor !== undefined) {
      const t = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (t - (this.lastSfxAt[name] ?? -Infinity) < floor) return;
      this.lastSfxAt[name] = t;
    }
    const at = Tone.now() + 0.01;
    const shift = transpose ? Math.pow(2, transpose / 12) : 1;
    switch (name) {
      case "click": this.noiseBurst(at, 0.012, 4000, "highpass", -16); break;
      case "hover": this.blip(at, 2100, "sine", 0.03, -28); break;
      case "uitick": this.noiseBurst(at, 0.01, Math.min(12000, 5000 * shift), "highpass", -22); break;
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
      // confident two-note rise when your own row places on the board
      case "rankUp": this.blip(at, 659.25, "triangle", 0.1, -11); this.blip(at + 0.075, 987.77, "triangle", 0.14, -11); break;
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

  /**
   * Reveal sting keyed to an outcome tone.
   *
   * The one place this rewrite is deliberately conservative: shapes, durations,
   * envelopes and levels are the originals to the digit, because players have
   * already learned what these mean. Only the pitches moved, into D minor —
   * `STING_TONES` in score.ts holds them (`neutral` is A4 = the dominant, so it
   * was already in the new key and has not changed at all).
   */
  playSting(tone: StingTone): void {
    if (!this.started) return;
    const at = Tone.now() + 0.01;
    const s = STING_TONES;
    switch (tone) {
      case "good": s.good.freqs.forEach((f, i) => this.blip(at + i * s.good.stepSec, f, s.good.wave, s.good.durationSec, s.good.volume)); break;
      case "bad": this.chordShot([...s.bad.notes], s.bad.wave, s.bad.durationSec, s.bad.volume, at); this.thock(at, s.bad.thock.note, s.bad.thock.volume); break;
      case "warning": this.chordShot([...s.warning.notes], s.warning.wave, s.warning.durationSec, s.warning.volume, at); break;
      case "neutral": this.blip(at, s.neutral.freq, s.neutral.wave, s.neutral.durationSec, s.neutral.volume); break;
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
    const P = SFX_PRIMITIVES.blip;
    const s = new Tone.Synth({ oscillator: { type }, envelope: { attack: P.attack, decay: dur, sustain: 0, release: P.release }, volume: vol }).connect(this.sfxBus);
    if (glideTo) { s.frequency.setValueAtTime(freq, at); s.frequency.exponentialRampToValueAtTime(glideTo, at + dur); }
    s.triggerAttackRelease(freq, dur, at);
    this.disposeLater(s, dur + 0.8);
  }
  /**
   * Coin ping, played from a fixed round-robin pool.
   *
   * A `MetalSynth` is ~15 AudioNodes and `coins` fires four pings per call, so
   * building one per ping (and holding it a full second before disposal) let a
   * rapid caller stack hundreds of live voices. PING_VOICES is wider than the
   * widest burst the score asks for, so nothing steals a voice mid-decay.
   */
  private ping(at: number, freq: number): void {
    const pool = this.pings;
    if (!pool.length) return;
    const m = pool[this.pingIdx];
    this.pingIdx = (this.pingIdx + 1) % pool.length;
    m.triggerAttackRelease(freq, "16n", at);
  }
  private thock(at: number, note: string, vol: number): void {
    const P = SFX_PRIMITIVES.thock;
    const m = new Tone.MembraneSynth({
      pitchDecay: P.pitchDecay, octaves: P.octaves,
      envelope: { attack: P.attack, decay: P.decay, sustain: 0 }, volume: vol,
    }).connect(this.sfxBus);
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
    const P = SFX_PRIMITIVES.chordShot;
    const p = new Tone.PolySynth(Tone.Synth, { oscillator: { type }, envelope: { attack: P.attack, decay: dur, sustain: P.sustain, release: P.release }, volume: vol }).connect(this.sfxBus);
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
    // `ceiling` is only meaningful for the high-passed beds; a low-passed one
    // already has one. See AMBIENCE_CEILING_HZ.
    const bed = (type: "white" | "pink" | "brown", freq: number, filt: BiquadFilterType, vol: number, q = 1, ceiling = false) => {
      const top = ceiling
        ? new Tone.Filter({ type: "lowpass", frequency: AMBIENCE_CEILING_HZ }).connect(out)
        : null;
      const f = new Tone.Filter({ type: filt, frequency: freq, Q: q }).connect(top ?? out);
      const n = new Tone.Noise({ type, volume: vol }).connect(f).start();
      parts.push(n, f);
      if (top) parts.push(top);
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
      // The beeps are retuned into D minor and de-fanged, and their
      // probabilities are lower than they used to be because these intervals are
      // TRANSPORT-relative: at 108 BPM instead of 76 the same "2n" comes round
      // 42% more often, so an unchanged probability would be an audibly busier
      // room. The probabilities below are set from the old rate in beeps per
      // second, not copied across:
      //
      //   coins    0.253/s -> 0.270/s  (+7%)
      //   feed     0.158/s -> 0.158/s  (unchanged)
      //   hospital 0.633/s -> 0.540/s  (-15%, deliberately)
      //
      // Hospital is the one that is not merely held steady. It used to beep on
      // every half note with no probability at all, which is the most insistent
      // bed in the game, and insistent beeping over a scenario is the exact
      // complaint this rewrite exists to answer. It is a room tone, not a
      // monitor alarm.
      case "amb_hospital": bed("pink", 2400, "highpass", -34, 1, true); every("2n", (t) => { if (Math.random() < 0.6) this.ambBeepInto(out, t, 587.33); }); break;
      case "amb_coins": bed("white", 3200, "bandpass", -34, 1.5); every("2n", (t) => { if (Math.random() < 0.3) this.ambBeepInto(out, t, 1760, 0.05); }); break;
      case "amb_feed": bed("pink", 700, "lowpass", -30); every("1n", (t) => { if (Math.random() < 0.35) this.ambBeepInto(out, t, 1174.66, 0.08); }); break;
      case "amb_unease": {
        // the score's own m2 grind (D2 + Eb2) at the same pitch as the tension
        // stem, but ~12dB quieter and under a much lower cutoff (300Hz vs 700):
        // scenario unease is meant to READ as the same anxiety the economy's
        // layer carries, sitting well beneath it rather than beside it.
        const fa = new Tone.Filter(300, "lowpass").connect(out);
        const fb = new Tone.Filter(300, "lowpass").connect(out);
        const a = new Tone.Oscillator("D2", "sawtooth").connect(fa);
        const b = new Tone.Oscillator("Eb2", "sawtooth").connect(fb);
        a.volume.value = -26; b.volume.value = -28; a.start(); b.start();
        parts.push(a, b, fa, fb);
        break;
      }
      case "amb_shimmer": { const trem = new Tone.Tremolo(0.2, 0.6).start().connect(out); const o = new Tone.Oscillator("A5", "triangle").connect(trem); o.volume.value = -30; o.start(); parts.push(o, trem); break; }
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
    const lp = new Tone.Filter({ type: "lowpass", frequency: AMBIENCE_CEILING_HZ }).connect(out);
    const f = new Tone.Filter({ type: "highpass", frequency: freq, Q: 1 }).connect(lp);
    n.connect(f); n.triggerAttackRelease(0.02, at);
    this.disposeLater(n, 0.6); this.disposeLater(f, 0.7); this.disposeLater(lp, 0.8);
  }
  private ambBeepInto(out: Tone.Gain, at: number, freq: number, dur = 0.12): void {
    const s = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.01, decay: dur, sustain: 0, release: 0.05 }, volume: -32 }).connect(out);
    s.triggerAttackRelease(freq, dur, at);
    this.disposeLater(s, dur + 0.6);
  }

  /**
   * Master volume (0..1), ramped — used by mute and by the fader. Never an
   * abrupt cut. No cancelScheduledValues: a fader drag calls this ~100 times a
   * second and cancelling each in-flight ramp snapped the gain back to its last
   * anchor every step (a zipper). linearRampTo re-anchors on its own.
   */
  setVolume(v: number, fade = 0.12): void {
    if (!this.started) return;
    this.master.gain.linearRampTo(v, fade, Tone.now());
  }

  /** Fade out fully, then stop transport + free nodes. Only on teardown. */
  async dispose(): Promise<void> {
    if (!this.started) return;
    // setVolume/swellWarmth both bail once this flips, so the fade below has to
    // be driven off the raw param rather than through them.
    this.started = false;
    if (this.swellTimer !== null) { clearTimeout(this.swellTimer); this.swellTimer = null; }
    try {
      this.master.gain.linearRampTo(0, 0.4, Tone.now());
      try { this.currentAmb?.out.gain.linearRampTo(0, 0.3, Tone.now()); } catch {}
      await new Promise((r) => setTimeout(r, 450));
      // Only stop the Transport if a newer engine hasn't taken it over while we
      // were fading — otherwise this teardown silences the engine that replaced it.
      if (transportOwner === this) {
        transportOwner = null;
        Tone.getTransport().stop();
        // Same ownership question, same answer: a newer engine has already
        // redefined the probe, and removing it here would leave the QA journey
        // reporting "no engine" while one is playing.
        if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
          delete (window as { __lpAudio?: unknown }).__lpAudio;
        }
      }
      // Cancel every pending one-shot disposal and run it now. The graph is
      // going away regardless, and the master gain reached zero 450ms ago, so
      // there is nothing left for these voices to ring into.
      this.pendingDisposals.forEach((node, handle) => {
        clearTimeout(handle);
        try { node.dispose(); } catch {}
      });
      this.pendingDisposals.clear();
      this.loops.forEach((l) => { try { l.dispose(); } catch {} });
      try { this.currentAmb?.dispose(); } catch {}
      this.currentAmb = null;
      [
        this.brass, this.keys, this.leadA, this.leadB, this.sub, this.marchA, this.marchB,
        this.snareNoise, this.snareBody, this.tick, this.stampThock, this.ding,
        this.tensionA, this.tensionB, this.airNoise, this.counter,
        this.zipNoise, this.zipGain, this.zipFilter,
      ].forEach((n) => { try { n.dispose(); } catch {} });
      // filters, delay, drive, tremolo, LFO — the things the voices run through
      this.musicNodes.forEach((n) => { try { n.dispose(); } catch {} });
      this.musicNodes = [];
      this.pings.forEach((p) => { try { p.dispose(); } catch {} });
      this.pings = [];
      Object.values(this.stems).forEach((g) => { try { g.dispose(); } catch {} });
      this.musicBus.dispose(); this.accentBus.dispose(); this.sfxBus.dispose(); this.ambBus.dispose(); this.master.dispose();
    } catch {}
  }
}
