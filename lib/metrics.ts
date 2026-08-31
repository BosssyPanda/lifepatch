/**
 * Reading `results.metrics`, which is written by clients and trusted by nobody.
 *
 * Every field on a result row arrives as jsonb that some other player's browser
 * produced. The rows are additionally OLD: constraints landed over time and some
 * arrived `NOT VALID` (`results_metrics_history_bounded`), so rows predating them
 * are still out there and still get read. Three separate readers — the public
 * statement page, the challenge gate and the report — were each doing their own
 * coercion, and each got it wrong in its own way. This is the one place that
 * knows how.
 */

/**
 * A number that is actually a number.
 *
 * `Number(v)` is far too generous to read untrusted json with: `Number(null)`,
 * `Number("")`, `Number(" ")`, `Number([])` and `Number(true)` are ALL finite, so
 * the idiomatic-looking `Number.isFinite(Number(v))` waves through exactly the
 * malformed values it appears to guard against. A `"seed": null` became seed 0 —
 * a real, playable world with nothing to do with the statement that was clicked.
 */
export function finiteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * The longest series any reader will accept.
 *
 * `resultFromRun` caps what it WRITES at 100 points, and the database has bounded
 * the column since the result-integrity migration — but that constraint is
 * `NOT VALID`, so it was never applied to the rows already in the table. 200 is
 * twice the longest honest run, and the cap matters on both sides: a chart with
 * 100,000 points is a hung tab, and a challenge carrying one overflows the 5MB
 * localStorage budget on `writeChallenge` — whose failure is swallowed, so the
 * run starts on the right world and then finds no rival at the report.
 */
export const MAX_SERIES = 200;

/**
 * A per-year money series, or null if it cannot be trusted.
 *
 * All-or-nothing, deliberately. Filtering the bad elements out COMPACTS the
 * series and slides every later year one place left — and both the chart and the
 * grid read it positionally, so a single hole re-dates every year after it and
 * grades the player against the wrong one. There is no honest way to draw a
 * series with a gap in it, so a series with a gap is not drawn.
 *
 * Validated WHOLE and capped afterwards, in that order. Capping first would let a
 * malformed element past the end of the cap be sliced away rather than reject the
 * row, which is a quieter rule than the one stated above and not the one intended.
 *
 * `capped` is returned rather than swallowed because a caller that says where a
 * line "ends" would otherwise be reporting where OUR limit stopped as where the
 * run did — the same false claim `ghostOutlastsRun` exists to prevent on the
 * report's rival chart.
 */
export function finiteSeries(
  v: unknown,
  cap: number = MAX_SERIES,
): { series: number[]; capped: boolean } | null {
  if (!Array.isArray(v)) return null;
  if (!v.every(finiteNumber)) return null;
  return { series: v.slice(0, cap) as number[], capped: v.length > cap };
}
