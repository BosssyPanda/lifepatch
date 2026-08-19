"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { CheckIcon, LockIcon } from "@/components/icons";
import { SectionMark } from "@/components/ui/SectionMark";
import { useAudio } from "@/hooks/useAudio";
import { useConceptLearn } from "@/hooks/useConceptLearn";
import { stingForTone } from "@/lib/audioMap";
import { conceptsForText } from "@/lib/concepts";
import { KID_COST } from "@/lib/economy";
import { currency } from "@/lib/format";
import type { LifeChoice, LifeEffect, LifeEvent } from "@/lib/lifeEvents";
import { netWorth, type RunState } from "@/lib/runEngine";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { DUR, EASE } from "@/src/motion/tokens";
import { ConsequenceBeat } from "./ConsequenceBeat";
import { beatFor } from "./consequenceBeats";

// LEDGER: outcomes read gain/loss; neutral tones stay ink-secondary.
const TONE_HEX: Record<string, string> = {
  good: "var(--color-gain)",
  bad: "var(--color-loss)",
  warning: "var(--color-secondary)",
  neutral: "var(--color-secondary)",
};

function chips(e: LifeEffect): { text: string; positive: boolean }[] {
  const out: { text: string; positive: boolean }[] = [];
  if (e.cash) out.push({ text: `${e.cash > 0 ? "+" : "−"}${currency(Math.abs(e.cash))}`, positive: e.cash > 0 });
  if (e.debt) out.push({ text: `${e.debt > 0 ? "+" : "−"}${currency(Math.abs(e.debt))} debt`, positive: e.debt < 0 });
  if (e.salaryTo !== undefined) out.push({ text: `salary → ${currency(e.salaryTo)}`, positive: e.salaryTo > 0 });
  if (e.salaryPct) out.push({ text: `${e.salaryPct > 0 ? "+" : ""}${e.salaryPct}% pay`, positive: e.salaryPct > 0 });
  // A dependent is a recurring cost, so it earns a money chip like any other.
  if (e.kids) out.push({ text: `${e.kids > 0 ? "+" : "−"}${Math.abs(e.kids)} kid · ${currency(KID_COST)}/yr`, positive: e.kids < 0 });
  if (e.health) out.push({ text: `${e.health > 0 ? "+" : "−"}${Math.abs(e.health)} health`, positive: e.health > 0 });
  if (e.happiness) out.push({ text: `${e.happiness > 0 ? "+" : "−"}${Math.abs(e.happiness)} mood`, positive: e.happiness > 0 });
  return out;
}

export function LifeEventCard({
  event,
  plate = "01",
  chosen,
  onChoose,
  runState,
}: {
  event: LifeEvent & { choices: LifeChoice[] };
  /** zero-padded folio within the current year — "01", "02", … */
  plate?: string;
  chosen?: string; // "choiceId|outcomeIdx"
  onChoose: (eventId: string, choice: LifeChoice) => void;
  runState?: RunState;
}) {
  const audio = useAudio();
  const { learn } = useConceptLearn();
  const { reduced } = useMotionCtx();
  const [chosenId, idxStr] = chosen ? chosen.split("|") : [undefined, undefined];
  const answered = Boolean(chosenId);
  const chosenChoice = event.choices.find((c) => c.id === chosenId);
  const outcome = chosenChoice?.outcomes[Number(idxStr)] ?? chosenChoice?.outcomes[0];

  // A flagship consequence beat plays for tagged events (Phase 2), but only on a
  // fresh answer — never when revisiting a card that was already answered.
  const beat = beatFor(event.id);
  const answeredAtMount = useRef(answered);
  const [showBeat, setShowBeat] = useState(false);
  /** Where a keyboard player lands when the beat closes — see the beat's onDone. */
  const outcomeRef = useRef<HTMLDivElement>(null);
  /**
   * Net worth captured the instant before the choice is applied, so the beat can
   * print a true before → after pair. Reconstructing it from the outcome's raw
   * effect can't work: the engine floors debt at zero and swaps cash for home
   * equity, so the arithmetic doesn't close.
   */
  const nwBefore = useRef<number | null>(null);

  // reveal sting once, keyed to the outcome's tone
  const stungRef = useRef(false);
  useEffect(() => {
    if (answered && outcome && !stungRef.current) {
      stungRef.current = true;
      const fresh = !answeredAtMount.current;
      if (fresh && beat && runState) {
        // the full-screen beat owns the reveal audio for these events
        setShowBeat(true);
      } else {
        audio.sting(stingForTone(outcome.tone));
      }
      // The teaching moment: derive concepts from the lesson; a "good" outcome
      // is a correct application that raises mastery, others are seen-only.
      learn(conceptsForText(outcome.lesson, outcome.consequence), {
        applied: outcome.tone === "good",
      });
    }
  }, [answered, outcome, audio, learn, beat, runState]);

  return (
    <>
    {/* No entrance of its own: YearLoop's only call site already wraps this card in
        <Reveal>, which is reduced-motion aware. The wrapper that used to live here
        double-faded the card and stacked ~40px of travel on top of Reveal's. */}
    <div className="paper mx-auto max-w-3xl px-5 py-5 sm:px-6">
      {/* The board's squares carry a plate number and a category rule; this card is the
          run's equivalent object, so it wears the same folio. The numeral is accent and
          the category is ink: colour marks WHERE you are, never what the answer is. A
          tinted category rule would prejudge a decision the player hasn't made yet —
          the outcome below is the only thing allowed to read gain or loss. */}
      <div className="flex items-center justify-between border-b border-hairline-strong pb-2">
        <SectionMark n={plate}>{event.tag}</SectionMark>
        <span className="eyebrow text-secondary">Life event</span>
      </div>
      <p className="mt-3 font-body text-[1.02rem] leading-relaxed text-ink/85">{event.prompt}</p>

      <div className="my-3 h-px bg-ink/15" />

      <ul className="space-y-2">
        {event.choices.map((c) => {
          const isChosen = c.id === chosenId;
          const dim = answered && !isChosen;
          return (
            <li key={c.id}>
              <button
                type="button"
                disabled={answered}
                onClick={() => {
                  audio.sfx("paper");
                  // captured BEFORE the engine mutates — see nwBefore
                  if (runState) nwBefore.current = netWorth(runState);
                  onChoose(event.id, c);
                }}
                data-radius=""
                /* The choice you made is the live thing on this card, so it takes the
                   accent — the same job it does on the selected mode card and the
                   active square. It marks WHICH you picked, never whether that was
                   the right pick; the outcome rail below carries the verdict. */
                className={`group flex w-full items-start gap-2.5 border px-3.5 py-2.5 text-left transition-all ${
                  isChosen ? "border-accent bg-accent/10" : dim ? "border-ink/10 opacity-45" : "border-hairline-strong hover:border-ink hover:bg-ink/[0.04]"
                } ${answered ? "cursor-default" : "cursor-pointer"}`}
              >
                {/* paper knockout on the accent fill — ink on accent is 2.74:1 */}
                <span data-radius="round" className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center border ${isChosen ? "border-accent bg-accent text-bg" : "border-ink/40 text-transparent"}`}>
                  <CheckIcon size={12} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-mono text-sm font-semibold uppercase tracking-wide text-ink">{c.label}</span>
                  <span className="mt-0.5 block font-body text-sm leading-snug text-ink/60">{c.blurb}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* The wrapper is always mounted so the swap from "outcome hidden" to the reveal
          is a content change *inside* a live region — an added region isn't announced. */}
      <div aria-live="polite" ref={outcomeRef} tabIndex={-1}>
      {!answered ? (
        <p className="mt-4 flex items-center justify-center gap-2 text-secondary">
          <LockIcon size={14} />
          <span className="eyebrow">Outcome hidden — choose to find out</span>
        </p>
      ) : (
        // Keep the fade under reduced motion — it is the visual counterpart of the
        // aria-live announcement above; only the travel is dropped.
        outcome && (
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduced ? DUR.instant : DUR.fast, ease: EASE }}
            className="mt-4 border-l-2 pl-4 pr-1 py-3"
            style={{ borderColor: TONE_HEX[outcome.tone] }}
          >
            {outcome.note && (
              <p className="display-caps text-base" style={{ color: TONE_HEX[outcome.tone] }}>
                {outcome.note}
              </p>
            )}
            <p className="mt-1 font-body text-[0.97rem] leading-relaxed text-ink/85">{outcome.consequence}</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {chips(outcome.effect).map((ch, i) => (
                <span key={i} className="num border px-1.5 py-0.5 text-[0.66rem]" style={{ color: ch.positive ? "var(--color-gain)" : "var(--color-loss)", borderColor: ch.positive ? "var(--color-gain)" : "var(--color-loss)" }}>
                  {ch.text}
                </span>
              ))}
            </div>
            {outcome.lesson && (
              <div className="mt-3 border-t border-hairline pt-2.5">
                <p className="voice text-[1.05rem] leading-snug text-ink/90">{outcome.lesson}</p>
              </div>
            )}
          </motion.div>
        )
      )}
      </div>
    </div>
    {showBeat && chosenChoice && outcome && runState && (
      <ConsequenceBeat
        event={event}
        choice={chosenChoice}
        outcome={outcome}
        netWorthBefore={nwBefore.current ?? netWorth(runState)}
        netWorthAfter={netWorth(runState)}
        onDone={() => {
          setShowBeat(false);
          // The beat's focus trap restores to whatever was focused when it opened —
          // <body>, since the choice button was disabled a tick earlier and can never
          // be refocused. Land the player on the outcome the ceremony just explained,
          // in the frame *after* that restore has run.
          requestAnimationFrame(() => outcomeRef.current?.focus({ preventScroll: true }));
        }}
      />
    )}
    </>
  );
}
