"use client";

import { useEffect, useId, useRef } from "react";
import { ArrowDown, CheckIcon, TrophyIcon } from "@/components/icons";
import { YearTimer } from "@/components/mp/YearTimer";
import { NeonButton } from "@/components/ui/LedgerButton";
import { ArmedLabel, useArmedAction } from "@/components/ui/useArmedAction";
import { useAudio } from "@/hooks/useAudio";
import { useMatchCtx } from "@/hooks/useMatch";
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
  // null for a solo run: the bar below is then exactly what it has always been.
  const match = useMatchCtx();
  const blocked = !allEventsResolved(run);
  const hintId = useId();

  // In a match this button no longer moves the clock — the room does. It locks
  // the year in, and the year turns when everyone has locked in or the countdown
  // runs out, whichever comes first.
  const locked = match ? (match.peers[match.selfId]?.ready ?? false) : false;
  const hint = blocked
    ? "Make your life choice first"
    : locked
      ? "Waiting for the year to turn"
      : null;

  /**
   * Publish this bar's real height as `--toast-inset` so the floating concept toast
   * can sit ABOVE it instead of on top of it. Measured rather than hardcoded: the
   * bar is 63px on desktop and 73px on a phone (the disabled-CTA hint wraps), and it
   * changes again when the hint appears or goes.
   */
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--toast-inset", `${Math.round(el.getBoundingClientRect().height)}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--toast-inset");
    };
  }, []);

  // One tap used to end the run outright and cut straight to the recap film. In a
  // match it is "Drop out": the life still ends here, the player still goes to the
  // standings, and the room plays on without them.
  const endRun = useArmedAction({
    label: match ? "Drop out" : "End run",
    armedLabel: match ? "Tap again to drop out" : "Tap again to end",
    onArm: () => audio.sfx("uitick"),
    onConfirm: () => {
      audio.sfx("soft");
      onQuit();
    },
  });

  return (
    <div ref={barRef} className="sticky bottom-0 z-30 border-t border-hairline bg-bg">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={endRun.onClick}
            onBlur={endRun.onBlur}
            className={`${HIT} eyebrow transition-colors ${endRun.armed ? "text-loss" : "text-ink-dim hover:text-loss"}`}
          >
            <ArmedLabel>{endRun.label}</ArmedLabel>
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
          {/* The room's clock, where the decisions are. The band at the top of the run
              scrolls away with the page, and a lock-in with four seconds left is taken
              down here — so the countdown comes along, as one line beside the button. */}
          {match && <YearTimer compact />}
          {/* The reason the primary button is dead used to be `hidden sm:inline` — on a
              phone the player met a greyed-out CTA with no explanation at all. The
              same slot carries the match's "you're locked in, sit tight" line, for
              exactly the same reason. */}
          {hint && (
            <span
              id={hintId}
              className="voice max-w-[8.5rem] text-right text-[0.7rem] leading-tight text-ink-dim sm:max-w-none sm:text-xs"
            >
              {hint}
            </span>
          )}
          <NeonButton
            variant="primary"
            size="md"
            onClick={
              match
                ? () => { audio.sfx("stamp"); match.markReady(); }
                : () => { audio.sfx("page"); onAdvance(); }
            }
            disabled={blocked || locked}
            aria-describedby={hint ? hintId : undefined}
          >
            {match ? (
              locked ? <>Locked in <CheckIcon size={16} /></> : <>Lock in the year <CheckIcon size={16} /></>
            ) : (
              <>Advance the year <ArrowDown size={16} /></>
            )}
          </NeonButton>
        </div>
      </div>
    </div>
  );
}
