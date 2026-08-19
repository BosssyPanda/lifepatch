"use client";

import { MuteButton } from "@/components/cinematic/Controls";
import { useAudio } from "@/hooks/useAudio";

/**
 * The sound control for every screen that is NOT a run and NOT a ceremony.
 *
 * The score plays on the landing, the mode select, both setups, the auth gate and
 * both end reports, and none of them carried a control — a returning visitor is
 * promoted straight past the Gate (`sessionStorage.lp_introSeen`) and arrives at the
 * title with music and no way to stop it. The run screens have `HudRail`'s SOUND /
 * VOL cells and the ceremonies have `MuteButton`; this is the same `MuteButton`,
 * wired to the one audio state (`hooks/useAudio` owns `muted`/`volume` and persists
 * them under `lp_muted` / `lp_volume` — there is no second mute anywhere).
 *
 * It renders IN FLOW, right-aligned at the top of the screen, rather than floating.
 * That is a measured decision, not a stylistic one: a fixed corner control was probed
 * against every screen at eleven scroll offsets on both viewports, and while it is
 * clean on the short centred screens it covers real content on the two long ones —
 * 15,498px² of controls at top-left on the landing (the position the old floating
 * INTRO chip used), and up to 87% of a figure at bottom-right on a 390px column. In
 * flow it covers nothing, anywhere, and every one of these screens is entered at
 * scroll 0, which is exactly where a player reaches for the mute.
 */
export function SoundCell({ className = "" }: { className?: string }) {
  const audio = useAudio();
  return (
    <div className={`flex justify-end ${className}`}>
      <MuteButton muted={audio.muted} onToggle={() => audio.setMuted(!audio.muted)} />
    </div>
  );
}
