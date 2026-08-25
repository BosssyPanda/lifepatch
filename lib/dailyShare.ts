import { dailyFor } from "./daily";
import { currency } from "./format";
import { ghostFor, indexGrid, type GridCell } from "./replay";
import { netWorth, type RunState } from "./runEngine";
import { deriveVerdict } from "./verdict";

/**
 * The daily's share block — the thing a player pastes somewhere.
 *
 * ── What it may say ─────────────────────────────────────────────────────────
 * Not a calendar year, anywhere. The house rule is that the years are the run's
 * own reveal, and a grid that leaked "1999 was the good one" would spoil the
 * puzzle for everyone who has not played it yet. So the grid says only how each of
 * your years went AGAINST YOUR OWN INDEX GHOST — ahead, level, behind.
 *
 * That comparison is what makes it spoiler-safe rather than merely year-less. A
 * crash year in which you fell as far as the market did prints level, not a loss:
 * the row describes your decisions, and the market cancels out of it. Someone
 * reading your grid learns how you played. They learn nothing about what is coming.
 *
 * ── And how it reads ────────────────────────────────────────────────────────
 * Three glyphs that differ in SHAPE, not colour — a filled triangle up, a bar, a
 * filled triangle down. They survive monochrome, a colour-vision deficiency, and
 * every chat client that strips formatting, which no coloured square would.
 */

const GLYPH: Record<GridCell, string> = { ahead: "▲", level: "▬", behind: "▼" };

/** Cells per line. Twenty-one years wrap to 7 · 7 · 7, which reads as a block. */
export const GRID_ROW = 7;

export type DailyShare = {
  /** The whole block, ready to put on a clipboard. */
  text: string;
  /** The grid alone, wrapped, for rendering on screen. */
  rows: GridCell[][];
  cells: GridCell[];
  number: number;
  /** Years the run lived. */
  years: number;
  /**
   * Years the index version did NOT survive to, and so could not be graded.
   *
   * The ghost is subject to the same rules as the life it shadows, and an
   * all-in-the-index allocation does occasionally go insolvent first — about three
   * runs in four hundred. When it does, the grid covers the years there was
   * something to compare against and stops.
   *
   * The count is exposed for the SCREEN, and deliberately kept out of `text`. The
   * player has earned an explanation for why their grid is short. A stranger
   * reading a pasted grid should learn nothing at all about the world behind it,
   * and "the index version went broke in this world" is a fact about the market.
   */
  ungraded: number;
};

/**
 * Null when the run is not a daily, or when its ghost cannot be computed — a run
 * resumed from a save that predates the action log has no counterfactual, and a
 * grid with invented cells is worse than no grid.
 */
export function dailyShare(run: RunState, url?: string): DailyShare | null {
  if (!run.daily || run.status !== "ended") return null;
  const puzzle = dailyFor(run.daily);
  if (!puzzle) return null;
  const ghost = ghostFor(run);
  if (!ghost) return null;

  const cells = indexGrid(run, ghost);
  if (cells.length === 0) return null;

  const rows: GridCell[][] = [];
  for (let i = 0; i < cells.length; i += GRID_ROW) rows.push(cells.slice(i, i + GRID_ROW));

  const verdict = deriveVerdict(run);
  const lines = [
    `LIFEPATCH DAILY #${puzzle.number} — ${verdict.title.toUpperCase()}`,
    currency(Math.round(netWorth(run))),
    "",
    ...rows.map((r) => r.map((c) => GLYPH[c]).join(" ")),
    "",
    "▲ ahead of the index · ▬ level · ▼ behind",
  ];
  if (url) lines.push(url);

  return {
    text: lines.join("\n"),
    rows,
    cells,
    number: puzzle.number,
    years: run.history.length,
    ungraded: run.history.length - cells.length,
  };
}

/** The glyph for one cell, so the on-screen grid and the pasted one cannot drift. */
export function gridGlyph(cell: GridCell): string {
  return GLYPH[cell];
}

/**
 * The grid, said out loud.
 *
 * A screen reader handed the glyphs reads "black up-pointing triangle, black
 * rectangle, black up-pointing triangle" twenty-one times, which is not the
 * information. The shape of the result is: how many years you were ahead, level and
 * behind — so that is what the row is labelled with.
 */
export function gridSummary(cells: GridCell[]): string {
  const n = { ahead: 0, level: 0, behind: 0 };
  for (const c of cells) n[c]++;
  const parts: string[] = [];
  if (n.ahead) parts.push(`${n.ahead} ahead of the index`);
  if (n.level) parts.push(`${n.level} level with it`);
  if (n.behind) parts.push(`${n.behind} behind it`);
  const years = `${cells.length} year${cells.length === 1 ? "" : "s"}`;
  return parts.length ? `${years}: ${parts.join(", ")}.` : `${years}.`;
}
