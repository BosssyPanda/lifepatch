/**
 * What each board's number actually is.
 *
 * The Rat Race score stopped being passive income at the v2 rebalance — it is
 * `netWorth + 12 × payday` (`lib/cloud/buildResult.ts`), a balance-sheet figure
 * plus a year of realized cash flow. Four surfaces went on calling it "passive
 * income" anyway, and two of them printed it with a `/mo` suffix, which turned a
 * lump sum into a monthly wage on screen. `DESIGN.md` § Data honesty: a number is
 * labelled as the thing it is.
 *
 * One home for the words, so they cannot drift from the formula a second time.
 * Deliberately dependency-free — the OG image route runs on the edge and reads the
 * result row over REST, so it must be able to import this without the engine.
 */

/** Heading for the score itself — a stat row, an OG plate, a card. */
export function scoreLabel(mode: string): string {
  return mode === "cashflow" ? "Rat Race score" : "Final net worth";
}

/** The phrase that completes "ranked by …". Lower case, no article. */
export function scoreMetric(mode: string): string {
  return mode === "cashflow" ? "net worth plus a year of cash flow" : "net worth";
}

/** The same figure, named as a player's record rather than one run's result. */
export function bestLabel(mode: string): string {
  return mode === "cashflow" ? "Best Rat Race score" : "Best net worth";
}
