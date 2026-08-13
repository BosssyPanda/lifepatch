"use client";

import { Toast } from "@/components/cashflow/shared";
import { getConcept } from "@/lib/concepts";

/**
 * LEDGER concept-logged toast (presentation layer).
 *
 * Rendering was moved out of `hooks/useConceptLearn.tsx` so the hook stays
 * logic-only. Per the rebrand brief §3.3 this drops the school-y
 * "You just learned" label and the brain-icon badge: it now reads as a quiet
 * ledger note that a concept was filed — mono, squared, hairline, no emoji.
 */
export function ConceptToast({ conceptId }: { conceptId: string | null }) {
  const concept = conceptId ? getConcept(conceptId) : undefined;
  return (
    <Toast show={!!conceptId}>
      {/* .concept-toast: hidden while a ceremony owns the screen (body[data-ceremony]) */}
      <div className="concept-toast pointer-events-none flex items-center gap-3 border border-hairline bg-bg2 px-4 py-2.5" aria-live="polite">
        {/* The chip exists to tell you something was filed — say it in words rather
            than leaving a screen reader to assemble "Noted" + a bare title. */}
        <span className="sr-only">Concept noted: {concept?.title ?? conceptId}</span>
        <span
          aria-hidden
          className="eyebrow text-secondary"
          style={{ fontSize: "0.55rem", letterSpacing: "0.24em" }}
        >
          Noted
        </span>
        <span aria-hidden className="h-3.5 w-px bg-hairline" />
        <span aria-hidden className="display-caps text-sm text-ink">{concept?.title ?? conceptId}</span>
      </div>
    </Toast>
  );
}
