"use client";

import { BracketCTA } from "@/components/cinematic/BracketCTA";
import { MODES } from "@/lib/modes";

/**
 * The printed-ledger colophon that closes the title page (spectacle Phase K5)
 * — filing marks, the three modes from lib/modes, and one last bracketed CTA.
 */
export function FooterColophon({ onBegin }: { onBegin: () => void }) {
  return (
    <footer className="border-t border-hairline" aria-label="Colophon">
      {/* final CTA plate */}
      <div className="flex flex-col items-start gap-6 px-5 py-16 sm:px-10 lg:px-16">
        <p className="eyebrow text-secondary">006 — Filing</p>
        <p className="display-caps max-w-2xl text-3xl leading-tight text-ink sm:text-5xl">
          The house is ready when you are.
        </p>
        <BracketCTA label="Begin a Run" onClick={onBegin} />
      </div>

      {/* colophon rails */}
      <div className="grid gap-px border-t border-hairline bg-hairline sm:grid-cols-3">
        {Object.entries(MODES).map(([id, m]) => (
          <div key={id} className="bg-bg px-5 py-4 sm:px-6">
            <p className="eyebrow text-ink" style={{ fontSize: "0.6rem" }}>{m.name}</p>
            <p className="eyebrow mt-1 text-tertiary" style={{ fontSize: "0.52rem" }}>{m.meta}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-5 py-4 sm:px-10 lg:px-16">
        <span className="eyebrow text-tertiary" style={{ fontSize: "0.52rem" }}>
          LIFEPATCH · Form 01 · A Financial Survival Game
        </span>
        <span className="eyebrow text-tertiary" style={{ fontSize: "0.52rem" }}>
          Est. MMXXVI · The house always counts.
        </span>
      </div>
    </footer>
  );
}
