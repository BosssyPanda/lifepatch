/**
 * Block-glyph sparkline (Addendum A §13 extra #7). Renders a numeric series as
 * mono block glyphs — ▁▂▃▄▅▆▇█ — the most LEDGER chart possible: pure text,
 * tabular, zero motion cost. Colored by trend (gain/loss). `sparkGlyphs` is the
 * string builder, shared with the canvas share card.
 */

const GLYPHS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

export function sparkGlyphs(values: number[], maxPoints = 24): string {
  if (values.length === 0) return "";
  // downsample long series evenly so the strip stays readable
  const pts =
    values.length <= maxPoints
      ? values
      : Array.from({ length: maxPoints }, (_, i) => values[Math.round((i * (values.length - 1)) / (maxPoints - 1))]);
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  return pts.map((v) => GLYPHS[Math.min(GLYPHS.length - 1, Math.floor(((v - min) / range) * GLYPHS.length))]).join("");
}

export function BlockSpark({ values, className = "" }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const up = values[values.length - 1] >= values[0];
  return (
    // role="img" is what makes the aria-label count — on a bare span the label is dropped and
    // the block glyphs get read out one by one. The inner aria-hidden span covers the
    // long-standing Safari/VoiceOver bug where text inside role="img" leaks anyway.
    <span
      role="img"
      className={`num ${className}`}
      style={{ color: up ? "var(--color-gain)" : "var(--color-loss)", letterSpacing: "0.05em", fontSize: "0.8rem", lineHeight: 1 }}
      aria-label={`Net worth trend, ${up ? "up" : "down"}`}
    >
      <span aria-hidden>{sparkGlyphs(values)}</span>
    </span>
  );
}
