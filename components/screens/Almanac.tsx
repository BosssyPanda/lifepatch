"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { CloseIcon } from "@/components/icons";
import { Reveal } from "@/components/ui/Reveal";
import {
  ALMANAC_SECTIONS,
  GEOPOLITICS,
  MYTH_FACTS,
  TERMS,
  WEALTH_METHODS,
  type AlmanacSectionId,
} from "@/lib/almanac";

const VERDICT_HEX: Record<string, string> = { Myth: "#a33218", Fact: "#7f8b52", "It depends": "#c8861e" };

export function Almanac({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [section, setSection] = useState<AlmanacSectionId>("wealth");

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex flex-col bg-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          {/* header + tabs */}
          <div className="sticky top-0 z-10 border-b border-ink/12 bg-bg/95 backdrop-blur-md">
            <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3">
              <div>
                <p className="eyebrow text-accent">The Almanac</p>
                <h1 className="display-caps text-2xl text-ink">Know the game</h1>
              </div>
              <button type="button" onClick={onClose} aria-label="Close almanac" className="rounded-[3px] border border-ink/20 p-2 text-ink-dim transition-colors hover:border-accent hover:text-accent">
                <CloseIcon size={18} />
              </button>
            </div>
            <div className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-5 pb-2 thin-scroll">
              {ALMANAC_SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  className={`shrink-0 rounded-[3px] border px-3 py-1.5 eyebrow transition-colors ${section === s.id ? "border-accent bg-accent text-bg" : "border-ink/20 text-ink-dim hover:text-ink"}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* content */}
          <div className="thin-scroll flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl px-5 py-8">
              {section === "wealth" && (
                <Section title="Ways to build wealth" sub="Every path has a price. Here's the honest trade-off on each.">
                  {WEALTH_METHODS.map((m, i) => (
                    <Reveal key={m.name} delay={i * 0.03}>
                      <article className="rounded-[5px] border border-ink/12 bg-bg2 p-5">
                        <h3 className="display-caps text-xl text-ink">{m.name}</h3>
                        <p className="mt-1 font-serif text-sm italic text-ink-dim">{m.how}</p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <List label="Pros" hex="#7f8b52" items={m.pros} />
                          <List label="Cons" hex="#a33218" items={m.cons} />
                        </div>
                      </article>
                    </Reveal>
                  ))}
                </Section>
              )}

              {section === "myths" && (
                <Section title="Myth or Fact?" sub="The stuff everyone repeats — and whether it's actually true.">
                  {MYTH_FACTS.map((m, i) => (
                    <Reveal key={i} delay={i * 0.03}>
                      <article className="rounded-[5px] border border-ink/12 bg-bg2 p-5">
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-serif text-[1.05rem] leading-snug text-ink">&ldquo;{m.claim}&rdquo;</p>
                          <span className="shrink-0 rounded-[3px] border px-2 py-0.5 eyebrow" style={{ color: VERDICT_HEX[m.verdict], borderColor: `${VERDICT_HEX[m.verdict]}66` }}>{m.verdict}</span>
                        </div>
                        <p className="mt-2 font-serif text-sm leading-relaxed text-ink/80">{m.explain}</p>
                      </article>
                    </Reveal>
                  ))}
                </Section>
              )}

              {section === "geo" && (
                <Section title="Geopolitics & the economy" sub="How a crisis on one side of the world reaches your wallet on the other.">
                  {GEOPOLITICS.map((g, i) => (
                    <Reveal key={i} delay={i * 0.03}>
                      <article className="rounded-[5px] border border-ink/12 bg-bg2 p-5">
                        <h3 className="display-caps text-lg text-accent">{g.situation}</h3>
                        <p className="mt-3 eyebrow text-ink-dim">The ripple</p>
                        <ol className="mt-1 space-y-1">
                          {g.ripple.map((r, j) => (
                            <li key={j} className="flex gap-2 font-serif text-sm text-ink/85">
                              <span className="num text-ink-dim">{j + 1}.</span> {r}
                            </li>
                          ))}
                        </ol>
                        <p className="mt-3 border-l-2 border-ochre pl-3 font-serif text-sm italic text-ink/85">{g.everyone}</p>
                        <div className="mt-3 border-t border-ink/10 pt-3">
                          <p className="eyebrow text-olive">How to protect yourself</p>
                          <p className="mt-1 font-serif text-sm leading-relaxed text-ink/85">{g.mitigation}</p>
                        </div>
                      </article>
                    </Reveal>
                  ))}
                </Section>
              )}

              {section === "terms" && (
                <Section title="Terms you should know" sub="The vocabulary that quietly runs your financial life.">
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {TERMS.map((t, i) => (
                      <Reveal key={t.term} delay={i * 0.02}>
                        <div className="rounded-[4px] border border-ink/12 bg-bg2 p-4">
                          <p className="font-display text-sm font-semibold uppercase tracking-wide text-accent">{t.term}</p>
                          <p className="mt-1 font-serif text-sm leading-snug text-ink/85">{t.def}</p>
                        </div>
                      </Reveal>
                    ))}
                  </div>
                </Section>
              )}

              <p className="mt-10 text-center font-serif text-xs italic text-ink-dim">
                Educational only — not financial advice. It&apos;s a game, but the lessons are real.
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Section({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="display-caps text-3xl text-ink">{title}</h2>
      <p className="mt-1 font-serif italic text-ink-dim">{sub}</p>
      <div className="mt-5 space-y-3">{children}</div>
    </div>
  );
}

function List({ label, hex, items }: { label: string; hex: string; items: string[] }) {
  return (
    <div>
      <p className="eyebrow" style={{ color: hex }}>{label}</p>
      <ul className="mt-1 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex gap-1.5 font-serif text-sm leading-snug text-ink/85">
            <span style={{ color: hex }}>{label === "Pros" ? "+" : "−"}</span> {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
