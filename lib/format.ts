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

/**
 * The glyph for a figure that is not a figure.
 *
 * The app already prints an em dash wherever a number is genuinely absent — no
 * market year yet, a peer who has not reported, no single worst hit. A value that
 * arrived as `NaN` or `Infinity` is making the same statement and earns the same
 * glyph, because the alternative is what the unguarded formatters did:
 * `NaN.toLocaleString("en-US")` is the string `"NaN"`, so a bad number printed as
 * `$NaN` — including at 84px in the generated OG image.
 */
const NO_FIGURE = "—";

export function currency(n: number): string {
  // Guarded HERE, at the formatter, rather than at each of the ~167 call sites.
  // `results.score` is a client-written `numeric` and `results.metrics` is
  // client-written `jsonb`, so a forged row can aim a non-finite value at the
  // leaderboard, the public statement page and the OG image alike. Such a row is
  // refused at the database (the `results_score_sane` CHECK) and dropped at the
  // data layer (lib/cloud/results.ts); this is the backstop that covers every
  // other surface at once, including rows written before the constraint landed.
  if (!Number.isFinite(n)) return NO_FIGURE;
  const sign = n < 0 ? MINUS : "";
  const abs = Math.abs(Math.round(n));
  return `${sign}$${abs.toLocaleString("en-US")}`;
}

/** A signed percentage in house glyphs, e.g. `−22.1%`. */
export function percent(n: number, digits = 1): string {
  // Same reasoning as `currency`: `NaN.toFixed(1)` is the string "NaN", so an
  // unguarded percentage reads "NaN%" instead of admitting it has no figure.
  if (!Number.isFinite(n)) return NO_FIGURE;
  const sign = n < 0 ? MINUS : "";
  return `${sign}${Math.abs(n).toFixed(digits)}%`;
}

// `STAT_BOUNDS` / `meterPct` / `statStatus` / `statDisplay` / `freedomScore` lived here
// for the old GameStats meter board and were reachable only from `lib/scoring.ts`,
// which nothing imported. Both are gone; `clamp` / `currency` / `percent` are the
// formatters the game actually uses.
