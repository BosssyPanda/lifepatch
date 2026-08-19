import { currency } from "@/lib/format";

/**
 * Rat Race presentation copy + the shared figures that appear inside it.
 *
 * Content hygiene: scenario/teaching strings that used to live inside screen
 * components are collected here as data, so 100% of player-facing content is
 * data (not hardcoded in the UI). Any money figure quoted in copy derives from
 * the SAME constant the rules engine uses, so the text and the math can never
 * disagree.
 */

/**
 * The floor on a Fast-Track "Setback". The penalty itself is no longer flat — see
 * `ftLossAmount` in the engine. A flat $20,000 was the right size against the old
 * $150k stake and is loose change against a Cash Flow Year, so the square that is
 * supposed to keep the victory lap honest stopped registering; it now costs six
 * months of whatever cash flow the player has built, and never less than this.
 */
export const FT_LOSS_MIN = 20000;

// Fast-Track "Setback" (ftloss) card copy.
export const FT_SETBACK_TITLE = "Setback";
export function ftSetbackBody(amount: number): string {
  return `A risky venture went sideways. It costs you ${currency(amount)} — six months of your cash flow, or ${currency(FT_LOSS_MIN)}, whichever bites harder. Even the wealthy manage risk.`;
}
export const FT_SETBACK_ACTION = "Take the hit";

// Teaching lines that previously sat inline in the event cards.
export const CHARITY_STRATEGY_NOTE =
  "Generosity here is also strategy: choosing your dice count lets you aim for Opportunity squares and dodge Expenses.";
export const EXPENSE_FREEDOM_NOTE =
  "Life raises the bar to freedom. The more it costs to live, the more passive income you need — plan ahead.";
