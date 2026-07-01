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
 */
export const VERDICTS = {
  free: { title: "Financially Free", blurb: "You won the only game that mattered: options. Work became optional well before the end.", hex: "#7f8b52", good: true },
  comfortable: { title: "Comfortable", blurb: "Not a yacht, but a real cushion. Boring, correct choices compounded into a soft landing.", hex: "#c9a24a", good: true },
  richEnough: { title: "Rich Enough", blurb: "Modest numbers, high happiness. You optimized for a life, not a spreadsheet. Valid.", hex: "#d4541e", good: true },
  gettingBy: { title: "Getting By", blurb: "You stayed above water. Next run: kill the debt earlier and let the index do the heavy lifting.", hex: "#c8861e", good: false },
  underwater: { title: "Underwater", blurb: "The math caught up. Debt and bad timing won this round. The good news: you get to run it back.", hex: "#a33218", good: false },
  estate: { title: "The Estate", blurb: "You can't take it with you — but you can leave it behind. Here's the ledger you left.", hex: "#a89f8c", good: false },
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
