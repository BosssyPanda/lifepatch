"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { CheckIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/LedgerButton";
import { SoundCell } from "@/components/ui/SoundCell";
import { NameField, playerName } from "@/components/ui/NameField";
import { lastPlayerName, rememberPlayerName } from "@/lib/mp/matchStore";
import { useAudio } from "@/hooks/useAudio";
import { DREAMS } from "@/lib/cashflow/dreams";
import { PROFESSIONS } from "@/lib/cashflow/professions";
import { currency } from "@/lib/format";
import type { Profession } from "@/lib/cashflow/types";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { useSpotlightHandler } from "@/src/motion/useSpotlight";
import { SPRING, STAGGER } from "@/src/motion/tokens";

function profExpenses(p: Profession): number {
  return p.taxes + p.homeMortgage + p.schoolLoan + p.carLoan + p.creditCard + p.retail + p.other;
}

const DOTS = (n: number) =>
  Array.from({ length: 5 }).map((_, i) => (
    <span key={i} data-radius="round" className={`h-1.5 w-1.5 ${i < n ? "bg-ink" : "bg-ink/25"}`} />
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
  const { reduced } = useMotionCtx();
  const onSpot = useSpotlightHandler<HTMLButtonElement>();
  const [step, setStep] = useState<"profession" | "dream">("profession");
  const [prof, setProf] = useState<string | null>(null);
  const [dream, setDream] = useState<string | null>(null);
  const [name, setName] = useState("");
  /**
   * The name this device last played under, exactly as Story's Setup reads it.
   *
   * The two setups used to disagree: Story remembered you and Rat Race did not, so
   * naming yourself once still meant retyping it here every single time. Read on
   * mount rather than in the initial state — the server paints no localStorage, and
   * the first client paint has to agree with it. SOLO-VISIBLE, deliberately: the
   * name belongs to the device, not to a mode.
   */
  useEffect(() => {
    const last = lastPlayerName();
    if (last) setName((cur) => cur || last);
  }, []);

  return (
    <div className="mx-auto min-h-[100svh] w-full max-w-5xl px-4 py-10">
      <div className="flex items-center justify-between">
        <p className="eyebrow text-ink">Escape the Rat Race · Setup</p>
        <div className="flex items-center gap-3">
          <SoundCell />
          <NeonButton variant="ghost" size="sm" onClick={onExit}>
            ← Title
          </NeonButton>
        </div>
      </div>

      {hasSave && step === "profession" && (
        <div className="mt-5 flex items-center justify-between border border-ink/40 bg-ink/10 px-4 py-3">
          <p className="font-body text-[0.9rem] text-ink">You have a game in progress.</p>
          <NeonButton variant="primary" size="sm" onClick={() => { audio.sfx("confirm"); onResume(); }}>
            Continue run →
          </NeonButton>
        </div>
      )}

      {step === "profession" ? (
        <>
          <h1 className="display-caps mt-7 text-3xl text-ink sm:text-5xl">Choose your profession</h1>
          <p className="mt-2 max-w-2xl font-body text-ink-dim">
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
                  transition={{ delay: i * STAGGER.tight, ...SPRING.pop }}
                  whileHover={reduced ? undefined : { y: -4 }}
                  data-radius=""
                  // `ring-*` is box-shadow, which the LEDGER reset kills — a real inset outline.
                  style={active ? { outline: "2px solid var(--color-accent)", outlineOffset: "-2px" } : undefined}
                  onPointerMove={onSpot}
                  className="paper spotlight relative overflow-hidden p-4 text-left"
                >
                  {active && (
                    <>
                      {/* the ink wash the other two pickers already had */}
                      <span className="pointer-events-none absolute inset-0 z-[1] bg-ink/15" />
                      <span data-radius="round" className="absolute right-3 top-3 z-10 grid h-6 w-6 place-items-center bg-accent text-bg">
                        <CheckIcon size={13} />
                      </span>
                    </>
                  )}
                  <h2 className="display-caps text-xl text-ink">{p.title}</h2>
                  <p className="mt-1 font-body text-[0.82rem] leading-snug text-ink/70">{p.blurb}</p>
                  <div className="mt-3 space-y-1 border-t border-ink/15 pt-2 num text-[0.82rem]">
                    <div className="flex justify-between"><span className="text-ink/60">Salary</span><span className="text-ink">{currency(p.salary)}/mo</span></div>
                    <div className="flex justify-between"><span className="text-ink/60">Expenses</span><span className="text-loss">{currency(exp)}/mo</span></div>
                    <div className="flex justify-between"><span className="text-ink/60">Payday</span><span className={pay >= 0 ? "text-gain" : "text-loss"}>{pay >= 0 ? "+" : ""}{currency(pay)}/mo</span></div>
                  </div>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <span className="eyebrow text-secondary" style={{ fontSize: "0.54rem" }}>Difficulty</span>
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
          <button onClick={() => setStep("profession")} className="mt-7 font-body text-[0.82rem] text-ink-dim underline">
            ← back to professions
          </button>
          <h1 className="display-caps mt-3 text-3xl text-ink sm:text-5xl">Choose your dream</h1>
          <p className="mt-2 max-w-2xl font-body text-ink-dim">
            This is what you&apos;ll chase on the Fast Track once you&apos;re free. Pick the one that makes the grind worth it.
          </p>

          {/* Same field, same label, same size as Setup — it used to be a `w-36` afterthought
              wedged next to the CTA, so the two flows named the same player differently. */}
          <NameField value={name} onChange={setName} className="mt-6 w-full max-w-sm" />

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
                  whileHover={reduced ? undefined : { y: -4 }}
                  data-radius=""
                  style={active ? { outline: "2px solid var(--color-accent)", outlineOffset: "-2px" } : undefined}
                  onPointerMove={onSpot}
                  className={`spotlight relative overflow-hidden border p-4 text-left ${active ? "border-accent bg-ink/15" : "border-hairline-strong bg-bg2 hover:border-ink"}`}
                >
                  <h3 className="display-caps text-base text-ink">{d.title}</h3>
                  <p className="mt-1 font-body text-[0.78rem] leading-snug text-ink-dim">{d.blurb}</p>
                  <p className="mt-2 num text-sm text-ink">{currency(d.cost)}</p>
                </motion.button>
              );
            })}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-end gap-3">
            <NeonButton
              variant="primary"
              size="lg"
              disabled={!dream}
              onClick={() => {
                audio.sfx("confirm");
                audio.unlock("gameplay");
                // Committed, not typed: the same rule Story uses, so a half-typed
                // name never becomes the one this device is remembered by.
                rememberPlayerName(name);
                onBegin(prof!, dream!, playerName(name));
              }}
            >
              Enter the Rat Race →
            </NeonButton>
          </div>
        </>
      )}
    </div>
  );
}
