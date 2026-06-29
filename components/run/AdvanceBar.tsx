"use client";

import { ArrowDown, TrophyIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/NeonButton";
import { useAudio } from "@/hooks/useAudio";
import { allEventsResolved, type RunState } from "@/lib/runEngine";

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

  return (
    <div className="sticky bottom-0 z-30 border-t border-ink/12 bg-bg/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { audio.sfx("soft"); onQuit(); }} className="eyebrow text-ink-dim transition-colors hover:text-brick">
            End run
          </button>
          {canRetire && (
            <button type="button" onClick={() => { audio.sfx("chime"); onRetire(); }} className="flex items-center gap-1 eyebrow text-ink-dim transition-colors hover:text-accent">
              <TrophyIcon size={14} /> Retire
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {blocked && <span className="hidden font-serif text-xs italic text-ink-dim sm:inline">Make your life choice first</span>}
          <NeonButton variant="primary" size="md" onClick={() => { audio.sfx("page"); onAdvance(); }} disabled={blocked}>
            Advance the year <ArrowDown size={16} />
          </NeonButton>
        </div>
      </div>
    </div>
  );
}
