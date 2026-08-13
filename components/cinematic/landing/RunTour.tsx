"use client";

import { motion, useMotionValueEvent, useScroll } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { SplitFlap } from "@/components/cinematic/SplitFlap";
import { sp500Return, macroEvent } from "@/lib/markets";
import { PROFESSIONS } from "@/lib/cashflow/professions";
import { VERDICTS } from "@/lib/verdict";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { DUR, EASE } from "@/src/motion/tokens";

/**
 * Landing set piece 002 — "HOW A RUN WORKS" (spectacle Phase K1).
 * A pinned scrollytelling tour: the viewport sticks while scroll drives four
 * beats — SETUP → THE WORLD MOVES → THE LEDGER POSTS → THE VERDICT — each
 * rendered as a live mini-composite of real game data (janitor dossier from
 * lib/cashflow/professions, the 2008 year from lib/markets, the derived
 * payday receipt, and the real Financially Free verdict). Compositor-only
 * crossfades; reduced motion renders the four beats as a static stack.
 */

const STEPS = [
  { n: "001", label: "Setup", sub: "Pick a life. Every job is a different math problem." },
  { n: "002", label: "The world moves", sub: "Real market history hits your ledger, year after year." },
  { n: "003", label: "The ledger posts", sub: "Every choice becomes a line item. The house keeps receipts." },
  { n: "004", label: "The verdict", sub: "Nine months or forty years later — one word sums you up." },
] as const;

const JANITOR = PROFESSIONS[0];
const EXPENSE_ROWS = [
  ["Taxes", JANITOR.taxes],
  ["Mortgage", JANITOR.homeMortgage],
  ["Car loan", JANITOR.carLoan],
  ["Credit cards", JANITOR.creditCard],
  ["Retail", JANITOR.retail],
  ["Other", JANITOR.other],
] as const;
const EXPENSES = EXPENSE_ROWS.reduce((s, [, v]) => s + v, 0);
const PAYDAY = JANITOR.salary - EXPENSES;

const CRASH_YEAR = 2008;
const CRASH = macroEvent(CRASH_YEAR);
const CRASH_PCT = sp500Return(CRASH_YEAR);

function Money({ v, signed = false }: { v: number; signed?: boolean }) {
  const neg = v < 0;
  return (
    <span className="num" style={{ color: signed ? (neg ? "var(--color-loss)" : "var(--color-gain)") : undefined }}>
      {signed && !neg ? "+" : ""}{neg ? "−" : ""}${Math.abs(v).toLocaleString("en-US")}
    </span>
  );
}

/** Beat 1 — the janitor dossier card, straight from lib data. */
function PanelSetup() {
  return (
    <div className="w-full max-w-md border border-hairline bg-bg2 p-5 sm:p-6">
      <div className="flex items-baseline justify-between border-b border-hairline pb-3">
        <span className="eyebrow text-secondary">Profession file</span>
        <span className="eyebrow text-tertiary">01 / 06</span>
      </div>
      <p className="display-caps mt-4 text-2xl text-ink sm:text-3xl">{JANITOR.title}</p>
      <p className="mt-2 font-body text-sm leading-relaxed text-ink-dim">{JANITOR.blurb}</p>
      <div className="mt-5 space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="eyebrow text-secondary" style={{ fontSize: "0.6rem" }}>Salary</span>
          <span className="mt-1 flex-1 rule-dotted" />
          <Money v={JANITOR.salary} />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="eyebrow text-secondary" style={{ fontSize: "0.6rem" }}>Expenses</span>
          <span className="mt-1 flex-1 rule-dotted" />
          <span className="num text-loss">−${EXPENSES.toLocaleString("en-US")}</span>
        </div>
        <div className="flex items-baseline gap-2 border-t border-hairline pt-2">
          <span className="eyebrow text-ink" style={{ fontSize: "0.6rem" }}>Payday</span>
          <span className="mt-1 flex-1 rule-dotted" />
          <Money v={PAYDAY} signed />
        </div>
      </div>
    </div>
  );
}

/** Beat 2 — a real year from the markets sim. */
function PanelWorld() {
  return (
    <div className="w-full max-w-md border border-hairline bg-bg2 p-5 sm:p-6">
      <div className="flex items-baseline justify-between border-b border-hairline pb-3">
        <span className="eyebrow text-secondary">Market bulletin</span>
        <span className="num text-tertiary" style={{ fontSize: "0.66rem" }}>{CRASH_YEAR}</span>
      </div>
      <p className="display-caps mt-4 text-2xl text-ink sm:text-3xl">{CRASH?.title}</p>
      <p className="mt-2 font-body text-sm leading-relaxed text-ink-dim">{CRASH?.blurb}</p>
      <div className="mt-5 flex items-baseline gap-2 border-t border-hairline pt-3">
        <span className="eyebrow text-secondary" style={{ fontSize: "0.6rem" }}>S&P {CRASH_YEAR}</span>
        <span className="mt-1 flex-1 rule-dotted" />
        <span className="num text-loss" style={{ fontSize: "1.4rem" }}>
          −{Math.abs(CRASH_PCT).toFixed(1)}%
        </span>
      </div>
      <p className="voice mt-4 text-base text-ink">&ldquo;Your ledger felt that.&rdquo;</p>
    </div>
  );
}

/** Beat 3 — the month's receipt, derived from the same profession record. */
function PanelLedger() {
  return (
    <div className="w-full max-w-md border border-hairline bg-bg2 p-5 sm:p-6">
      <div className="flex items-baseline justify-between border-b border-hairline pb-3">
        <span className="eyebrow text-secondary">Statement — month 01</span>
        <span className="eyebrow text-gain" style={{ fontSize: "0.6rem" }}>Posted</span>
      </div>
      <div className="mt-4 space-y-1.5">
        {EXPENSE_ROWS.map(([label, v]) => (
          <div key={label} className="flex items-baseline gap-2">
            <span className="eyebrow text-secondary" style={{ fontSize: "0.58rem" }}>{label}</span>
            <span className="mt-1 flex-1 rule-dotted" />
            <span className="num text-ink-dim" style={{ fontSize: "0.8rem" }}>−${v.toLocaleString("en-US")}</span>
          </div>
        ))}
        <div className="flex items-baseline gap-2 pt-1">
          <span className="eyebrow text-secondary" style={{ fontSize: "0.58rem" }}>Salary</span>
          <span className="mt-1 flex-1 rule-dotted" />
          <span className="num text-ink" style={{ fontSize: "0.8rem" }}>+${JANITOR.salary.toLocaleString("en-US")}</span>
        </div>
        <div className="flex items-baseline gap-2 border-t border-hairline pt-2.5">
          <span className="eyebrow text-ink" style={{ fontSize: "0.62rem" }}>Net</span>
          <span className="mt-1 flex-1 rule-dotted" />
          <span className="num text-gain" style={{ fontSize: "1.3rem" }}>+${PAYDAY.toLocaleString("en-US")}</span>
        </div>
      </div>
      <p className="voice mt-4 text-base text-ink">&ldquo;I saw everything. I wrote it down.&rdquo;</p>
    </div>
  );
}

/** Beat 4 — the real best-case verdict, split-flapping in. */
function PanelVerdict({ live, reduced }: { live: boolean; reduced: boolean }) {
  const v = VERDICTS.free;
  return (
    <div className="w-full max-w-md border border-hairline bg-bg2 p-5 sm:p-6">
      <div className="flex items-baseline justify-between border-b border-hairline pb-3">
        <span className="eyebrow text-secondary">Final verdict</span>
        <span className="eyebrow text-tertiary">Form 01</span>
      </div>
      {/* 16 flap cells must fit the max-w-md card — cell width tracks font size.
          `silent`: this board is armed by SCROLL POSITION, and scrolling past a
          landing-page exhibit must never make noise. The clacks belong to the
          real verdict at the end of a run. */}
      <div className="mt-5 text-lg lg:text-xl">
        <SplitFlap text={v.title} hex={v.hex} active={live} reduced={reduced} silent />
      </div>
      <p className="mt-4 font-body text-sm leading-relaxed text-ink-dim">{v.blurb}</p>
      <p className="voice mt-4 text-base text-ink">&ldquo;One of six ways this ends.&rdquo;</p>
    </div>
  );
}

export function RunTour() {
  const { reduced } = useMotionCtx();
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  // Probed synchronously, not in an effect, for the same reason BoardDiorama does it: this
  // tree is `ssr: false`, so the first render IS the first client render. Read in an effect,
  // every phone painted the pinned h-[380svh] branch first and then swapped to the stacked
  // document — collapsing roughly three viewport-heights of scroll height mid-load and
  // yanking everything below it on the landing page.
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 1023.98px)").matches,
  );
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });

  // Keep following the query so a rotate or resize still swaps branches.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023.98px)"); // below Tailwind `lg`
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    setStep(Math.min(3, Math.floor(p * 4)));
  });

  const panels = (live: boolean) => [
    <PanelSetup key="setup" />,
    <PanelWorld key="world" />,
    <PanelLedger key="ledger" />,
    <PanelVerdict key="verdict" live={live} reduced={reduced} />,
  ];

  // Reduced motion — or any viewport below `lg`: the four beats as a plain stacked
  // document, no pinning. The pin is a ≥lg affordance on purpose: the two-column
  // stage cannot hold heading + the 4-step rail + a full panel card inside 100svh
  // at 390px, so the bottom of the active card was simply clipped off. Do not
  // re-pin this below lg without shrinking the rail to a one-line strip first.
  if (reduced || narrow) {
    return (
      <section className="border-t border-hairline px-5 py-20 sm:px-10 lg:px-16" aria-labelledby="runtour-heading">
        <p className="eyebrow text-secondary">002 — The Loop</p>
        <h2 id="runtour-heading" className="display-caps mt-3 text-3xl text-ink sm:text-5xl">How a run works</h2>
        <div className="mt-10 grid gap-8 md:grid-cols-2">
          {STEPS.map((s, i) => (
            <div key={s.n}>
              <p className="eyebrow text-secondary">{s.n} — {s.label}</p>
              <p className="mt-1 mb-4 font-body text-sm text-ink-dim">{s.sub}</p>
              {panels(true)[i]}
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section ref={ref} className="relative h-[380svh] border-t border-hairline" aria-labelledby="runtour-heading">
      <div className="sticky top-0 flex h-[100svh] flex-col overflow-hidden px-5 py-10 sm:px-10 lg:px-16">
        <div>
          <p className="eyebrow text-secondary">002 — The Loop</p>
          <h2 id="runtour-heading" className="display-caps mt-2 text-3xl text-ink sm:text-5xl">How a run works</h2>
        </div>

        <div className="mt-8 grid min-h-0 flex-1 gap-8 lg:grid-cols-[1fr_1.2fr] lg:gap-14">
          {/* step rail */}
          <ol className="flex flex-col justify-center gap-5 sm:gap-7">
            {STEPS.map((s, i) => {
              const active = i === step;
              return (
                <li key={s.n} className="flex items-start gap-4">
                  <span
                    className="num mt-0.5 border px-1.5 py-0.5 transition-colors duration-300"
                    style={{
                      fontSize: "0.62rem",
                      borderColor: active ? "var(--color-ink)" : "var(--color-hairline)",
                      color: active ? "var(--color-ink)" : "var(--color-tertiary)",
                    }}
                  >
                    {s.n}
                  </span>
                  <div>
                    <p
                      className="eyebrow transition-colors duration-300"
                      style={{ color: active ? "var(--color-ink)" : "var(--color-tertiary)" }}
                    >
                      {s.label}
                    </p>
                    <motion.p
                      animate={{ opacity: active ? 1 : 0.35 }}
                      transition={{ duration: DUR.fast, ease: EASE }}
                      className="mt-1 max-w-xs font-body text-sm leading-relaxed text-ink-dim"
                    >
                      {s.sub}
                    </motion.p>
                  </div>
                </li>
              );
            })}
          </ol>

          {/* live panel stage (desktop) */}
          <div className="relative hidden min-h-0 items-center lg:flex">
            {panels(step === 3).map((panel, i) => (
              <motion.div
                key={STEPS[i].n}
                className="absolute inset-0 flex items-center justify-center"
                initial={false}
                animate={{ opacity: step === i ? 1 : 0, y: step === i ? 0 : 10 }}
                transition={{ duration: DUR.base, ease: EASE }}
                style={{ pointerEvents: step === i ? "auto" : "none" }}
                aria-hidden={step !== i}
              >
                {panel}
              </motion.div>
            ))}
          </div>

          {/* mobile: single active panel below the rail */}
          <div className="relative flex items-start justify-center lg:hidden">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DUR.base, ease: EASE }}
              className="w-full max-w-md"
            >
              {panels(step === 3)[step]}
            </motion.div>
          </div>
        </div>

        <div className="flex items-center gap-2 pb-1">
          {STEPS.map((s, i) => (
            <span
              key={s.n}
              className="h-0.5 flex-1 transition-colors duration-300"
              style={{ background: i <= step ? "var(--color-ink)" : "var(--color-hairline)" }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
