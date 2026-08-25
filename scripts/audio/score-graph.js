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
   * Mirror of `segmentAtTicks` in src/audio/score.ts.
   *
   * It has to be duplicated rather than imported: `score` reaches this file
   * through `page.evaluate`, which structured-clones its argument, and
   * structured clone drops functions. Reading `score.segmentAtTicks` here would
   * be `undefined` at run time — data crosses that boundary, code does not.
   *
   * The duplication is guarded rather than trusted: `render-previews.mjs`
   * exercises this copy against the real one over a table of inputs, negative
   * ticks included, and refuses to render if they ever disagree.
   */
  function segmentAtTicks(ticks, ticksPerSegment, segments) {
    const raw = Math.floor(ticks / ticksPerSegment) % segments;
    return raw < 0 ? raw + segments : raw;
  }
  window.__segmentAtTicks = segmentAtTicks;

  /**
   * Build the whole score into `bus`, with each stem's gain preset from
   * `gains`, and return nothing — the caller starts the transport.
   */
  function buildScore(bus, score, gains, cycles) {
    const V = score.VOICES;
    const G = score.GRIDS;
    const VEL = score.VELOCITY;

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
      filter: { type: V.brass.filter.type, Q: V.brass.filter.Q, rolloff: V.brass.filter.rolloff },
      filterEnvelope: {
        attack: V.brass.filter.envAttack,
        decay: V.brass.filter.envDecay,
        sustain: V.brass.filter.envSustain,
        release: V.brass.filter.envRelease,
        baseFrequency: V.brass.filter.base,
        // octaves so that base * 2^octaves lands on the specified peak
        octaves: Math.log2(V.brass.filter.peak / V.brass.filter.base),
        exponent: V.brass.filter.envExponent,
      },
    }).connect(stems.brass);
    brass.maxPolyphony = score.POLYPHONY.brass;

    // --- keys: FM upright, hammer-then-decay
    const keys = new Tone.PolySynth(Tone.FMSynth, { ...V.keys }).connect(stems.keys);
    keys.maxPolyphony = score.POLYPHONY.keys;

    // --- lead: two detuned oscillators -> drive -> tempo-synced delay.
    // Drive sits BEFORE the delay so the echoes repeat an already-shaped note
    // rather than re-distorting every tail.
    // DC blocker — see `VOICES.lead.dcBlock` in score.ts for why the pulse
    // voice needs one.
    const leadDC = new Tone.Filter({
      type: "highpass", frequency: V.lead.dcBlock.hz, rolloff: V.lead.dcBlock.rolloff,
    }).connect(stems.lead);
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
      envelope: V.lead.envelope, volume: V.lead.volume - V.lead.b.under, detune: V.lead.b.detune,
    }).connect(leadDrive);
    leadA.maxPolyphony = score.POLYPHONY.lead;
    leadB.maxPolyphony = score.POLYPHONY.lead;

    // --- bass: sine sub for the weight + a march "oom" for phone speakers
    const bassHP = new Tone.Filter({
      type: "highpass", frequency: V.subBass.highpass.hz, rolloff: V.subBass.highpass.rolloff,
    }).connect(stems.bass);
    const sub = new Tone.Synth({
      oscillator: V.subBass.oscillator, envelope: V.subBass.envelope, volume: V.subBass.volume,
    }).connect(bassHP);
    const marchA = new Tone.Synth({
      oscillator: { type: V.marchBass.a.type }, envelope: V.marchBass.envelope,
      volume: V.marchBass.volume,
    }).connect(bassHP);
    const marchB = new Tone.Synth({
      oscillator: { type: V.marchBass.b.type }, envelope: V.marchBass.envelope,
      volume: V.marchBass.volume - V.marchBass.b.under,
    }).connect(bassHP);

    // --- snare: noise crack + tuned body, high-passed to leave the low end alone
    const snareHP = new Tone.Filter(V.snare.highpass, "highpass").connect(stems.snare);
    // ceiling on the crack alone; the body bypasses it. See VOICES.snare.
    const snareLP = new Tone.Filter(V.snare.noise.ceilingHz, "lowpass").connect(snareHP);
    const snareNoise = new Tone.NoiseSynth({
      noise: { type: V.snare.noise.type },
      envelope: { attack: V.snare.noise.attack, decay: V.snare.noise.decay, sustain: 0 },
      volume: V.snare.noise.volume,
    }).connect(snareLP);
    const snareBody = new Tone.Synth({
      oscillator: { type: V.snare.body.type },
      envelope: { attack: V.snare.body.attack, decay: V.snare.body.decay, sustain: 0 },
      volume: V.snare.body.volume,
    }).connect(snareHP);

    // --- ticks: typewriter clacks, the 4-bar stamp, the carriage-return bell
    // high-pass -> low-pass; the ceiling is what makes it a typewriter and not
    // a hiss. Mirrors AudioEngine exactly — see VOICES.tick.
    const tickLP = new Tone.Filter(V.tick.band.lowpassHz, "lowpass").connect(stems.ticks);
    const tickHP = new Tone.Filter(V.tick.band.highpassHz, "highpass").connect(tickLP);
    const tick = new Tone.NoiseSynth({
      noise: { type: V.tick.noise.type },
      envelope: { attack: V.tick.attack, decay: V.tick.decay, sustain: 0 },
      volume: V.tick.volume,
    }).connect(tickHP);
    const stampThock = new Tone.MembraneSynth({
      pitchDecay: V.stampThock.pitchDecay, octaves: V.stampThock.octaves,
      envelope: { attack: V.stampThock.attack, decay: V.stampThock.decay, sustain: 0 },
      volume: V.stampThock.volume,
    }).connect(stems.ticks);
    const ding = new Tone.Synth({
      oscillator: V.carriageDing.oscillator,
      envelope: { attack: V.carriageDing.attack, decay: V.carriageDing.decay, sustain: 0 },
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
      envelope: V.counter.envelope,
      volume: V.counter.volume,
    }).connect(counterTrem);

    // -----------------------------------------------------------------------
    // Sequences. Every callback forwards its `time` argument, which is what
    // keeps scheduling sample-accurate rather than block-quantised.
    // -----------------------------------------------------------------------
    // The segment index is derived from the transport, mirroring the engine.
    // Here a plain counter would give the same answer (an offline transport
    // always starts at 0), but the engine's cannot — so the renderer uses the
    // engine's logic rather than a simpler one that happens to agree today.
    const transport = Tone.getTransport();
    const ticksPerSegment = transport.PPQ * score.BEATS_PER_BAR * score.BARS_PER_SEGMENT;
    new Tone.Loop((time) => {
      const seg = segmentAtTicks(transport.getTicksAtTime(time), ticksPerSegment, score.CHORDS.length);
      brass.triggerAttackRelease(score.CHORDS[seg], "2m", time, VEL.brass);
      sub.triggerAttackRelease(score.ROOTS[seg], "2m", time, VEL.sub);
      counter.triggerAttackRelease(score.COUNTER_LINE[seg], score.COUNTER_NOTE_VALUE, time, VEL.counter);
    }, G.harmony.subdivision).start(0);

    new Tone.Sequence((time, note) => {
      leadA.triggerAttackRelease(note, "8n", time, VEL.leadA);
      leadB.triggerAttackRelease(note, "8n", time, VEL.leadB);
    }, score.LEAD_THEME, G.lead.subdivision).start(0);

    new Tone.Sequence((time, note) => {
      keys.triggerAttackRelease(note, "8n", time, VEL.keys);
    }, score.KEYS_FIGURES, G.keys.subdivision).start(0);

    new Tone.Sequence((time, note) => {
      marchA.triggerAttackRelease(note, "4n", time, VEL.marchA);
      marchB.triggerAttackRelease(note, "4n", time, VEL.marchB);
    }, score.BASS_LINE, G.bass.subdivision).start(0);

    // Velocities, not pitches: a 0 is a rest, and the ghost notes are what make
    // the pattern a march rather than a metronome.
    new Tone.Sequence((time, v) => {
      if (!v) return;
      snareNoise.triggerAttackRelease(V.snare.noise.decay, time, v);
      snareBody.triggerAttackRelease(V.snare.body.frequency, V.snare.body.decay, time, v * VEL.snareBodyScale);
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
    const zipBp = new Tone.Filter({ type: "bandpass", frequency: cr.zip.fromHz, Q: cr.zip.bandpassQ }).connect(stems.ticks);
    const zipGain = new Tone.Gain(0).connect(zipBp);
    const zipNoise = new Tone.Noise("white").connect(zipGain);
    zipNoise.start(0);
    const zipPeak = Math.pow(10, cr.zip.volume / 20) * cr.zip.peakScale;
    const crAt = cr.bar * score.SECONDS_PER_BAR + cr.beat * score.SECONDS_PER_BEAT;
    for (let c = 0; c < cycles; c++) {
      const t = c * score.CYCLE_SECONDS + crAt;
      ding.triggerAttackRelease(cr.ding, "8n", t, VEL.ding);
      zipBp.frequency.setValueAtTime(cr.zip.fromHz, t);
      zipBp.frequency.exponentialRampToValueAtTime(cr.zip.toHz, t + cr.zip.durationSec);
      zipGain.gain.setValueAtTime(0, t);
      zipGain.gain.linearRampToValueAtTime(zipPeak, t + cr.zip.durationSec * cr.zip.rampFraction);
      zipGain.gain.linearRampToValueAtTime(0, t + cr.zip.durationSec);
    }

    // Same reason: the 4-bar stamps are absolute-time triggers on one voice
    // rather than a Loop that would have to fire during render.
    for (let c = 0; c < cycles; c++) {
      for (const bar of score.TICK_STAMP_BARS) {
        const t = c * score.CYCLE_SECONDS + bar * score.SECONDS_PER_BAR;
        stampThock.triggerAttackRelease(V.stampThock.note, "8n", t, VEL.stamp);
      }
    }
  }

  /** One accent, built from its layer list. Mirrors the engine's `fireAccent`. */
  function buildStinger(bus, score, id, at) {
    const spec = score.STINGERS[id];
    const T = score.STINGER_TIMBRES;
    const VEL = score.VELOCITY;
    const P = score.STINGER_PRIMITIVES;
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
        v.triggerAttackRelease(layer.notes, layer.duration, t0, VEL.pluck);
        if (layer.octaveDoubleVolume !== undefined) {
          const d = voice(layer.timbre, layer.octaveDoubleVolume);
          d.triggerAttackRelease(layer.notes.map(down), layer.duration, t0, VEL.pluckOctaveDouble);
        }
      } else if (layer.kind === "arp") {
        const v = voice(layer.timbre, layer.volume);
        layer.notes.forEach((n, i) => v.triggerAttackRelease(n, layer.duration, t0 + i * layer.stepSec, VEL.pluck));
        if (layer.octaveDoubleVolume !== undefined) {
          const d = voice(layer.timbre, layer.octaveDoubleVolume);
          layer.notes.forEach((n, i) => d.triggerAttackRelease(down(n), layer.duration, t0 + i * layer.stepSec, VEL.pluckOctaveDouble));
        }
      } else if (layer.kind === "membrane") {
        const m = new Tone.MembraneSynth({ ...P.membrane, volume: layer.volume }).connect(bus);
        m.triggerAttackRelease(layer.note, layer.duration, t0);
      } else if (layer.kind === "ruff") {
        const rlp = new Tone.Filter(P.ruff.ceilingHz, "lowpass").connect(bus);
        const hp = new Tone.Filter(P.ruff.highpassHz, "highpass").connect(rlp);
        const s = new Tone.NoiseSynth({
          noise: { type: "white" },
          envelope: { attack: 0.001, decay: P.ruff.decaySec, sustain: 0 }, volume: layer.volume,
        }).connect(hp);
        layer.velocities.forEach((v, i) => s.triggerAttackRelease(P.ruff.decaySec, t0 + i * layer.stepSec, v));
      } else if (layer.kind === "noise") {
        // band, not a bare high-pass — the ceiling stops the impact reading
        // as a hiss burst. Mirrors AudioEngine; see STINGER_PRIMITIVES.noise.
        const lp = new Tone.Filter(P.noise.ceilingHz, "lowpass").connect(bus);
        const f = new Tone.Filter(layer.highpassHz, "highpass").connect(lp);
        const n = new Tone.NoiseSynth({
          noise: { type: "white" },
          envelope: { attack: P.noise.attack, decay: layer.durationSec, sustain: 0 }, volume: layer.volume,
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
    const P = score.SFX_PRIMITIVES;
    // `AudioEngine.blip()`: a fresh single-voice Synth per note, self-disposing.
    const blip = (freq, dur, when) => {
      const v = new Tone.Synth({
        oscillator: { type: s.wave },
        envelope: { attack: P.blip.attack, decay: dur, sustain: 0, release: P.blip.release },
        volume: s.volume,
      }).connect(bus);
      v.triggerAttackRelease(freq, dur, when);
    };
    // `AudioEngine.chordShot()`: one PolySynth, a short sustained tail.
    const chordShot = () => {
      const p = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: s.wave },
        envelope: { attack: P.chordShot.attack, decay: s.durationSec, sustain: P.chordShot.sustain, release: P.chordShot.release },
        volume: s.volume,
      }).connect(bus);
      p.triggerAttackRelease(s.notes, s.durationSec, at);
    };
    if (tone === "good") {
      s.freqs.forEach((f, i) => blip(f, s.durationSec, at + i * s.stepSec));
    } else if (tone === "bad") {
      chordShot();
      // `AudioEngine.thock()`'s membrane, not a default one: octaves 4 (not 10)
      // and a 0.18s decay with no sustain tail are what make this a knock
      // rather than the long, high-swept boom the defaults produce.
      const m = new Tone.MembraneSynth({
        pitchDecay: P.thock.pitchDecay, octaves: P.thock.octaves,
        envelope: { attack: P.thock.attack, decay: P.thock.decay, sustain: 0 },
        volume: s.thock.volume,
      }).connect(bus);
      m.triggerAttackRelease(s.thock.note, "16n", at);
    } else if (tone === "warning") {
      chordShot();
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
      const M = score.MIX;
      const master = new Tone.Gain(M.master).toDestination();
      const bus = new Tone.Gain(M.music).connect(master);

      if (cue.phase) {
        buildScore(bus, score, gains, cue.cycles ?? 1);
      } else if (cue.stinger) {
        // Accents fire against silence here so the sound under scrutiny is the
        // accent itself, not the accent plus a bed.
        buildStinger(new Tone.Gain(M.accent).connect(master), score, cue.stinger, 0.25);
      } else if (cue.stings) {
        const sfxBus = new Tone.Gain(M.sfx).connect(master);
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
