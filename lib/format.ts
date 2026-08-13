export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * The minus glyph. U+2212 MINUS SIGN, not the hyphen the keyboard gives you: at tabular
 * figure widths a hyphen is visibly short and sits at the wrong height, so a column of
 * negatives looks ragged. Every negative number the app prints comes through here or
 * `percent`, so the glyph is chosen in exactly one place.
 */
const MINUS = "−";

export function currency(n: number): string {
  const sign = n < 0 ? MINUS : "";
  const abs = Math.abs(Math.round(n));
  return `${sign}$${abs.toLocaleString("en-US")}`;
}

/** A signed percentage in house glyphs, e.g. `−22.1%`. */
export function percent(n: number, digits = 1): string {
  const sign = n < 0 ? MINUS : "";
  return `${sign}${Math.abs(n).toFixed(digits)}%`;
}

// `STAT_BOUNDS` / `meterPct` / `statStatus` / `statDisplay` / `freedomScore` lived here
// for the old GameStats meter board and were reachable only from `lib/scoring.ts`,
// which nothing imported. Both are gone; `clamp` / `currency` / `percent` are the
// formatters the game actually uses.
