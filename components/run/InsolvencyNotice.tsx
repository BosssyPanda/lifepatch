"use client";

import { currency } from "@/lib/format";
import { DEBT_RATE } from "@/lib/economy";
import { insolvencyCountdown, operatingCashFlow, type RunState } from "@/lib/runEngine";

/**
 * The life sim's one terminal warning.
 *
 * `advanceYear` can now end a run that has become unrecoverable — no cash, nothing
 * left to sell, no equity, and a wage that misses the cost of living by more than a
 * sixth before a dollar of interest (see `isUnrecoverable`). That ending is only
 * dignified if it is seen coming, so this prints from the halfway mark of the
 * countdown: several years of notice, the arithmetic that is doing it, and the two
 * things that still reset the clock to zero.
 *
 * Loss red because this is money going wrong, which is the only thing red is allowed
 * to mean (DESIGN.md § Palette), and it carries `▲` so the hue is never the only
 * channel.
 */
export function InsolvencyNotice({ run }: { run: RunState }) {
  const years = insolvencyCountdown(run);
  if (years === null) return null;
  const interest = Math.round(run.debt * DEBT_RATE);
  const shortfall = Math.abs(operatingCashFlow(run));

  return (
    <div
      role="status"
      // Hairline frame + a solid loss left rule — the same construction the report's
      // best/worst cards use. A `border-loss/60` frame was tried first and measured
      // 2.56:1 on bg2, under the 3:1 a warning boundary owes; the solid rule is 5.09:1.
      className="mx-auto mt-4 max-w-3xl border border-hairline border-l-2 border-l-loss bg-bg2 px-4 py-3"
    >
      <p className="eyebrow flex items-center gap-1.5 text-loss" style={{ fontSize: "0.58rem" }}>
        <span aria-hidden>▲</span> The ledger is closing
      </p>
      <p className="mt-1.5 font-body text-[0.9rem] leading-snug text-ink">
        {years === 1 ? "One more year" : `${years} more years`} like this and the run ends on its own.
        A year of your life costs <span className="num text-loss">{currency(shortfall)}</span> more than the
        job brings home, and the balance adds <span className="num text-loss">{currency(interest)}</span> of
        interest on top — with nothing left to sell, the hole can only get deeper.
      </p>
      <p className="voice mt-1.5 text-[0.95rem] leading-snug text-ink-dim">
        Raise what you earn or cut what a year costs and the clock resets to zero.
      </p>
    </div>
  );
}
