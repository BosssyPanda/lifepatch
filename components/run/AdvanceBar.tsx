"use client";

import { useId } from "react";
import { ArrowDown, TrophyIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/LedgerButton";
import { ArmedLabel, useArmedAction } from "@/components/ui/useArmedAction";
import { useAudio } from "@/hooks/useAudio";
import { allEventsResolved, type RunState } from "@/lib/runEngine";

/** Expands a text button's hit box to 44px without changing how tall it looks. */
const HIT = "relative before:absolute before:inset-x-0 before:-inset-y-[14px] before:content-['']";

export function AdvanceBar({
  run,
  canRetire,
  onAdvance,
  onRetire,
  onQuit,
}: {
  run: RunState;
  canRetire: boolean;
  onAdvance: () => void;
  onRetire: () => void;
  onQuit: () => void;
}) {
  const audio = useAudio();
  const blocked = !allEventsResolved(run);
  const hintId = useId();

  // One tap used to end the run outright and cut straight to the recap film.
  const endRun = useArmedAction({
    label: "End run",
    armedLabel: "Tap again to end",
    onArm: () => audio.sfx("uitick"),
    onConfirm: () => {
      audio.sfx("soft");
      onQuit();
    },
  });

  return (
    <div className="sticky bottom-0 z-30 border-t border-hairline bg-bg">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={endRun.onClick}
            onBlur={endRun.onBlur}
            className={`${HIT} eyebrow transition-colors ${endRun.armed ? "text-loss" : "text-ink-dim hover:text-loss"}`}
          >
            <ArmedLabel armed={endRun.armed}>{endRun.label}</ArmedLabel>
          </button>
          {canRetire && (
            <button
              type="button"
              onClick={() => { audio.sfx("chime"); onRetire(); }}
              className={`${HIT} flex items-center gap-1 eyebrow text-ink-dim transition-colors hover:text-ink`}
            >
              <TrophyIcon size={14} /> Retire
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* The reason the primary button is dead used to be `hidden sm:inline` — on a
              phone the player met a greyed-out CTA with no explanation at all. */}
          {blocked && (
            <span
              id={hintId}
              className="max-w-[8.5rem] text-right font-body text-[0.7rem] italic leading-tight text-ink-dim sm:max-w-none sm:text-xs"
            >
              Make your life choice first
            </span>
          )}
          <NeonButton
            variant="primary"
            size="md"
            onClick={() => { audio.sfx("page"); onAdvance(); }}
            disabled={blocked}
            aria-describedby={blocked ? hintId : undefined}
          >
            Advance the year <ArrowDown size={16} />
          </NeonButton>
        </div>
      </div>
    </div>
  );
}
