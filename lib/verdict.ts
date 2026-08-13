import { netWorth, type RunState } from "./runEngine";

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
const INK_TIER = { top: "#f2f1ea", mid: "#c9c8bf", low: "#8f8e85" } as const;

export const VERDICTS = {
  free: { title: "Financially Free", blurb: "You won the only game that mattered: options. Work became optional well before the end.", hex: "#2bd576", good: true },
  comfortable: { title: "Comfortable", blurb: "Not a yacht, but a real cushion. Boring, correct choices compounded into a soft landing.", hex: INK_TIER.top, good: true },
  richEnough: { title: "Rich Enough", blurb: "Modest numbers, high happiness. You optimized for a life, not a spreadsheet. Valid.", hex: INK_TIER.mid, good: true },
  gettingBy: { title: "Getting By", blurb: "You stayed above water. Next run: kill the debt earlier and let the index do the heavy lifting.", hex: INK_TIER.low, good: false },
  underwater: { title: "Underwater", blurb: "The math caught up. Debt and bad timing won this round. The good news: you get to run it back.", hex: "#ff3b30", good: false },
  estate: { title: "The Estate", blurb: "You can't take it with you — but you can leave it behind. Here's the ledger you left.", hex: INK_TIER.mid, good: false },
} satisfies Record<string, Verdict>;

/** The final class for a run — shared by the outro recap and the report. */
export function deriveVerdict(run: RunState): Verdict {
  const nw = netWorth(run);
  const happiness = run.life.happiness;
  const died = run.endReason === "died";

  if (died) return VERDICTS.estate;
  if (nw >= 1_000_000) return VERDICTS.free;
  if (nw >= 250_000) return VERDICTS.comfortable;
  if (nw > 0 && happiness >= 60) return VERDICTS.richEnough;
  if (nw > 0) return VERDICTS.gettingBy;
  return VERDICTS.underwater;
}
