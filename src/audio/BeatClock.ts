import type { TimeSignature } from "./audioTypes";

/**
 * Pure musical-timing math. Decoupled from any audio engine: pass a
 * transport time (seconds) to the helpers (e.g. Tone.now() / AudioContext.currentTime).
 */
export class BeatClock {
  readonly bpm: number;
  readonly beatsPerBar: number;
  readonly secondsPerBeat: number;
  readonly secondsPerBar: number;
  /** transport time (sec) of bar 1, beat 1 */
  startTime: number;

  constructor(bpm: number, timeSignature: TimeSignature = "4/4", startTime = 0) {
    this.bpm = bpm;
    this.beatsPerBar = Number(timeSignature.split("/")[0]) || 4;
    this.secondsPerBeat = 60 / bpm;
    this.secondsPerBar = this.secondsPerBeat * this.beatsPerBar;
    this.startTime = startTime;
  }

  /** total elapsed beats at transport time `now`. */
  beatsElapsed(now: number): number {
    return Math.max(0, (now - this.startTime) / this.secondsPerBeat);
  }

  /** 1-based current beat within the bar. */
  currentBeat(now: number): number {
    return Math.floor(this.beatsElapsed(now)) % this.beatsPerBar + 1;
  }

  /** 1-based current bar. */
  currentBar(now: number): number {
    return Math.floor(this.beatsElapsed(now) / this.beatsPerBar) + 1;
  }

  /** transport time of the next beat boundary at/after `now`. */
  getNextBeatTime(now: number): number {
    const n = Math.ceil((now - this.startTime) / this.secondsPerBeat);
    return this.startTime + n * this.secondsPerBeat;
  }

  /** transport time of the next bar boundary at/after `now`. */
  getNextBarTime(now: number): number {
    const n = Math.ceil((now - this.startTime) / this.secondsPerBar);
    return this.startTime + n * this.secondsPerBar;
  }

  /** transport time of bar `bar` (1-based), beat `beat` (1-based). */
  timeOf(bar: number, beat = 1): number {
    return this.startTime + ((bar - 1) * this.beatsPerBar + (beat - 1)) * this.secondsPerBeat;
  }
}
