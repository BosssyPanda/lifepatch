"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { CheckIcon, CloseIcon, InfoIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/NeonButton";
import { GLOSSARY } from "@/lib/cashflow/glossary";
import type { QuizQuestion, TutorialStep } from "@/lib/cashflow/lessons";

const PANEL = "paper rounded-[6px] p-5";

export function CoachCard({ title, body, onOk }: { title: string; body: string; onOk: () => void }) {
  return (
    <div className={PANEL}>
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-bg">
          <InfoIcon size={18} />
        </span>
        <p className="eyebrow text-accent" style={{ fontSize: "0.6rem" }}>
          Coach
        </p>
      </div>
      <h3 className="display-caps mt-2 text-xl text-paper-ink">{title}</h3>
      <p className="mt-1.5 font-serif text-[0.92rem] leading-relaxed text-paper-ink/85">{body}</p>
      <div className="mt-4 flex justify-end">
        <NeonButton variant="paper" size="md" onClick={onOk}>
          Got it
        </NeonButton>
      </div>
    </div>
  );
}

export function QuizCard({ q, onDone }: { q: QuizQuestion; onDone: (correct: boolean) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;
  const correct = answered && q.options[picked].correct;

  return (
    <div className={PANEL}>
      <p className="eyebrow text-accent" style={{ fontSize: "0.6rem" }}>
        Pop quiz · {q.concept}
      </p>
      <h3 className="display-caps mt-1 text-lg text-paper-ink">{q.question}</h3>
      <div className="mt-3 space-y-2">
        {q.options.map((o, i) => {
          const show = answered;
          const isPicked = picked === i;
          const tone = show
            ? o.correct
              ? "border-olive bg-olive/15 text-paper-ink"
              : isPicked
                ? "border-brick bg-brick/15 text-paper-ink"
                : "border-paper-ink/15 text-paper-ink/50"
            : "border-paper-ink/25 text-paper-ink hover:border-accent";
          return (
            <button
              key={i}
              disabled={answered}
              onClick={() => setPicked(i)}
              className={`flex w-full items-center justify-between rounded-[5px] border-2 px-3 py-2.5 text-left font-serif text-[0.86rem] transition-colors ${tone}`}
            >
              <span>{o.label}</span>
              {show && o.correct && <CheckIcon size={16} />}
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {answered && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="overflow-hidden"
          >
            <p className={`mt-3 rounded-[4px] px-3 py-2 font-serif text-[0.86rem] ${correct ? "bg-olive/15 text-paper-ink" : "bg-brick/12 text-paper-ink"}`}>
              <strong>{correct ? "Correct! " : "Not quite. "}</strong>
              {q.explain}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-4 flex justify-end">
        <NeonButton variant="paper" size="md" disabled={!answered} onClick={() => onDone(!!correct)}>
          Continue
        </NeonButton>
      </div>
    </div>
  );
}

export function GlossaryModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="paper rounded-[6px]">
      <div className="sticky top-0 flex items-center justify-between border-b-2 border-paper-ink bg-paper px-5 py-3">
        <h3 className="display-caps text-xl text-paper-ink">Money Glossary</h3>
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-paper-ink/70 hover:bg-paper-ink/10">
          <CloseIcon size={18} />
        </button>
      </div>
      <div className="space-y-3 p-5">
        {GLOSSARY.map((t) => (
          <div key={t.term} className="border-b border-paper-ink/12 pb-3 last:border-0">
            <p className="display-caps text-[0.95rem] text-paper-ink">{t.term}</p>
            <p className="mt-0.5 font-serif text-[0.86rem] leading-relaxed text-paper-ink/80">{t.def}</p>
            {t.example && <p className="mt-1 font-serif text-[0.8rem] italic text-paper-ink/55">e.g. {t.example}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Tutorial({
  steps,
  onDone,
}: {
  steps: TutorialStep[];
  onDone: () => void;
}) {
  const [i, setI] = useState(0);
  const step = steps[i];
  const last = i === steps.length - 1;

  return (
    <div className={PANEL}>
      <div className="flex items-center justify-between">
        <p className="eyebrow text-accent" style={{ fontSize: "0.6rem" }}>
          Lesson {i + 1} / {steps.length}
        </p>
        <button onClick={onDone} className="font-serif text-[0.78rem] text-paper-ink/50 underline">
          Skip tutorial
        </button>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={step.id}
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -18 }}
          transition={{ duration: 0.22 }}
        >
          <h3 className="display-caps mt-2 text-2xl text-paper-ink">{step.title}</h3>
          <p className="mt-2 font-serif text-[0.95rem] leading-relaxed text-paper-ink/85">{step.body}</p>
        </motion.div>
      </AnimatePresence>

      <div className="mt-5 flex items-center justify-between">
        <div className="flex gap-1.5">
          {steps.map((_, idx) => (
            <span key={idx} className={`h-1.5 rounded-full transition-all ${idx === i ? "w-5 bg-accent" : "w-1.5 bg-paper-ink/25"}`} />
          ))}
        </div>
        <div className="flex gap-2">
          {i > 0 && (
            <NeonButton variant="outline" size="sm" onClick={() => setI((n) => n - 1)}>
              Back
            </NeonButton>
          )}
          <NeonButton variant="paper" size="md" onClick={() => (last ? onDone() : setI((n) => n + 1))}>
            {last ? "Start playing →" : "Next"}
          </NeonButton>
        </div>
      </div>
    </div>
  );
}
