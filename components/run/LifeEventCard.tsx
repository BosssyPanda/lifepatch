"use client";

import { motion } from "framer-motion";
import { CheckIcon } from "@/components/icons";
import { currency } from "@/lib/format";
import type { LifeChoice, LifeEffect, LifeEvent } from "@/lib/lifeEvents";

const TONE_HEX: Record<string, string> = { good: "#7f8b52", bad: "#a33218", warning: "#c8861e", neutral: "#a89f8c" };

function chips(e: LifeEffect): { text: string; positive: boolean }[] {
  const out: { text: string; positive: boolean }[] = [];
  if (e.cash) out.push({ text: `${e.cash > 0 ? "+" : "−"}${currency(Math.abs(e.cash))}`, positive: e.cash > 0 });
  if (e.debt) out.push({ text: `${e.debt > 0 ? "+" : "−"}${currency(Math.abs(e.debt))} debt`, positive: e.debt < 0 });
  if (e.salaryPct) out.push({ text: `${e.salaryPct > 0 ? "+" : ""}${e.salaryPct}% pay`, positive: e.salaryPct > 0 });
  if (e.health) out.push({ text: `${e.health > 0 ? "+" : "−"}${Math.abs(e.health)} health`, positive: e.health > 0 });
  if (e.happiness) out.push({ text: `${e.happiness > 0 ? "+" : "−"}${Math.abs(e.happiness)} mood`, positive: e.happiness > 0 });
  return out;
}

export function LifeEventCard({
  event,
  chosenId,
  onChoose,
}: {
  event: LifeEvent;
  chosenId?: string;
  onChoose: (eventId: string, choice: LifeChoice) => void;
}) {
  const answered = Boolean(chosenId);
  const chosen = event.choices.find((c) => c.id === chosenId);

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 200, damping: 22 }}
      className="paper mx-auto max-w-3xl rounded-[5px] p-5 sm:p-6"
    >
      <div className="flex items-center justify-between border-b-2 border-paper-ink pb-2">
        <span className="eyebrow text-paper-dim">{event.tag}</span>
        <span className="eyebrow text-paper-dim">Life event</span>
      </div>
      <p className="mt-3 font-serif text-[1.05rem] leading-relaxed text-paper-ink/85">{event.prompt}</p>

      <div className="my-3 h-px bg-paper-ink/15" />

      <ul className="space-y-2">
        {event.choices.map((c) => {
          const isChosen = c.id === chosenId;
          const dim = answered && !isChosen;
          return (
            <li key={c.id}>
              <button
                type="button"
                disabled={answered}
                onClick={() => onChoose(event.id, c)}
                className={`group flex w-full items-start gap-2.5 rounded-[3px] border px-3.5 py-2.5 text-left transition-all ${
                  isChosen ? "border-accent bg-accent/10" : dim ? "border-paper-ink/10 opacity-45" : "border-paper-ink/25 hover:border-paper-ink hover:bg-paper-ink/[0.04]"
                } ${answered ? "cursor-default" : "cursor-pointer"}`}
              >
                <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${isChosen ? "border-accent bg-accent text-paper" : "border-paper-ink/40 text-transparent"}`}>
                  <CheckIcon size={12} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-display text-sm font-semibold uppercase tracking-wide text-paper-ink">{c.label}</span>
                  <span className="mt-0.5 block font-serif text-sm leading-snug text-paper-ink/60">{c.blurb}</span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {chips(c.effect).map((ch, i) => (
                      <span key={i} className="num rounded-[2px] px-1.5 py-0.5 text-[0.64rem]" style={{ color: ch.positive ? "#5d6a37" : "#8c2c14", background: ch.positive ? "#7f8b5222" : "#a3321822" }}>
                        {ch.text}
                      </span>
                    ))}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {answered && chosen && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-[4px] border-l-2 px-4 py-3" style={{ borderColor: TONE_HEX[chosen.tone], background: "#00000010" }}>
          <p className="font-serif text-[0.97rem] leading-relaxed text-paper-ink/85">{chosen.consequence}</p>
          {chosen.lesson && (
            <div className="mt-3 border-t border-paper-ink/15 pt-2.5">
              <p className="eyebrow text-paper-dim">The lesson</p>
              <p className="mt-0.5 font-serif text-[0.95rem] italic leading-snug text-paper-ink/80">{chosen.lesson}</p>
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}
