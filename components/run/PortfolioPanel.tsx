"use client";

import { useAudio } from "@/hooks/useAudio";
import { assetsForYear, type AssetDef } from "@/lib/assets";
import { currency } from "@/lib/format";
import type { AssetId } from "@/lib/markets";
import { lastAssetReturn, portfolioValue, priceSeries, type RunState } from "@/lib/runEngine";
import { AssetRow } from "./AssetRow";
import { PortfolioPresets } from "./PortfolioPresets";

/** 18px of visual button, 44px of hit box — vertical only, so neighbours don't overlap. */
const DEBT_HIT = "relative before:absolute before:inset-x-0 before:-inset-y-[13px] before:content-['']";

export function PortfolioPanel({
  run,
  onTrade,
  onPayDebt,
}: {
  run: RunState;
  onTrade: (id: AssetId, dollars: number) => void;
  onPayDebt: (dollars: number) => void;
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

  // Every dollar the player has. The ONE denominator this screen quotes shares against —
  // rows print "% of total" off the same figure, so two readouts can never disagree.
  const total = run.cash + port;
  const cashPct = total > 0 ? (run.cash / total) * 100 : 0;
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
            {cashPct.toFixed(0)}% of total — {(100 - cashPct).toFixed(0)}% invested
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
                <button type="button" data-radius="" disabled={run.cash < 1000} onClick={() => handlePayDebt(1000)} className={`num border border-loss/60 px-1.5 py-0.5 text-[0.6rem] text-loss disabled:opacity-25 enabled:hover:bg-loss enabled:hover:text-bg ${DEBT_HIT}`}>−$1k</button>
                <button type="button" data-radius="" disabled={run.cash <= 0} onClick={() => handlePayDebt(Math.min(run.cash, run.debt))} className={`num border border-loss/60 px-1.5 py-0.5 text-[0.6rem] text-loss disabled:opacity-25 enabled:hover:bg-loss enabled:hover:text-bg ${DEBT_HIT}`}>MAX</button>
              </div>
            )}
          </div>
          <p className="num text-xl text-ink">{currency(run.debt)}</p>
        </div>
      </div>

      {/* one-tap starter mixes — the risk ladder is the lesson */}
      <div className="mt-4">
        <PortfolioPresets availableAssets={assets} cash={run.cash} onApply={handleApplyPreset} />
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
      series={priceSeries(run, assetId)}
      lastReturn={lastAssetReturn(run, assetId)}
      onTrade={onTrade}
    />
  );
}
