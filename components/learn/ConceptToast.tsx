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
    <>
      {/* The announcement lives OUTSIDE the toast, and outside .concept-toast: the toast
          mounts with its text (a live region must pre-exist its content to speak) and
          body[data-ceremony] display:none's .concept-toast, which drops a nested region
          out of the a11y tree. ConceptToast itself is always mounted by the provider, so
          this node is in the DOM from first paint and only its text changes. */}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {concept ? `Concept noted: ${concept.title}` : conceptId ? `Concept noted: ${conceptId}` : ""}
      </span>
      <Toast show={!!conceptId}>
        {/* .concept-toast: hidden while a ceremony owns the screen (body[data-ceremony]) */}
        <div className="concept-toast pointer-events-none flex items-center gap-3 border border-hairline bg-bg2 px-4 py-2.5">
          {/* the moment a lesson lands — the fourth and last chartreuse in the app */}
          <span
            aria-hidden
            className="eyebrow text-highlight"
            style={{ fontSize: "0.55rem", letterSpacing: "0.24em" }}
          >
            ✓ Noted
          </span>
          <span aria-hidden className="h-3.5 w-px bg-hairline" />
          <span aria-hidden className="display-caps text-sm text-ink">{concept?.title ?? conceptId}</span>
        </div>
      </Toast>
    </>
  );
}
