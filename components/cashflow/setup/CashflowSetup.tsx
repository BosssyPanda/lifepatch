"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { CheckIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/NeonButton";
import { useAudio } from "@/hooks/useAudio";
import { DREAMS } from "@/lib/cashflow/dreams";
import { PROFESSIONS } from "@/lib/cashflow/professions";
import { currency } from "@/lib/format";
import type { Profession } from "@/lib/cashflow/types";

function profExpenses(p: Profession): number {
  return p.taxes + p.homeMortgage + p.schoolLoan + p.carLoan + p.creditCard + p.retail + p.other;
}

const DOTS = (n: number) =>
  Array.from({ length: 5 }).map((_, i) => (
    <span key={i} className={`h-1.5 w-1.5 rounded-full ${i < n ? "bg-accent" : "bg-paper-ink/20"}`} />
  ));

export function CashflowSetup({
  hasSave,
  onResume,
  onBegin,
  onExit,
}: {
  hasSave: boolean;
  onResume: () => void;
  onBegin: (professionId: string, dreamId: string, name: string) => void;
  onExit: () => void;
}) {
  const audio = useAudio();
  const [step, setStep] = useState<"profession" | "dream">("profession");
  const [prof, setProf] = useState<string | null>(null);
  const [dream, setDream] = useState<string | null>(null);
  const [name, setName] = useState("");

  return (
    <div className="mx-auto min-h-[100svh] w-full max-w-5xl px-4 py-10">
      <div className="flex items-center justify-between">
        <p className="eyebrow text-accent">Escape the Rat Race · Setup</p>
        <NeonButton variant="ghost" size="sm" onClick={onExit}>
          ← Title
        </NeonButton>
      </div>

      {hasSave && step === "profession" && (
        <div className="mt-5 flex items-center justify-between rounded-[5px] border border-accent/40 bg-accent/10 px-4 py-3">
          <p className="font-serif text-[0.9rem] text-ink">You have a game in progress.</p>
          <NeonButton variant="primary" size="sm" onClick={() => { audio.sfx("confirm"); onResume(); }}>
            Continue run →
          </NeonButton>
        </div>
      )}

      {step === "profession" ? (
        <>
          <h1 className="display-caps mt-7 text-3xl text-ink sm:text-5xl">Choose your profession</h1>
          <p className="mt-2 max-w-2xl font-serif text-ink-dim">
            Each job sets your salary AND your expenses. Watch the lesson hiding in plain sight: a bigger paycheck usually means a bigger bar to clear.
          </p>

          <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PROFESSIONS.map((p, i) => {
              const exp = profExpenses(p);
              const pay = p.salary - exp;
              const active = prof === p.id;
              return (
                <motion.button
                  key={p.id}
                  onClick={() => { audio.sfx("click"); setProf(p.id); }}
                  initial={{ opacity: 0, y: 22 }}
                  animate={{ opacity: 1, y: 0, scale: active ? 1.02 : 1 }}
                  transition={{ delay: i * 0.05, type: "spring", stiffness: 220, damping: 20 }}
                  whileHover={{ y: -4 }}
                  className={`paper relative overflow-hidden rounded-[6px] p-4 text-left ${active ? "ring-2 ring-accent ring-offset-2 ring-offset-bg" : ""}`}
                >
                  {active && (
                    <span className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-accent text-paper">
                      <CheckIcon size={13} />
                    </span>
                  )}
                  <h2 className="display-caps text-xl text-paper-ink">{p.title}</h2>
                  <p className="mt-1 font-serif text-[0.82rem] leading-snug text-paper-ink/70">{p.blurb}</p>
                  <div className="mt-3 space-y-1 border-t border-paper-ink/15 pt-2 num text-[0.82rem]">
                    <div className="flex justify-between"><span className="text-paper-ink/60">Salary</span><span className="text-paper-ink">{currency(p.salary)}/mo</span></div>
                    <div className="flex justify-between"><span className="text-paper-ink/60">Expenses</span><span className="text-brick">{currency(exp)}/mo</span></div>
                    <div className="flex justify-between"><span className="text-paper-ink/60">Payday</span><span className={pay >= 0 ? "text-olive" : "text-brick"}>{pay >= 0 ? "+" : ""}{currency(pay)}/mo</span></div>
                  </div>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <span className="eyebrow text-paper-dim" style={{ fontSize: "0.54rem" }}>Difficulty</span>
                    <span className="flex items-center gap-1">{DOTS(p.difficulty)}</span>
                  </div>
                </motion.button>
              );
            })}
          </div>

          <div className="mt-8 flex justify-end">
            <NeonButton variant="primary" size="lg" disabled={!prof} onClick={() => { audio.sfx("confirm"); setStep("dream"); }}>
              {prof ? "Pick your dream →" : "Choose a profession"}
            </NeonButton>
          </div>
        </>
      ) : (
        <>
          <button onClick={() => setStep("profession")} className="mt-7 font-serif text-[0.82rem] text-ink-dim underline">
            ← back to professions
          </button>
          <h1 className="display-caps mt-3 text-3xl text-ink sm:text-5xl">Choose your dream</h1>
          <p className="mt-2 max-w-2xl font-serif text-ink-dim">
            This is what you&apos;ll chase on the Fast Track once you&apos;re free. Pick the one that makes the grind worth it.
          </p>

          <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {DREAMS.map((d, i) => {
              const active = dream === d.id;
              return (
                <motion.button
                  key={d.id}
                  onClick={() => { audio.sfx("click"); setDream(d.id); }}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0, scale: active ? 1.03 : 1 }}
                  transition={{ delay: i * 0.04, type: "spring", stiffness: 240, damping: 20 }}
                  whileHover={{ y: -4 }}
                  className={`rounded-[6px] border p-4 text-left ${active ? "border-accent bg-accent/15" : "border-ink/15 bg-bg2 hover:border-ink/35"}`}
                >
                  <h3 className="display-caps text-base text-ink">{d.title}</h3>
                  <p className="mt-1 font-serif text-[0.78rem] leading-snug text-ink-dim">{d.blurb}</p>
                  <p className="mt-2 num text-sm text-accent">{currency(d.cost)}</p>
                </motion.button>
              );
            })}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-end gap-3">
            <label className="flex items-center gap-2 font-serif text-[0.85rem] text-ink-dim">
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Player"
                maxLength={16}
                className="w-36 rounded-[4px] border border-ink/20 bg-bg2 px-3 py-1.5 num text-ink outline-none focus:border-accent"
              />
            </label>
            <NeonButton
              variant="primary"
              size="lg"
              disabled={!dream}
              onClick={() => { audio.sfx("confirm"); audio.unlock("gameplay"); onBegin(prof!, dream!, name); }}
            >
              Enter the Rat Race →
            </NeonButton>
          </div>
        </>
      )}
    </div>
  );
}
