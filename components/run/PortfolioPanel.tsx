"use client";

import { useAudio } from "@/hooks/useAudio";
import { ArmedLabel, useArmedAction } from "@/components/ui/useArmedAction";
import { assetsForYear, type AssetDef } from "@/lib/assets";
import { currency } from "@/lib/format";
import type { AssetId } from "@/lib/markets";
import {
  homeEquity,
  homeSaleProceeds,
  lastAssetReturn,
  portfolioValue,
  priceSeries,
  type RunState,
} from "@/lib/runEngine";
import { AssetRow } from "./AssetRow";
import { PortfolioPresets } from "./PortfolioPresets";

/** 18px of visual button, 44px of hit box — vertical only, so neighbours don't overlap. */
const DEBT_HIT = "relative before:absolute before:inset-x-0 before:-inset-y-[13px] before:content-['']";

export function PortfolioPanel({
  run,
  onTrade,
  onPayDebt,
  onSellHome,
}: {
  run: RunState;
  onTrade: (id: AssetId, dollars: number) => void;
  onPayDebt: (dollars: number) => void;
  onSellHome: () => void;
}) {
  const audio = useAudio();
  const assets = assetsForYear(run.year);
  const port = portfolioValue(run);

  // One committed interaction = one trade = one sound. The rows stage their dollars
  // locally and call this exactly once, on release (see AssetRow) — this used to fire on
  // every `input` event, so a slow drag stacked ~100 overlapping SFX voices.
  const handleTrade = (id: AssetId, dollars: number) => {
    audio.sfx(dollars >= 0 ? "coins" : "cash");
    onTrade(id, dollars);
  };
  const handlePayDebt = (dollars: number) => {
    audio.sfx("stamp");
    onPayDebt(dollars);
  };
  const handleApplyPreset = (orders: Array<[AssetId, number]>) => {
    audio.sfx("confirm");
    for (const [id, dollars] of orders) onTrade(id, dollars);
  };

  /**
   * The house, and the way out of it.
   *
   * Until now a run could see its home ONLY as the word "Homeowner" in the HUD
   * drawer — its value, its mortgage and its equity appeared nowhere, while the net
   * worth on screen silently included the equity. And there was no way to sell:
   * `housing` was written in three places and reversed in none, which is why
   * `isUnrecoverable` refuses the insolvency ending to any homeowner and why a long
   * Infinite run eventually spends more on upkeep than it earns with no lever left
   * but ADVANCE.
   *
   * `net` is what the sale actually hands over — the price less selling costs, less
   * the mortgage — and it can be NEGATIVE. Underwater, selling clears the house and
   * moves the shortfall onto the unsecured balance at 7%. The confirm has to say so,
   * because "sell" reads as "receive money" and here it sometimes is not.
   */
  const owned = run.life.housing === "owned";
  const net = owned ? homeSaleProceeds(run) : 0;
  const sell = useArmedAction({
    label: "Sell",
    armedLabel:
      net >= 0 ? `Tap again — ${currency(net)} to you` : `Tap again — adds ${currency(-net)} of debt`,
    onArm: () => audio.sfx("uitick"),
    onConfirm: () => {
      audio.sfx("stamp");
      onSellHome();
    },
  });

  // Every dollar the player has. The ONE denominator this screen quotes shares against —
  // rows print "% of total" off the same figure, so two readouts can never disagree.
  const total = run.cash + port;
  // The cash/invested split is quoted against the money that actually exists, not
  // against `total`: a mid-year overspend makes `total` zero or negative, and
  // `total > 0 ? … : 0` then printed "0% of total — 100% invested" to a player
  // holding nothing at all. `pot` can only be zero when there is genuinely nothing
  // to split, which is the one case the caption below refuses to quote a share for.
  const pot = Math.max(0, run.cash) + port;
  const cashPct = pot > 0 ? (Math.max(0, run.cash) / pot) * 100 : 0;
  // A mid-year choice can spend past the balance; the engine only converts that
  // shortfall into debt when the year advances. Until then cash is genuinely
  // negative, and printing it as a budget reads as "-$2,500 free to allocate".
  // There is nothing free to allocate — say what is actually true instead.
  const shortfall = run.cash < 0 ? -run.cash : 0;

  return (
    <section aria-label="Portfolio" className="mx-auto max-w-3xl px-5 py-4">
      <div className="flex items-center justify-between border-b border-hairline pb-2">
        {/* h2, not h3: this is a top-level section of the run screen, and the screen's h1
            lives in YearLoop — an h3 here skips a level in the document outline. */}
        <h2 className="display-caps text-xl text-ink">Your money</h2>
        <span className="num text-sm text-ink-dim">invested {currency(port)}</span>
      </div>

      {/* cash-left readout + debt tile */}
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <div className="border border-hairline bg-bg px-3 py-2.5">
          <p className="eyebrow text-gain">Cash on hand</p>
          <p className="num text-xl text-ink">{currency(run.cash)}</p>
          {/* fixed-size track + scaling fill: `transition-[width]` was a layout tween
              on a bar that moves on every trade (DESIGN.md § Motion). Same 300ms.
              The fill is the cash share and the caption states that same number: the bar
              used to read as progress toward being invested while measuring the opposite. */}
          <div className="mt-1.5 h-1 overflow-hidden bg-ink/12" aria-hidden>
            <div
              className="h-full w-full origin-left bg-gain transition-transform duration-300"
              style={{ transform: `scaleX(${Math.max(0, Math.min(100, cashPct)) / 100})` }}
            />
          </div>
          <p className="eyebrow mt-1 tabular-nums text-tertiary" style={{ fontSize: "0.55rem" }}>
            {pot > 0
              ? `${cashPct.toFixed(0)}% of total — ${(100 - cashPct).toFixed(0)}% invested`
              : "nothing invested yet"}
          </p>
        </div>
        <div className="border border-hairline bg-bg px-3 py-2.5">
          <div className="flex items-center justify-between">
            <p className="eyebrow text-loss">Debt</p>
            {/* The smallest targets in the app (~28×18) — vertical hit expansion to 44px,
                no horizontal bleed so the two never steal each other's taps. And the hover
                fill is `enabled:` scoped: a disabled MAX used to go solid red under the
                cursor while still refusing the click. */}
            {run.debt > 0 && (
              <div className="flex gap-1.5">
                <button type="button" data-radius="" disabled={run.cash < 1000} onClick={() => handlePayDebt(1000)} className={`num border border-hairline-strong px-1.5 py-0.5 text-[0.6rem] text-loss disabled:opacity-25 enabled:hover:bg-loss enabled:hover:text-bg ${DEBT_HIT}`}>−$1k</button>
                <button type="button" data-radius="" disabled={run.cash <= 0} onClick={() => handlePayDebt(Math.min(run.cash, run.debt))} className={`num border border-hairline-strong px-1.5 py-0.5 text-[0.6rem] text-loss disabled:opacity-25 enabled:hover:bg-loss enabled:hover:text-bg ${DEBT_HIT}`}>MAX</button>
              </div>
            )}
          </div>
          <p className="num text-xl text-ink">{currency(run.debt)}</p>
        </div>
      </div>

      {/* The house. Structurally the twin of the Debt tile above — a figure, and a
          small bordered control in the header — but full width, because it carries
          three numbers rather than one and because a sale is the largest single
          thing a player can do on this screen.

          DESIGN.md § Palette: "orange never grades an outcome — a 'sell' button does
          not turn orange because the sale is profitable". So the control is loss-red
          armed and ink at rest, and it is the SAME red whether the sale pays out or
          costs; only the equity figure below carries gain/loss, because that is the
          number being graded. `reserve` is passed because the armed label is far
          longer than "Sell" and this control shares its row with the heading. */}
      {owned && (
        <div className="mt-2.5 border border-hairline bg-bg px-3 py-2.5">
          <div className="flex items-center justify-between">
            <p className="eyebrow text-secondary">Home</p>
            <button
              type="button"
              data-radius=""
              onClick={sell.onClick}
              onBlur={sell.onBlur}
              className={`num border px-1.5 py-0.5 text-[0.6rem] transition-colors ${DEBT_HIT} ${
                sell.armed
                  ? "border-loss bg-loss text-bg"
                  : "border-hairline-strong text-ink hover:border-loss hover:text-loss"
              }`}
            >
              {/* `align="end"` — the control is anchored to the right edge of the
                  row, so at rest "Sell" stays exactly where it sits and the long
                  armed label grows inwards instead of shoving the heading. */}
              <ArmedLabel reserve={sell.reserve} align="end">
                {sell.label}
              </ArmedLabel>
            </button>
          </div>
          <p className="num text-xl text-ink">{currency(run.homeValue)}</p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
            <span className="eyebrow tabular-nums text-tertiary" style={{ fontSize: "0.55rem" }}>
              mortgage {currency(run.mortgage)}
            </span>
            <span
              className={`eyebrow tabular-nums ${homeEquity(run) >= 0 ? "text-tertiary" : "text-loss"}`}
              style={{ fontSize: "0.55rem" }}
            >
              equity {currency(homeEquity(run))}
            </span>
            {/* Selling costs ~6% off the top, so the equity figure and the payout are
                never the same number. Printing only one of them would make whichever
                was missing feel like a deduction nobody mentioned. */}
            <span
              className={`eyebrow tabular-nums ${net >= 0 ? "text-tertiary" : "text-loss"}`}
              style={{ fontSize: "0.55rem" }}
            >
              {net >= 0 ? `sells for ${currency(net)} after costs` : `sale leaves ${currency(-net)} owing`}
            </span>
          </div>
        </div>
      )}

      {/* one-tap starter mixes — the risk ladder is the lesson */}
      <div className="mt-4">
        <PortfolioPresets availableAssets={assets} cash={run.cash} invested={port} onApply={handleApplyPreset} />
      </div>

      <p className="voice mt-4 text-sm text-ink-dim">
        Every slider spends the same pot. Set the dollars you want in each — the trade lands when you
        let go. No ticker tells you what&apos;s next; only risk does.
      </p>

      {/* ONE shared budget line for the whole grid. It used to be reprinted under all six
          rows, which read as six separate budgets when there is a single pool. */}
      <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-y border-hairline py-1.5">
        <p className="eyebrow text-tertiary">
          {shortfall > 0 ? (
            <>
              <span className="num text-loss">{currency(shortfall)}</span> overspent — becomes debt when the year advances
            </>
          ) : (
            <>
              <span className="num text-ink">{currency(run.cash)}</span> cash free to allocate
            </>
          )}
        </p>
        <p className="eyebrow text-tertiary">
          total <span className="num text-ink-dim">{currency(total)}</span>
        </p>
      </div>

      <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
        {assets.map((a) => (
          <AssetRowWrapper key={a.id} run={run} assetId={a.id} total={total} onTrade={handleTrade} def={a} />
        ))}
      </div>
    </section>
  );
}

function AssetRowWrapper({
  run,
  assetId,
  total,
  def,
  onTrade,
}: {
  run: RunState;
  assetId: AssetId;
  /** cash + everything invested — the single denominator every row quotes against */
  total: number;
  def: AssetDef;
  onTrade: (id: AssetId, dollars: number) => void;
}) {
  return (
    <AssetRow
      asset={def}
      value={run.holdings[assetId] ?? 0}
      total={total}
      cash={run.cash}
      /* The year an open gesture belongs to. In a match the clock can turn it under
         the player's finger; the dollars they were staging were an answer to LAST
         year's ledger, so they are dropped rather than posted into the new one. */
      year={run.year}
      series={priceSeries(run, assetId)}
      lastReturn={lastAssetReturn(run, assetId)}
      onTrade={onTrade}
    />
  );
}
