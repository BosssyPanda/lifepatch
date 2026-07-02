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

/** Flat cash penalty applied by `applyFtLoss` on a Fast-Track "Setback" square. */
export const FT_LOSS_AMOUNT = 20000;

// Fast-Track "Setback" (ftloss) card copy.
export const FT_SETBACK_TITLE = "Setback";
export const FT_SETBACK_BODY = `A risky venture went sideways. You lose up to ${currency(FT_LOSS_AMOUNT)} — even the wealthy manage risk.`;
export const FT_SETBACK_ACTION = "Take the hit";

// Teaching lines that previously sat inline in the event cards.
export const CHARITY_STRATEGY_NOTE =
  "Generosity here is also strategy: choosing your dice count lets you aim for Opportunity squares and dodge Doodads.";
export const EXPENSE_FREEDOM_NOTE =
  "Life raises the bar to freedom. The more it costs to live, the more passive income you need — plan ahead.";
