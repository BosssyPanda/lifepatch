"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { CheckIcon, LockIcon } from "@/components/icons";
import { useAudio } from "@/hooks/useAudio";
import { useConceptLearn } from "@/hooks/useConceptLearn";
import { stingForTone } from "@/lib/audioMap";
import { conceptsForText } from "@/lib/concepts";
import { currency } from "@/lib/format";
import type { LifeChoice, LifeEffect, LifeEvent } from "@/lib/lifeEvents";
import { netWorth, type RunState } from "@/lib/runEngine";
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
  if (e.health) out.push({ text: `${e.health > 0 ? "+" : "−"}${Math.abs(e.health)} health`, positive: e.health > 0 });
  if (e.happiness) out.push({ text: `${e.happiness > 0 ? "+" : "−"}${Math.abs(e.happiness)} mood`, positive: e.happiness > 0 });
  return out;
}

export function LifeEventCard({
  event,
  chosen,
  onChoose,
  runState,
}: {
  event: LifeEvent & { choices: LifeChoice[] };
  chosen?: string; // "choiceId|outcomeIdx"
  onChoose: (eventId: string, choice: LifeChoice) => void;
  runState?: RunState;
}) {
  const audio = useAudio();
  const { learn } = useConceptLearn();
  const [chosenId, idxStr] = chosen ? chosen.split("|") : [undefined, undefined];
  const answered = Boolean(chosenId);
  const chosenChoice = event.choices.find((c) => c.id === chosenId);
  const outcome = chosenChoice?.outcomes[Number(idxStr)] ?? chosenChoice?.outcomes[0];

  // A flagship consequence beat plays for tagged events (Phase 2), but only on a
  // fresh answer — never when revisiting a card that was already answered.
  const beat = beatFor(event.id);
  const answeredAtMount = useRef(answered);
  const [showBeat, setShowBeat] = useState(false);

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
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 200, damping: 22 }}
      className="paper mx-auto max-w-3xl px-5 py-5 sm:px-6"
    >
      <div className="flex items-center justify-between border-b border-ink/30 pb-2">
        <span className="eyebrow text-secondary">{event.tag}</span>
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
                onClick={() => { audio.sfx("paper"); onChoose(event.id, c); }}
                className={`group flex w-full items-start gap-2.5 rounded-[3px] border px-3.5 py-2.5 text-left transition-all ${
                  isChosen ? "border-ink bg-ink/10" : dim ? "border-ink/10 opacity-45" : "border-ink/25 hover:border-ink hover:bg-ink/[0.04]"
                } ${answered ? "cursor-default" : "cursor-pointer"}`}
              >
                <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${isChosen ? "border-ink bg-ink text-bg" : "border-ink/40 text-transparent"}`}>
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
      <div aria-live="polite">
      {!answered ? (
        <p className="mt-4 flex items-center justify-center gap-2 text-secondary">
          <LockIcon size={14} />
          <span className="eyebrow">Outcome hidden — choose to find out</span>
        </p>
      ) : (
        outcome && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-4 border-l-2 pl-4 pr-1 py-3" style={{ borderColor: TONE_HEX[outcome.tone] }}>
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
    </motion.div>
    {showBeat && chosenChoice && outcome && runState && (
      <ConsequenceBeat
        event={event}
        choice={chosenChoice}
        outcome={outcome}
        netWorthAfter={netWorth(runState)}
        onDone={() => setShowBeat(false)}
      />
    )}
    </>
  );
}
