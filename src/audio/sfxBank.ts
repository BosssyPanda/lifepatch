"use client";

import { Howl, Howler } from "howler";

/**
 * OPTIONAL file-based SFX override. The shipped game synthesizes all SFX +
 * ambience in AudioEngine.ts (no auth, no files). This bank exists as a
 * drop-in for REAL recorded foley later: once .mp3s are placed in
 * /public/audio/sfx and this bank is wired into useAudio, file playback can
 * override the synth voices without touching any callers. The shared type
 * unions (SfxName / StingTone / AmbienceId) below are the single source of
 * truth used across the audio system.
 *
 * Fail-soft: a missing/loading file simply produces no sound. Ambience always
 * CROSSFADES (never a hard cut). Realistic effects need an authorized audio
 * provider (ElevenLabs / Replicate / belt) — see .claude/game-music-stack-audit.md.
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
        setTimeout(() => { try { prev.stop(); } catch {} }, AMB_FADE + 40);
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

  /** Fade the bed out then unload everything. */
  dispose(): void {
    try {
      if (this.current) {
        const h = this.current.howl;
        h.fade(h.volume() as number, 0, 300);
        setTimeout(() => { try { h.stop(); } catch {} }, 340);
      }
      this.current = null;
      setTimeout(() => {
        this.cache.forEach((h) => { try { h.unload(); } catch {} });
        this.cache.clear();
      }, 400);
    } catch {}
  }
}
