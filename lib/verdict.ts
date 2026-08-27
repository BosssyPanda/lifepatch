import { PALETTE, INK_TIER as PALETTE_INK_TIER } from "@/lib/palette";
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
 * The Rat Race's three outcomes.
 *
 * Named here rather than as string literals in `resultFromCashflow`, because these
 * nine strings are now a closed set with a `results_verdict_known` CHECK behind them
 * in supabase/schema.sql. Three sources of truth for one list is two too many:
 * ADDING OR RENAMING A VERDICT MEANS THIS FILE AND A MIGRATION, TOGETHER.
 */
export const CASHFLOW_VERDICTS = {
  escaped: "Escaped the Rat Race",
  racing: "Still Racing",
  buried: "Buried in Debt",
} as const;

/** Every verdict this build can produce. Mirrors `results_verdict_known`. */
export const KNOWN_VERDICTS: ReadonlySet<string> = new Set<string>([
  ...Object.values(VERDICTS).map((v) => v.title),
  ...Object.values(CASHFLOW_VERDICTS),
]);

/**
 * A verdict this build does not recognise is not a verdict.
 *
 * `results.verdict` is written by the client and rendered on an unauthenticated
 * page: it is the <h1> of /r/{id}, the page <title> and og:description, and
 * up-to-118px display type on the OG image. That is not an XSS risk — React escapes
 * the JSX, Next escapes the metadata, and Satori renders text rather than markup —
 * but it let any account mint an official-looking statement on this origin, with a
 * matching unfurl card, which is a ready-made phishing artifact wearing the game's
 * branding.
 *
 * The database now refuses an unknown verdict on the way in. This is the other half:
 * rows written BEFORE that constraint existed are still out there, and a reader that
 * trusts them is trusting a client that no longer exists to have behaved.
 */
export function safeVerdict(verdict: string): string {
  return KNOWN_VERDICTS.has(verdict) ? verdict : "Run Closed";
}

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
