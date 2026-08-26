import { PALETTE, INK_TIER as PALETTE_INK_TIER } from "@/lib/palette";
import { liquidNetWorth, netWorth, retirementNumber, type RunState } from "./runEngine";

export type Verdict = {
  title: string;
  blurb: string;
  hex: string;
  good: boolean; // drives outro music + tone
};

/**
 * The six end-of-run archetypes. Defined once so both the live verdict logic
 * and the landing "verdict gallery" social proof read from the same source.
 *
 * Colors follow the LEDGER palette contract (DESIGN.md amendment C): only the two money
 * outcomes carry a hue — "Financially Free" is gain green, "Underwater" is loss red — and
 * every verdict in between is a tier of the ink scale, brighter meaning better. The old
 * SPENT-era olive/amber/brick seal hexes are gone; the worst of them ("Underwater" at
 * #a33218) rendered a headline at 2.8:1 on the near-black ground.
 *
 * Contrast on --color-bg #0e0e0c: ink 17.1:1 · #c9c8bf 11.5:1 · #8f8e85 5.9:1 ·
 * gain 10.0:1 · loss 5.4:1 — every verdict headline clears 4.5:1.
 */
const INK_TIER = { top: PALETTE.ink, mid: PALETTE_INK_TIER.mid, low: PALETTE.secondary } as const;

export const VERDICTS = {
  free: { title: "Financially Free", blurb: "You won the only game that mattered: options. Work became optional well before the end.", hex: PALETTE.gain, good: true },
  comfortable: { title: "Comfortable", blurb: "Not a yacht, but a real cushion. Boring, correct choices compounded into a soft landing.", hex: INK_TIER.top, good: true },
  richEnough: { title: "Rich Enough", blurb: "Modest numbers, high happiness. You optimized for a life, not a spreadsheet. Valid.", hex: INK_TIER.mid, good: true },
  gettingBy: { title: "Getting By", blurb: "You stayed above water. Next run: kill the debt earlier and let the index do the heavy lifting.", hex: INK_TIER.low, good: false },
  underwater: { title: "Underwater", blurb: "The math caught up. Debt and bad timing won this round. The good news: you get to run it back.", hex: PALETTE.loss, good: false },
  estate: { title: "The Estate", blurb: "You can't take it with you — but you can leave it behind. Here's the ledger you left.", hex: INK_TIER.mid, good: false },
} satisfies Record<string, Verdict>;

/**
 * The final class for a run — shared by the outro recap and the report.
 *
 * "Financially Free" asks the game's own retirement question rather than a flat
 * dollar bar, because the two disagreed and the flat bar was the one that lied.
 * `canRetire` — the predicate that decides whether the Retire button is even
 * offered — measures `liquidNetWorth` against 25× a year of expenses, and
 * deliberately excludes home equity: you live in the house, so it cannot fund the
 * years you stop working. `netWorth >= 1_000_000` includes it, and includes it at
 * a threshold that never moves. So a player who owned $1.05M of house and held no
 * liquid assets was handed a verdict reading "work became optional well before the
 * end" for a life in which the game had never once let them stop.
 *
 * The number the run was actually chasing is on screen all along — the report
 * prints `retirementNumber` — and it inflates with the cost of living, which a
 * fixed $1M cannot. Only the money half of `canRetire` is used: its `age >= 60`
 * arm is the ordinary path for a long Infinite run that never got rich, and would
 * hand this verdict to someone broke at sixty.
 */
export function deriveVerdict(run: RunState): Verdict {
  const nw = netWorth(run);
  const happiness = run.life.happiness;
  const died = run.endReason === "died";

  if (died) return VERDICTS.estate;
  if (liquidNetWorth(run) >= retirementNumber(run)) return VERDICTS.free;
  if (nw >= 250_000) return VERDICTS.comfortable;
  if (nw > 0 && happiness >= 60) return VERDICTS.richEnough;
  if (nw > 0) return VERDICTS.gettingBy;
  return VERDICTS.underwater;
}
