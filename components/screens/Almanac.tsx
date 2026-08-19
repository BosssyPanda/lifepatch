"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useRef, useState } from "react";
import { GlyphMatrix } from "@/components/cinematic/landing/GlyphMatrix";
import { CloseIcon } from "@/components/icons";
import { LedgerDialog } from "@/components/ui/LedgerDialog";
import { LedgerTabs, tabId } from "@/components/ui/LedgerTabs";
import { Reveal } from "@/components/ui/Reveal";
import { useAudio } from "@/hooks/useAudio";
import {
  ALMANAC_SECTIONS,
  GEOPOLITICS,
  MYTH_FACTS,
  TERMS,
  WEALTH_METHODS,
  type AlmanacSectionId,
  type MythFact,
} from "@/lib/almanac";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { EASE, STAGGER, stepDelay } from "@/src/motion/tokens";

// A quiz verdict is not money, so it never touches gain-green/loss-red — red/green here
// would read as "wrong/right". Ink scale only, brighter = the claim holds up.
const VERDICT_TONE: Record<string, string> = {
  Fact: "var(--color-ink)",
  "It depends": "var(--color-secondary)",
  Myth: "var(--color-tertiary)",
};
const VERDICTS = ["Myth", "Fact", "It depends"] as const;
type Verdict = MythFact["verdict"];

export function Almanac({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [section, setSection] = useState<AlmanacSectionId>("wealth");
  const panelId = useId();
  // terms type-in runs once per overlay visit (survives tab switches, re-arms per open)
  const termsTyped = useRef(false);
  // Myth calls live here for the same reason: the section unmounts on every tab switch, so
  // owning the answers below it silently threw away the run of the quiz.
  const [calls, setCalls] = useState<Record<number, Verdict>>({});
  useEffect(() => {
    if (open) {
      termsTyped.current = false;
      setCalls({});
    }
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <LedgerDialog open={open} onClose={onClose} label="The Almanac" fullBleed>
          {/* header + tabs */}
          <div className="sticky top-0 z-10 border-b border-hairline bg-bg">
            <div className="relative overflow-hidden">
              <GlyphMatrix className="absolute inset-0 h-full w-full" />
              <div className="relative mx-auto flex max-w-3xl items-center justify-between px-5 py-3">
                <div>
                  <p className="eyebrow text-ink">The Almanac</p>
                  <h1 className="display-caps text-2xl text-ink">Know the game</h1>
                </div>
                <button type="button" onClick={onClose} aria-label="Close almanac" data-radius="" className="border border-hairline-strong bg-bg p-2 text-ink-dim transition-colors hover:border-ink hover:text-ink">
                  <CloseIcon size={18} />
                </button>
              </div>
            </div>
            <LedgerTabs
              items={ALMANAC_SECTIONS}
              value={section}
              onChange={setSection}
              label="Almanac sections"
              panelId={panelId}
              size="sm"
              className="mx-auto max-w-3xl overflow-x-auto px-5 pb-2 thin-scroll"
            />
          </div>

          {/* content */}
          <div
            className="thin-scroll flex-1 overflow-y-auto"
            id={panelId}
            role="tabpanel"
            aria-labelledby={tabId(panelId, section)}
            // no focusable content in 3 of 4 sections — the pane itself must take focus or
            // the keyboard cannot scroll it (and the dialog's Tab cycle dead-ends on the tabs)
            tabIndex={0}
            data-lenis-prevent
          >
            <div className="mx-auto max-w-3xl px-5 py-8">
              {section === "wealth" && (
                <Section title="Ways to build wealth" sub="Every path has a price. Here's the honest trade-off on each.">
                  {WEALTH_METHODS.map((m, i) => (
                    <Reveal key={m.name} delay={stepDelay(i, 0.03)}>
                      <article className="border border-hairline bg-bg2 p-5">
                        <h3 className="display-caps text-xl text-ink">{m.name}</h3>
                        <p className="voice mt-1 text-sm text-ink-dim">{m.how}</p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          {/* trade-offs, not cash flows — "Burnout risk" is not a loss in dollars */}
                          <LeaderList label="Pros" tone="var(--color-ink)" items={m.pros} />
                          <LeaderList label="Cons" tone="var(--color-secondary)" items={m.cons} />
                        </div>
                      </article>
                    </Reveal>
                  ))}
                </Section>
              )}

              {section === "myths" && <MythSection calls={calls} setCalls={setCalls} />}

              {section === "geo" && (
                <Section title="Geopolitics & the economy" sub="How a crisis on one side of the world reaches your wallet on the other.">
                  {GEOPOLITICS.map((g, i) => (
                    <Reveal key={i} delay={stepDelay(i, 0.03)}>
                      <article className="border border-hairline bg-bg2 p-5">
                        <h3 className="display-caps text-lg text-ink">{g.situation}</h3>
                        <p className="mt-3 eyebrow text-ink-dim">The ripple</p>
                        <ol className="mt-1 space-y-1">
                          {g.ripple.map((r, j) => (
                            <li key={j} className="flex gap-2 font-body text-sm text-ink/85">
                              <span className="num text-ink-dim">{j + 1}.</span> {r}
                            </li>
                          ))}
                        </ol>
                        <p className="mt-3 border-l-2 border-secondary pl-3 font-body text-sm text-ink/85">{g.everyone}</p>
                        <div className="mt-3 border-t border-ink/10 pt-3">
                          <p className="eyebrow text-gain">How to protect yourself</p>
                          <p className="mt-1 font-body text-sm leading-relaxed text-ink/85">{g.mitigation}</p>
                        </div>
                      </article>
                    </Reveal>
                  ))}
                </Section>
              )}

              {section === "terms" && <TermsSection typedRef={termsTyped} />}

              <p className="voice mt-10 text-center text-xs text-ink-dim">
                Educational only — not financial advice. It&apos;s a game, but the lessons are real.
              </p>
            </div>
          </div>
        </LedgerDialog>
      )}
    </AnimatePresence>
  );
}

function Section({ title, sub, aside, children }: { title: string; sub: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="display-caps text-3xl text-ink">{title}</h2>
        {aside}
      </div>
      <p className="voice mt-1 text-ink-dim">{sub}</p>
      <div className="mt-5 space-y-3">{children}</div>
    </div>
  );
}

/* ---------------- Build Wealth — ledger rows with dotted leaders ---------------- */

const rowList = { hidden: {}, show: { transition: { staggerChildren: STAGGER.tight } } };
const rowItem = { hidden: { opacity: 0, x: -8 }, show: { opacity: 1, x: 0, transition: { duration: 0.3, ease: EASE } } };

function LeaderList({ label, tone, items }: { label: string; tone: string; items: string[] }) {
  const { reduced } = useMotionCtx();
  return (
    <div>
      <p className="eyebrow" style={{ color: tone }}>{label}</p>
      <motion.ul
        className="mt-1 space-y-1"
        variants={reduced ? undefined : rowList}
        initial={reduced ? false : "hidden"}
        whileInView={reduced ? undefined : "show"}
        viewport={{ once: true, amount: 0.3 }}
      >
        {items.map((it, i) => (
          <motion.li key={i} variants={reduced ? undefined : rowItem} className="flex items-baseline gap-1.5 font-body text-sm leading-snug text-ink/85">
            <span style={{ color: tone }}>{label === "Pros" ? "+" : "−"}</span>
            <span>{it}</span>
            <span aria-hidden className="mx-1 min-w-4 flex-1 -translate-y-[3px] border-b border-dotted border-ink/20" />
          </motion.li>
        ))}
      </motion.ul>
    </div>
  );
}

/* ---------------- Myth or Fact — guess-then-reveal flip cards ---------------- */

/** `calls` is per-open session state — owned by Almanac so a tab switch can't discard it. */
function MythSection({
  calls,
  setCalls,
}: {
  calls: Record<number, Verdict>;
  setCalls: React.Dispatch<React.SetStateAction<Record<number, Verdict>>>;
}) {
  const { reduced } = useMotionCtx();
  const audio = useAudio();
  const correct = MYTH_FACTS.reduce((n, m, i) => n + (calls[i] === m.verdict ? 1 : 0), 0);
  const answered = Object.keys(calls).length;

  const guess = (i: number, v: Verdict) => {
    audio.sfx("stamp");
    setCalls((prev) => (prev[i] !== undefined ? prev : { ...prev, [i]: v }));
  };

  return (
    <Section
      title="Myth or Fact?"
      sub="Make your call first — then see whether the thing everyone repeats is actually true."
      aside={
        <span aria-live="polite" className={`border px-2.5 py-1 font-mono text-[0.68rem] uppercase tracking-[0.14em] ${answered ? "border-ink/40 text-ink" : "border-ink/15 text-ink-dim"}`}>
          {/* This said "Called {correct}/8" — the count of RIGHT answers under a word
              that means "answered", so a player who called all eight and got three
              right read it as five unanswered. Progress and score are two facts and
              now say so; the score only appears once there is one. */}
          Called {answered}/{MYTH_FACTS.length}
          {answered > 0 && <span className="text-ink-dim"> · {correct} right</span>}
        </span>
      }
    >
      {MYTH_FACTS.map((m, i) => (
        <Reveal key={i} delay={stepDelay(i, 0.03)}>
          <MythCard item={m} call={calls[i]} onGuess={(v) => guess(i, v)} reduced={reduced} />
        </Reveal>
      ))}
    </Section>
  );
}

function MythCard({ item, call, onGuess, reduced }: { item: MythFact; call: Verdict | undefined; onGuess: (v: Verdict) => void; reduced: boolean }) {
  const revealed = call !== undefined;
  const right = revealed && call === item.verdict;
  const tone = VERDICT_TONE[item.verdict];

  return (
    <article className="border border-hairline bg-bg2" style={{ perspective: 700 }}>
      <div className="border-b border-hairline px-5 py-4">
        <p className="font-body text-[1.05rem] leading-snug text-ink">&ldquo;{item.claim}&rdquo;</p>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {!revealed ? (
          <motion.div
            key="guess"
            exit={reduced ? { opacity: 0 } : { rotateX: 86, opacity: 0 }}
            transition={{ duration: 0.16, ease: "easeIn" }}
            style={{ transformOrigin: "center top" }}
            className="grid grid-cols-3"
          >
            {VERDICTS.map((v, j) => (
              <button
                key={v}
                type="button"
                onClick={() => onGuess(v)}
                className={`px-2 py-3 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-ink-dim transition-colors hover:bg-ink hover:text-bg ${j < 2 ? "border-r border-hairline" : ""}`}
              >
                {v}
              </button>
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="reveal"
            initial={reduced ? { opacity: 0 } : { rotateX: -86, opacity: 0 }}
            animate={{ rotateX: 0, opacity: 1 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            style={{ transformOrigin: "center bottom" }}
            className="px-5 py-4"
          >
            <div className="flex flex-wrap items-center gap-3">
              <motion.span
                initial={reduced ? false : { scale: 1.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.22, ease: EASE, delay: reduced ? 0 : 0.08 }}
                className="border px-2 py-0.5 font-mono text-[0.68rem] uppercase tracking-[0.14em]"
                style={{ color: tone, borderColor: `color-mix(in srgb, ${tone} 40%, transparent)` }}
              >
                {item.verdict}
              </motion.span>
              <span className={`font-mono text-[0.62rem] uppercase tracking-[0.14em] ${right ? "text-ink" : "text-secondary"}`}>
                {right ? "You called it" : `Wrong call — you said ${call}`}
              </span>
            </div>
            <p className="mt-2 font-body text-sm leading-relaxed text-ink/80">{item.explain}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}

/* ---------------- Key Terms — type-in on first open ---------------- */

const TYPE_CHAR_MS = 24;
const TYPE_ROW_STEP_MS = 70;

function TermsSection({ typedRef }: { typedRef: React.MutableRefObject<boolean> }) {
  // type once per overlay visit (flag lives in Almanac so tab switches don't re-run it)
  const shouldType = !typedRef.current;
  useEffect(() => {
    typedRef.current = true;
  }, [typedRef]);

  return (
    <Section title="Terms you should know" sub="The vocabulary that quietly runs your financial life.">
      <div className="grid gap-2.5 sm:grid-cols-2">
        {TERMS.map((t, i) => (
          <Reveal key={t.term} delay={stepDelay(i, 0.02)}>
            <div className="border border-hairline bg-bg2 p-4">
              {/* capped ramp: past a dozen rows the last term would start typing
                  a second after the first, long after the eye arrived */}
              <TypeIn text={t.term} startDelay={stepDelay(i, TYPE_ROW_STEP_MS)} enabled={shouldType} />
              <p className="mt-1 font-body text-sm leading-snug text-ink/85">{t.def}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

function TypeIn({ text, startDelay, enabled }: { text: string; startDelay: number; enabled: boolean }) {
  const { reduced } = useMotionCtx();
  const animate = enabled && !reduced;
  const [shown, setShown] = useState(animate ? 0 : text.length);

  useEffect(() => {
    if (!animate) return;
    let interval = 0;
    const timeout = window.setTimeout(() => {
      interval = window.setInterval(() => {
        setShown((n) => {
          if (n >= text.length) {
            window.clearInterval(interval);
            return n;
          }
          return n + 1;
        });
      }, TYPE_CHAR_MS);
    }, startDelay);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [animate, startDelay, text.length]);

  return (
    <p className="font-mono text-sm font-semibold uppercase tracking-wide text-ink" aria-label={text}>
      <span aria-hidden>{text.slice(0, shown)}</span>
      {shown < text.length && <span aria-hidden className="text-ink-dim">▏</span>}
      {/* hold the line height while empty */}
      {shown === 0 && <span aria-hidden>&nbsp;</span>}
    </p>
  );
}
