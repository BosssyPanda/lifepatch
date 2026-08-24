/**
 * Browser-side graph builder for the offline preview renderer.
 *
 * Injected into the render page by `render-previews.mjs` and called once per
 * cue. Everything here is WIRING — which Tone node carries which array — and
 * nothing here is MUSIC: every pitch, pattern, gain and instrument setting
 * arrives in `score`, straight from `src/audio/score.ts`.
 *
 * The one rule that matters in this file: **every node is constructed inside
 * the `Tone.Offline` callback.** A Tone node binds to whichever context is
 * current when it is constructed, so a node built outside the callback belongs
 * to the live (silent, non-rendering) context and contributes nothing — with no
 * error to tell you. That is the classic cause of a mysteriously silent render.
 */
/* global Tone */

(function () {
  /**
   * Build the whole score into `bus`, with each stem's gain preset from
   * `gains`, and return nothing — the caller starts the transport.
   */
  function buildScore(bus, score, gains, cycles) {
    const V = score.VOICES;
    const G = score.GRIDS;

    // Each stem is a gain node the phase mix sets, exactly as in the engine.
    const stems = {};
    for (const id of Object.keys(gains)) stems[id] = new Tone.Gain(gains[id]).connect(bus);

    // --- brass: PolySynth of MonoSynths, because the filter ENVELOPE has to be
    // per voice. That sweep (380 -> 1600 Hz in 50ms, falling back over 350ms) is
    // the "bwah" that separates a brass section leaning into a chord from a pad.
    const brass = new Tone.PolySynth(Tone.MonoSynth, {
      volume: V.brass.volume,
      oscillator: V.brass.oscillator,
      envelope: V.brass.envelope,
      filter: { type: V.brass.filter.type, Q: V.brass.filter.Q, rolloff: -12 },
      filterEnvelope: {
        attack: V.brass.filter.envAttack,
        decay: V.brass.filter.envDecay,
        sustain: 0.45,
        release: 0.6,
        baseFrequency: V.brass.filter.base,
        // octaves so that base * 2^octaves lands on the specified peak
        octaves: Math.log2(V.brass.filter.peak / V.brass.filter.base),
        exponent: 2,
      },
    }).connect(stems.brass);
    brass.maxPolyphony = 16;

    // --- keys: FM upright, hammer-then-decay
    const keys = new Tone.PolySynth(Tone.FMSynth, { ...V.keys }).connect(stems.keys);
    keys.maxPolyphony = 12;

    // --- lead: two detuned oscillators -> drive -> tempo-synced delay.
    // Drive sits BEFORE the delay so the echoes repeat an already-shaped note
    // rather than re-distorting every tail.
    // DC blocker. The lead's A voice is a pulse at 35% duty, and a pulse whose
    // duty is not 50% has a non-zero mean by construction — measured here as
    // +0.0225 DC on the title render, tracking the lead's gain exactly. DC is
    // inaudible on its own but it eats headroom on the side it is offset
    // toward, so the anthem clipped earlier than its level suggested. A
    // one-pole high-pass well below the lowest lead note (D4 = 293 Hz) removes
    // it and touches nothing anyone can hear.
    const leadDC = new Tone.Filter({ type: "highpass", frequency: 25, rolloff: -12 })
      .connect(stems.lead);
    const leadDelay = new Tone.FeedbackDelay({
      delayTime: V.lead.delay.time, feedback: V.lead.delay.feedback, wet: V.lead.delay.wet,
    }).connect(leadDC);
    const leadDrive = new Tone.Distortion({ distortion: V.lead.drive, oversample: "2x" }).connect(leadDelay);
    const leadA = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: V.lead.a.type, width: V.lead.a.width },
      envelope: V.lead.envelope, volume: V.lead.volume,
    }).connect(leadDrive);
    const leadB = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: V.lead.b.type },
      envelope: V.lead.envelope, volume: V.lead.volume - 4, detune: V.lead.b.detune,
    }).connect(leadDrive);
    leadA.maxPolyphony = 8; leadB.maxPolyphony = 8;

    // --- bass: sine sub for the weight + a march "oom" for phone speakers
    const sub = new Tone.Synth({ ...V.subBass }).connect(stems.bass);
    const marchA = new Tone.Synth({
      oscillator: { type: V.marchBass.a.type }, envelope: V.marchBass.envelope,
      volume: V.marchBass.volume,
    }).connect(stems.bass);
    const marchB = new Tone.Synth({
      oscillator: { type: V.marchBass.b.type }, envelope: V.marchBass.envelope,
      volume: V.marchBass.volume - 8,
    }).connect(stems.bass);

    // --- snare: noise crack + tuned body, high-passed to leave the low end alone
    const snareHP = new Tone.Filter(V.snare.highpass, "highpass").connect(stems.snare);
    const snareNoise = new Tone.NoiseSynth({
      noise: { type: V.snare.noise.type },
      envelope: { attack: 0.001, decay: V.snare.noise.decay, sustain: 0 },
      volume: V.snare.noise.volume,
    }).connect(snareHP);
    const snareBody = new Tone.Synth({
      oscillator: { type: V.snare.body.type },
      envelope: { attack: 0.001, decay: V.snare.body.decay, sustain: 0 },
      volume: V.snare.body.volume,
    }).connect(snareHP);

    // --- ticks: typewriter clacks, the 4-bar stamp, the carriage-return bell
    const tickHP = new Tone.Filter(V.tick.highpass, "highpass").connect(stems.ticks);
    const tick = new Tone.NoiseSynth({
      noise: { type: V.tick.noise.type },
      envelope: { attack: 0.001, decay: V.tick.decay, sustain: 0 },
      volume: V.tick.volume,
    }).connect(tickHP);
    const stampThock = new Tone.MembraneSynth({
      pitchDecay: V.stampThock.pitchDecay, octaves: V.stampThock.octaves,
      envelope: { attack: 0.001, decay: V.stampThock.decay, sustain: 0 },
      volume: V.stampThock.volume,
    }).connect(stems.ticks);
    const ding = new Tone.Synth({
      oscillator: V.carriageDing.oscillator,
      envelope: { attack: 0.002, decay: V.carriageDing.decay, sustain: 0 },
      volume: V.carriageDing.volume,
    }).connect(stems.ticks);

    // --- tension: two saws a minor second apart under a slow filter LFO.
    // min/max on the LFO fully define the cutoff (connecting a signal overrides
    // the filter's own frequency value), so the sweep is expressed as a range.
    const tensionFilter = new Tone.Filter(V.tension.filter.frequency, V.tension.filter.type).connect(stems.tension);
    const tensionLfo = new Tone.LFO({
      frequency: V.tension.lfo.rate,
      min: V.tension.filter.frequency - V.tension.lfo.depth,
      max: V.tension.filter.frequency + V.tension.lfo.depth,
      type: "sine",
    });
    tensionLfo.connect(tensionFilter.frequency);
    tensionLfo.start(0);
    const tensionA = new Tone.Oscillator(V.tension.a.note, V.tension.a.type).connect(tensionFilter);
    const tensionB = new Tone.Oscillator(V.tension.b.note, V.tension.b.type).connect(tensionFilter);
    tensionA.volume.value = V.tension.a.volume;
    tensionB.volume.value = V.tension.b.volume;
    tensionA.start(0); tensionB.start(0);

    // --- air: the always-on room. Why silence sounds like a room and not a
    // dropped audio context.
    const airFilter = new Tone.Filter({
      type: V.air.filter.type, frequency: V.air.filter.frequency, Q: V.air.filter.Q,
    }).connect(stems.air);
    const air = new Tone.Noise({ type: V.air.noise.type, volume: V.air.volume }).connect(airFilter);
    air.start(0);

    // --- counter: the countermelody breathing through a slow tremolo
    const counterTrem = new Tone.Tremolo(V.counter.tremolo.rate, V.counter.tremolo.depth)
      .connect(stems.counter);
    counterTrem.start(0);
    const counter = new Tone.Synth({
      oscillator: V.counter.oscillator,
      envelope: { attack: 0.6, decay: 0.4, sustain: 0.8, release: 1.4 },
      volume: V.counter.volume,
    }).connect(counterTrem);

    // -----------------------------------------------------------------------
    // Sequences. Every callback forwards its `time` argument, which is what
    // keeps scheduling sample-accurate rather than block-quantised.
    // -----------------------------------------------------------------------
    let seg = 0;
    new Tone.Loop((time) => {
      const chord = score.CHORDS[seg];
      brass.triggerAttackRelease(chord, "2m", time, 0.8);
      sub.triggerAttackRelease(score.ROOTS[seg], "2m", time, 0.9);
      counter.triggerAttackRelease(score.COUNTER_LINE[seg], score.COUNTER_NOTE_VALUE, time, 0.7);
      seg = (seg + 1) % score.CHORDS.length;
    }, G.harmony.subdivision).start(0);

    new Tone.Sequence((time, note) => {
      leadA.triggerAttackRelease(note, "8n", time, 0.85);
      leadB.triggerAttackRelease(note, "8n", time, 0.6);
    }, score.LEAD_THEME, G.lead.subdivision).start(0);

    new Tone.Sequence((time, note) => {
      keys.triggerAttackRelease(note, "8n", time, 0.7);
    }, score.KEYS_FIGURES, G.keys.subdivision).start(0);

    new Tone.Sequence((time, note) => {
      marchA.triggerAttackRelease(note, "4n", time, 0.85);
      marchB.triggerAttackRelease(note, "4n", time, 0.5);
    }, score.BASS_LINE, G.bass.subdivision).start(0);

    // Velocities, not pitches: a 0 is a rest, and the ghost notes are what make
    // the pattern a march rather than a metronome.
    new Tone.Sequence((time, v) => {
      if (!v) return;
      snareNoise.triggerAttackRelease(V.snare.noise.decay, time, v);
      snareBody.triggerAttackRelease(V.snare.body.frequency, V.snare.body.decay, time, v * 0.8);
    }, score.SNARE_PATTERN, G.snare.subdivision).start(0);

    new Tone.Sequence((time, v) => {
      if (!v) return;
      tick.triggerAttackRelease(V.tick.decay, time, v);
    }, score.TICKS_PATTERN, G.ticks.subdivision).start(0);

    // The carriage return, scheduled entirely up front.
    //
    // Note what is NOT happening here: no node is constructed inside a
    // scheduled callback. `Tone.Offline` restores the previous audio context
    // once its setup callback returns, and the transport's callbacks then fire
    // during render() — so a node built in one of them is created against the
    // LIVE context and throws "cannot connect to an AudioNode belonging to a
    // different audio context". Everything is built once, and each occurrence
    // is a parameter automation on an already-connected graph.
    const cr = score.CARRIAGE_RETURN;
    const zipBp = new Tone.Filter({ type: "bandpass", frequency: cr.zip.fromHz, Q: 3 }).connect(stems.ticks);
    const zipGain = new Tone.Gain(0).connect(zipBp);
    const zipNoise = new Tone.Noise("white").connect(zipGain);
    zipNoise.start(0);
    const zipPeak = Math.pow(10, cr.zip.volume / 20) * 4;
    const crAt = cr.bar * score.SECONDS_PER_BAR + cr.beat * score.SECONDS_PER_BEAT;
    for (let c = 0; c < cycles; c++) {
      const t = c * score.CYCLE_SECONDS + crAt;
      ding.triggerAttackRelease(cr.ding, "8n", t, 0.7);
      zipBp.frequency.setValueAtTime(cr.zip.fromHz, t);
      zipBp.frequency.exponentialRampToValueAtTime(cr.zip.toHz, t + cr.zip.durationSec);
      zipGain.gain.setValueAtTime(0, t);
      zipGain.gain.linearRampToValueAtTime(zipPeak, t + cr.zip.durationSec * 0.6);
      zipGain.gain.linearRampToValueAtTime(0, t + cr.zip.durationSec);
    }

    // Same reason: the 4-bar stamps are absolute-time triggers on one voice
    // rather than a Loop that would have to fire during render.
    for (let c = 0; c < cycles; c++) {
      for (const bar of score.TICK_STAMP_BARS) {
        const t = c * score.CYCLE_SECONDS + bar * score.SECONDS_PER_BAR;
        stampThock.triggerAttackRelease(V.stampThock.note, "8n", t, 0.9);
      }
    }
  }

  /** One accent, built from its layer list. Mirrors the engine's `fireAccent`. */
  function buildStinger(bus, score, id, at) {
    const spec = score.STINGERS[id];
    const T = score.STINGER_TIMBRES;
    // `volume` overrides the timbre's own level. It must be honoured for every
    // layer kind: a `pluck`/`arp` layer that silently ignored its own volume
    // made those fields dead data, and tuning them changed neither this
    // preview nor the game — which is exactly the kind of divergence that
    // turns a preview into a lie.
    const voice = (timbre, volume) => {
      const t = T[timbre];
      const v = timbre === "keysPluck"
        ? new Tone.PolySynth(Tone.FMSynth, { ...t }).connect(bus)
        : new Tone.PolySynth(Tone.Synth, { oscillator: t.oscillator, envelope: t.envelope, volume: t.volume }).connect(bus);
      if (volume !== undefined) v.volume.value = volume;
      return v;
    };
    for (const layer of spec.layers) {
      const t0 = at + (layer.atSec ?? 0);
      if (layer.kind === "pluck") {
        const v = voice(layer.timbre, layer.volume);
        v.triggerAttackRelease(layer.notes, layer.duration, t0, 0.9);
        if (layer.octaveDoubleVolume !== undefined) {
          const d = voice(layer.timbre, layer.octaveDoubleVolume);
          d.triggerAttackRelease(layer.notes.map(down), layer.duration, t0, 0.8);
        }
      } else if (layer.kind === "arp") {
        const v = voice(layer.timbre, layer.volume);
        layer.notes.forEach((n, i) => v.triggerAttackRelease(n, layer.duration, t0 + i * layer.stepSec, 0.9));
        if (layer.octaveDoubleVolume !== undefined) {
          const d = voice(layer.timbre, layer.octaveDoubleVolume);
          layer.notes.forEach((n, i) => d.triggerAttackRelease(down(n), layer.duration, t0 + i * layer.stepSec, 0.8));
        }
      } else if (layer.kind === "membrane") {
        const m = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 5, volume: layer.volume }).connect(bus);
        m.triggerAttackRelease(layer.note, layer.duration, t0);
      } else if (layer.kind === "ruff") {
        const hp = new Tone.Filter(400, "highpass").connect(bus);
        const s = new Tone.NoiseSynth({
          noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.07, sustain: 0 }, volume: layer.volume,
        }).connect(hp);
        layer.velocities.forEach((v, i) => s.triggerAttackRelease(0.07, t0 + i * layer.stepSec, v));
      } else if (layer.kind === "noise") {
        const f = new Tone.Filter(layer.highpassHz, "highpass").connect(bus);
        const n = new Tone.NoiseSynth({
          noise: { type: "white" },
          envelope: { attack: 0.002, decay: layer.durationSec, sustain: 0 }, volume: layer.volume,
        }).connect(f);
        n.triggerAttackRelease(layer.durationSec, t0);
      }
    }
  }

  /** Transpose a note name down one octave (e.g. "C#5" -> "C#4"). */
  function down(note) {
    const m = /^([A-G][#b]?)(\d)$/.exec(note);
    return m ? `${m[1]}${Math.max(0, +m[2] - 1)}` : note;
  }

  /**
   * The reveal chimes, so the retune can be auditioned alongside the score.
   *
   * Mirrors `AudioEngine.playSting` layer for layer, including which PRIMITIVE
   * each layer is built from — `blip()` allocates one Synth per note, so the
   * ascending `good` triad is three INDEPENDENT voices that overlap and sum
   * (each note rings 0.5s while the next arrives 60ms later). Rendering it on
   * one monophonic Synth instead produced a single stepping voice — a preview
   * that quietly disagreed with the game about the most-heard sting in it.
   */
  function buildSting(bus, score, tone, at) {
    const s = score.STING_TONES[tone];
    // `AudioEngine.blip()`: a fresh single-voice Synth per note, self-disposing.
    const blip = (freq, dur, when) => {
      const v = new Tone.Synth({ oscillator: { type: s.wave }, envelope: { attack: 0.004, decay: dur, sustain: 0, release: 0.05 }, volume: s.volume }).connect(bus);
      v.triggerAttackRelease(freq, dur, when);
    };
    if (tone === "good") {
      s.freqs.forEach((f, i) => blip(f, s.durationSec, at + i * s.stepSec));
    } else if (tone === "bad") {
      const p = new Tone.PolySynth(Tone.Synth, { oscillator: { type: s.wave }, envelope: { attack: 0.005, decay: s.durationSec, sustain: 0.1, release: 0.4 }, volume: s.volume }).connect(bus);
      p.triggerAttackRelease(s.notes, s.durationSec, at);
      // `AudioEngine.thock()`'s membrane, not a default one: octaves 4 (not 10)
      // and a 0.18s decay with no sustain tail are what make this a knock
      // rather than the long, high-swept boom the defaults produce.
      const m = new Tone.MembraneSynth({
        pitchDecay: 0.04, octaves: 4,
        envelope: { attack: 0.001, decay: 0.18, sustain: 0 },
        volume: s.thock.volume,
      }).connect(bus);
      m.triggerAttackRelease(s.thock.note, "16n", at);
    } else if (tone === "warning") {
      const p = new Tone.PolySynth(Tone.Synth, { oscillator: { type: s.wave }, envelope: { attack: 0.005, decay: s.durationSec, sustain: 0.1, release: 0.4 }, volume: s.volume }).connect(bus);
      p.triggerAttackRelease(s.notes, s.durationSec, at);
    } else {
      blip(s.freq, s.durationSec, at);
    }
  }

  window.renderCue = async function renderCue({ score, cue, gains, duration, sampleRate }) {
    const buffer = await Tone.Offline(({ transport }) => {
      transport.bpm.value = score.SCORE_BPM_REF;
      transport.timeSignature = score.BEATS_PER_BAR;

      // The engine's bus tree, reproduced: master 0.85, and under it musicBus
      // 1.0 for the stems, accentBus 0.9 for the accents, sfxBus 0.9 for the
      // stings. The 0.9 trims are not cosmetic — without them a stinger preview
      // is 0.9dB hotter than the same stinger in the game, which is exactly the
      // margin somebody is judging "is this too loud" against.
      const master = new Tone.Gain(0.85).toDestination();
      const bus = new Tone.Gain(1).connect(master); // musicBus

      if (cue.phase) {
        buildScore(bus, score, gains, cue.cycles ?? 1);
      } else if (cue.stinger) {
        // Accents fire against silence here so the sound under scrutiny is the
        // accent itself, not the accent plus a bed.
        buildStinger(new Tone.Gain(0.9).connect(master), score, cue.stinger, 0.25);
      } else if (cue.stings) {
        const sfxBus = new Tone.Gain(0.9).connect(master);
        cue.stings.forEach((t, i) => buildSting(sfxBus, score, t, 0.25 + i * 1.1));
      }
      transport.start(0);
    }, duration, 2, sampleRate);

    return {
      L: Array.from(buffer.getChannelData(0)),
      R: Array.from(buffer.getChannelData(1)),
    };
  };
})();
