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

  // share of total money (cash + invested) still sitting idle as cash
  const total = run.cash + port;
  const cashPct = total > 0 ? (run.cash / total) * 100 : 0;

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
          <p className="eyebrow text-gain">Cash left to invest</p>
          <p className="num text-xl text-ink">{currency(run.cash)}</p>
          {/* fixed-size track + scaling fill: `transition-[width]` was a layout tween
              on a bar that moves on every trade (DESIGN.md § Motion). Same 300ms. */}
          <div className="mt-1.5 h-1 overflow-hidden bg-ink/12" aria-hidden>
            <div
              className="h-full w-full origin-left bg-gain transition-transform duration-300"
              style={{ transform: `scaleX(${Math.max(0, Math.min(100, cashPct)) / 100})` }}
            />
          </div>
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
        Drag each slider to set how much you hold. No ticker tells you what&apos;s next — only risk does.
      </p>

      <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
        {assets.map((a) => (
          <AssetRowWrapper key={a.id} run={run} assetId={a.id} port={port} onTrade={handleTrade} def={a} />
        ))}
      </div>
    </section>
  );
}

function AssetRowWrapper({
  run,
  assetId,
  port,
  def,
  onTrade,
}: {
  run: RunState;
  assetId: AssetId;
  port: number;
  def: AssetDef;
  onTrade: (id: AssetId, dollars: number) => void;
}) {
  const value = run.holdings[assetId] ?? 0;
  const pct = port > 0 ? (value / port) * 100 : 0;
  return (
    <AssetRow
      asset={def}
      value={value}
      pct={pct}
      cash={run.cash}
      series={priceSeries(run, assetId)}
      lastReturn={lastAssetReturn(run, assetId)}
      onTrade={onTrade}
    />
  );
}
