"use client";

import { VERDICTS } from "@/lib/verdict";
import { Marquee } from "./Marquee";

/**
 * Landing set piece 006 — "SIX WAYS THIS ENDS" (spectacle Phase K4a).
 * The six real end-of-run archetypes from lib/verdict, dealt as split-flap
 * style plates on an infinite marquee. Each keeps its sanctioned seal hex
 * (the one archetype-color exception to the LEDGER palette).
 */

const ENTRIES = Object.entries(VERDICTS);

function VerdictCard({ i, title, blurb, hex, good }: { i: number; title: string; blurb: string; hex: string; good: boolean }) {
  return (
    <article className="flex w-[300px] shrink-0 flex-col border border-hairline bg-bg2 p-5 sm:w-[340px]">
      <div className="flex items-baseline justify-between border-b border-hairline pb-2.5">
        <span className="eyebrow text-tertiary">Verdict {String(i + 1).padStart(2, "0")}/0{ENTRIES.length}</span>
        <span
          className="eyebrow border px-1.5 py-0.5"
          style={{
            fontSize: "0.52rem",
            color: good ? "var(--color-gain)" : "var(--color-loss)",
            borderColor: "var(--color-hairline)",
          }}
        >
          {good ? "Good ending" : "Hard ending"}
        </span>
      </div>
      {/* flap plate: seam line through the title, Solari-style */}
      <div className="relative mt-4 w-fit">
        <p className="font-anton text-2xl leading-none sm:text-3xl" style={{ color: hex }}>
          {title.toUpperCase()}
        </p>
        <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-bg2/80" aria-hidden />
      </div>
      <p className="mt-3 font-body text-sm leading-relaxed text-ink-dim">{blurb}</p>
    </article>
  );
}

export function VerdictWall() {
  return (
    <section className="border-t border-hairline py-20" aria-labelledby="verdicts-heading">
      <div className="px-5 sm:px-10 lg:px-16">
        <p className="eyebrow text-secondary">006 — The Endings</p>
        <h2 id="verdicts-heading" className="display-caps mt-3 text-3xl text-ink sm:text-5xl">
          Six ways this ends.
        </h2>
        <p className="mt-3 max-w-md font-body text-sm leading-relaxed text-ink-dim">
          Every run closes with one word from the house. The same six verdicts the game actually hands down —
          nothing aspirational about it.
        </p>
      </div>
      <div className="mt-10 border-y border-hairline py-4">
        <Marquee seconds={55} ariaLabel="The six run verdicts">
          {ENTRIES.map(([id, v], i) => (
            <VerdictCard key={id} i={i} title={v.title} blurb={v.blurb} hex={v.hex} good={v.good} />
          ))}
        </Marquee>
      </div>
    </section>
  );
}
