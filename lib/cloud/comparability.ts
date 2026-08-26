import { RUN_VERSION } from "../runEngine";
import type { GameMode } from "./types";

/**
 * What makes two scores comparable, in one leaf module.
 *
 * This lives here rather than in `buildResult` for the same reason `lib/economy.ts`
 * exists: `buildResult` already imports `results`, so `results` importing back the
 * other way would be a cycle with a live temporal-dead-zone hazard. The WRITER of a
 * score and the READER of a board both need the same marker, and neither is the
 * natural owner of it — so neither owns it.
 *
 * A version bump on either axis means "runs before this point were produced under
 * different rules". Until now that was written onto every row and read by nothing
 * (`metrics.scoreVersion` had zero readers in the entire repo; `metrics.engine` was
 * printed on the share page but never filtered on), so a board happily ranked a run
 * scored under a broken economy above one scored under the fixed economy. The marker
 * only means something if something enforces it — `topResults` does.
 */

/**
 * Rat Race score format. See `cashflowScore` for what each version measured and why
 * the previous one had to be abandoned.
 *   1 → 2: passive income alone was blind to debt, so leverage was the optimal play.
 *   2 → 3: nothing subtracted the starting balance sheet, so profession choice
 *          outranked play — the Janitor opens $469,250 ahead of the Doctor.
 */
export const CASHFLOW_SCORE_VERSION = 3;

/**
 * The `metrics` key and value a row of this mode must carry to be ranked today.
 *
 * The Rat Race and the life sim version independently — they are different engines
 * with different score formulas — so the key differs by mode rather than one global
 * marker standing for both.
 */
export function comparabilityMarker(mode: GameMode): { key: string; value: string } {
  return mode === "cashflow"
    ? { key: "scoreVersion", value: String(CASHFLOW_SCORE_VERSION) }
    : { key: "engine", value: String(RUN_VERSION) };
}
