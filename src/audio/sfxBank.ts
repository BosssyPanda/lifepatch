"use client";

import { Howl, Howler } from "howler";

/**
 * Two things live in this file, and only one of them runs.
 *
 * 1. THE LIVE PART — the `SfxName` / `StingTone` / `AmbienceId` unions and their
 *    id arrays. These are the single source of truth for sound ids across the
 *    audio system (AudioEngine, useAudio, lib/audioMap) and are imported
 *    `import type`, so they cost nothing at runtime.
 *
 * 2. `SfxBank` — the OPTIONAL howler-backed file path, deliberately not wired up.
 *    The shipped game synthesizes every SFX and ambience bed in AudioEngine.ts
 *    (no files, no auth; /public/audio holds cue metadata only). This class is
 *    the drop-in for REAL recorded foley later: put .mp3s in /public/audio/sfx,
 *    instantiate it in useAudio, and file playback overrides the synth voices
 *    without touching a single caller. Nothing constructs it today.
 *
 * SfxBank is fail-soft: a missing/loading file simply produces no sound, and
 * ambience always CROSSFADES (never a hard cut). Recorded foley needs an
 * authorized audio provider (ElevenLabs / Replicate) — see
 * .claude/game-music-stack-audit.md.
 */

export type SfxName =
  | "paper" | "confirm" | "coins" | "cash" | "stamp"
  | "page" | "chime" | "soft" | "click" | "hover" | "modal" | "uitick"
  | "dice" | "diceLand"
  | "rankUp"; // v2: leaderboard self-placement flourish

export type StingTone = "good" | "bad" | "warning" | "neutral";

export type AmbienceId =
  | "amb_office" | "amb_room" | "amb_keys" | "amb_hospital"
  | "amb_coins" | "amb_feed" | "amb_unease" | "amb_shimmer" | "amb_hiss";

export const SFX_NAMES: SfxName[] = [
  "paper", "confirm", "coins", "cash", "stamp", "page", "chime", "soft", "click", "hover", "modal", "uitick", "dice", "diceLand", "rankUp",
];
export const STING_NAMES: string[] = ["sting_good", "sting_bad", "sting_warning", "sting_neutral"];
export const AMBIENCE_IDS: AmbienceId[] = [
  "amb_office", "amb_room", "amb_keys", "amb_hospital", "amb_coins", "amb_feed", "amb_unease", "amb_shimmer", "amb_hiss",
];

const DIR = "/audio/sfx/";
const ONESHOT_VOL: Partial<Record<SfxName, number>> = {
  hover: 0.18, click: 0.3, uitick: 0.22, paper: 0.5, coins: 0.5, cash: 0.5, page: 0.45,
};
const AMB_VOL = 0.32;
const AMB_FADE = 700; // ms

export class SfxBank {
  private cache = new Map<string, Howl>();
  private current: { id: AmbienceId; howl: Howl } | null = null;
  private enabled = false; // set true once a file load is attempted post-unlock
  /** Every one-shot timer this bank still owes — see `later()` and `dispose()`. */
  private pending = new Set<ReturnType<typeof setTimeout>>();

  /** Mark audio unlocked (after a user gesture); ambience may now start. */
  enable(): void {
    this.enabled = true;
  }

  private howl(file: string, opts: Partial<{ loop: boolean; volume: number }> = {}): Howl {
    let h = this.cache.get(file);
    if (!h) {
      h = new Howl({
        src: [`${DIR}${file}.mp3`],
        preload: true,
        loop: opts.loop ?? false,
        volume: opts.volume ?? 0.5,
        // onloaderror/onplayerror are intentionally swallowed — fail soft.
        onloaderror: () => {},
        onplayerror: () => {},
      });
      this.cache.set(file, h);
    }
    return h;
  }

  /** Fire a one-shot effect. */
  play(name: SfxName, volume?: number): void {
    try {
      const h = this.howl(name, { volume: volume ?? ONESHOT_VOL[name] ?? 0.45 });
      if (h.state() === "loaded" || h.state() === "loading") h.play();
    } catch {}
  }

  /** Reveal sting keyed to an outcome tone. */
  sting(tone: StingTone): void {
    try {
      this.howl(`sting_${tone}`, { volume: 0.5 }).play();
    } catch {}
  }

  /**
   * Crossfade the looping scenario ambience. Pass null to fade the current bed
   * out. Re-requesting the same id is a no-op (keeps it playing smoothly).
   */
  ambience(id: AmbienceId | null): void {
    if (!this.enabled) return;
    if (this.current?.id === id) return;

    // fade + stop the outgoing bed (never an abrupt stop)
    if (this.current) {
      const prev = this.current.howl;
      try {
        prev.fade(prev.volume() as number, 0, AMB_FADE);
        this.later(() => { try { prev.stop(); } catch {} }, AMB_FADE + 40);
      } catch {}
      this.current = null;
    }

    if (!id) return;

    try {
      const h = this.howl(id, { loop: true, volume: 0 });
      const begin = () => {
        try {
          h.volume(0);
          h.play();
          h.fade(0, AMB_VOL, AMB_FADE);
        } catch {}
      };
      if (h.state() === "loaded") begin();
      else h.once("load", begin);
      this.current = { id, howl: h };
    } catch {}
  }

  /** Global mute for all SFX/ambience (ramped by Howler internally is abrupt;
   * for the looping bed we additionally fade so nothing pops). */
  setMuted(muted: boolean): void {
    try {
      if (muted && this.current) {
        const h = this.current.howl;
        h.fade(h.volume() as number, 0, 200);
      } else if (!muted && this.current) {
        const h = this.current.howl;
        h.fade(0, AMB_VOL, 300);
      }
      Howler.mute(muted);
    } catch {}
  }

  /**
   * Run `fn` after `ms`, and keep the handle so `dispose()` can cancel it.
   *
   * `AudioEngine.disposeLater` treats this exact pattern as a contract — every
   * one-shot handle goes into `pendingDisposals` so teardown can cancel it — and
   * states why: a fire-and-forget timer left the disposed nodes reachable, so the
   * teardown did not actually finish until the last sound would have rung out.
   * The three timers in this file were the one place beside it that did not
   * follow the rule; each was `try`/`catch`ed, so the cost was three timers
   * surviving a route change and poking stopped handles, but a rule the file
   * next door states and this one ignores is a rule that decays.
   *
   * The handle removes itself on fire, so the set tracks only what is still owed.
   */
  private later(fn: () => void, ms: number): void {
    const handle = setTimeout(() => {
      this.pending.delete(handle);
      try { fn(); } catch {}
    }, ms);
    this.pending.add(handle);
  }

  /** Fade the bed out then unload everything. */
  dispose(): void {
    try {
      // Anything still owed is owed to a graph that is going away. The ambience
      // swap's pending `stop()` in particular is moot: the bed it was going to
      // stop is stopped below regardless.
      this.pending.forEach(clearTimeout);
      this.pending.clear();
      if (this.current) {
        const h = this.current.howl;
        h.fade(h.volume() as number, 0, 300);
        this.later(() => { try { h.stop(); } catch {} }, 340);
      }
      this.current = null;
      this.later(() => {
        this.cache.forEach((h) => { try { h.unload(); } catch {} });
        this.cache.clear();
      }, 400);
    } catch {}
  }
}
