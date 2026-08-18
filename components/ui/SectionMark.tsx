import type { ReactNode } from "react";

/**
 * `00N — Section Title`, the landing page's editorial folio.
 *
 * Seven of these run down the file, and they are the accent's quietest job: one
 * orange numeral per section, marking where in the document you are standing. The
 * title beside it stays ink-scale — colour marks the POSITION, never the sentence
 * (DESIGN.md § Palette, amendment E). One component so the seven can't drift: the
 * numeral was previously baked into each section's own `<p className="eyebrow">`
 * and there was nothing stopping the eighth from being written differently.
 */
export function SectionMark({
  n,
  children,
  className = "",
}: {
  /** the folio number, already zero-padded — "001" … "007" */
  n: string;
  /** the section title, in the ink scale */
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={`eyebrow text-secondary ${className}`}>
      <span className="text-accent">{n}</span> — {children}
    </p>
  );
}
