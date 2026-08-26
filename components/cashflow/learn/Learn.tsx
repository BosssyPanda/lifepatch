"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { CheckIcon, CloseIcon, InfoIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/LedgerButton";
import { GLOSSARY } from "@/lib/cashflow/glossary";
import type { QuizQuestion, TutorialStep } from "@/lib/cashflow/lessons";
import { DUR, EASE } from "@/src/motion/tokens";

export function CoachCard({ title, body, onOk }: { title: string; body: string; onOk: () => void }) {
  return (
    <div className="panel">
      <div className="flex items-center gap-2">
        {/* the coach's medallion — an intrinsically circular badge, not a control (amendment A) */}
        <span data-radius="round" className="grid h-8 w-8 place-items-center bg-ink text-bg">
          <InfoIcon size={18} />
        </span>
        <p className="eyebrow text-ink" style={{ fontSize: "0.6rem" }}>
          Coach
        </p>
      </div>
      <h3 className="display-caps mt-2 text-xl text-ink">{title}</h3>
      <p className="mt-1.5 font-body text-[0.92rem] leading-relaxed text-ink/85">{body}</p>
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
    <div className="panel">
      <p className="eyebrow text-ink" style={{ fontSize: "0.6rem" }}>
        Pop quiz · {q.concept}
      </p>
      <h3 className="display-caps mt-1 text-lg text-ink">{q.question}</h3>
      <div className="mt-3 space-y-2">
        {q.options.map((o, i) => {
          const show = answered;
          const isPicked = picked === i;
          const tone = show
            ? o.correct
              ? "border-gain bg-gain/15 text-ink"
              : isPicked
                ? "border-loss bg-loss/15 text-ink"
                : "border-ink/15 text-ink/50"
            : "border-hairline-strong text-ink hover:border-ink";
          return (
            <button
              key={i}
              disabled={answered}
              onClick={() => setPicked(i)}
              data-radius=""
              className={`flex w-full items-center justify-between border-2 px-3 py-2.5 text-left font-body text-[0.86rem] transition-colors ${tone}`}
            >
              <span>{o.label}</span>
              {show && o.correct && <CheckIcon size={16} />}
            </button>
          );
        })}
      </div>

      {/* The explanation used to animate `height: 0 → "auto"` (framer has to measure
          the content, and the whole card below reflows for the length of the tween)
          and had no `exit` at all, so it snapped shut. It now takes its natural height
          in one step and wipes in/out with clip-path — compositor-only, and the close
          runs at the house exit speed instead of vanishing. */}
      <AnimatePresence>
        {answered && (
          <motion.div
            initial={{ opacity: 0, clipPath: "inset(0 0 100% 0)" }}
            animate={{ opacity: 1, clipPath: "inset(0 0 0% 0)" }}
            exit={{ opacity: 0, clipPath: "inset(0 0 100% 0)", transition: { duration: DUR.exitFast, ease: EASE } }}
            transition={{ duration: DUR.fast, ease: EASE }}
            className="overflow-hidden"
          >
            <p className={`mt-3 px-3 py-2 font-body text-[0.86rem] ${correct ? "bg-gain/15 text-ink" : "bg-loss/12 text-ink"}`}>
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
    <div className="paper">
      <div className="sticky top-0 flex items-center justify-between border-b-2 border-ink bg-bg px-5 py-3">
        <h3 className="display-caps text-xl text-ink">Money Glossary</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close glossary"
          data-radius=""
          className="grid h-11 w-11 place-items-center border-2 border-hairline-strong text-ink-dim transition-colors hover:border-ink hover:text-ink"
        >
          <CloseIcon size={16} />
        </button>
      </div>
      <div className="space-y-3 p-5">
        {GLOSSARY.map((t) => (
          <div key={t.term} className="border-b border-ink/12 pb-3 last:border-0">
            <p className="display-caps text-[0.95rem] text-ink">{t.term}</p>
            <p className="mt-0.5 font-body text-[0.86rem] leading-relaxed text-ink/80">{t.def}</p>
            {t.example && <p className="voice mt-1 text-[0.8rem] text-ink/55">e.g. {t.example}</p>}
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
    <div className="panel">
      <div className="flex items-center justify-between">
        <p className="eyebrow text-ink" style={{ fontSize: "0.6rem" }}>
          Lesson {i + 1} / {steps.length}
        </p>
        <button onClick={onDone} className="font-body text-[0.78rem] text-ink/50 underline">
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
          <h3 className="display-caps mt-2 text-2xl text-ink">{step.title}</h3>
          <p className="mt-2 font-body text-[0.95rem] leading-relaxed text-ink/85">{step.body}</p>
        </motion.div>
      </AnimatePresence>

      <div className="mt-5 flex items-center justify-between">
        {/* `transition-all` tweened WIDTH across the w-5 ↔ w-1.5 flip — a layout
            property, which § Motion forbids outright. The ink fade survives; the width
            now snaps, which is what a printed step marker does anyway. */}
        <div className="flex gap-1.5">
          {steps.map((_, idx) => (
            <span key={idx} className={`h-1.5 transition-colors ${idx === i ? "w-5 bg-ink" : "w-1.5 bg-ink/25"}`} />
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
