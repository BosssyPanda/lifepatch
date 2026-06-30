"use client";

import { useAudio } from "@/hooks/useAudio";
import { assetsForYear, type AssetDef } from "@/lib/assets";
import { currency } from "@/lib/format";
import type { AssetId } from "@/lib/markets";
import { lastAssetReturn, portfolioValue, priceSeries, type RunState } from "@/lib/runEngine";
import { AssetRow } from "./AssetRow";
import { PortfolioPresets } from "./PortfolioPresets";

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
      <div className="flex items-center justify-between border-b border-ink/12 pb-2">
        <h3 className="display-caps text-xl text-ink">Your money</h3>
        <span className="num text-sm text-ink-dim">invested {currency(port)}</span>
      </div>

      {/* cash-left readout + debt tile */}
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <div className="rounded-[4px] border border-ink/12 bg-bg px-3 py-2.5">
          <p className="eyebrow text-olive">Cash left to invest</p>
          <p className="num text-xl text-ink">{currency(run.cash)}</p>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/12" aria-hidden>
            <div className="h-full rounded-full bg-olive transition-[width] duration-300" style={{ width: `${cashPct}%` }} />
          </div>
        </div>
        <div className="rounded-[4px] border border-ink/12 bg-bg px-3 py-2.5">
          <div className="flex items-center justify-between">
            <p className="eyebrow text-brick">Debt</p>
            {run.debt > 0 && (
              <div className="flex gap-1">
                <button type="button" disabled={run.cash < 1000} onClick={() => handlePayDebt(1000)} className="num rounded-[2px] border border-brick/60 px-1.5 py-0.5 text-[0.6rem] text-brick disabled:opacity-25 hover:bg-brick hover:text-bg">−$1k</button>
                <button type="button" disabled={run.cash <= 0} onClick={() => handlePayDebt(Math.min(run.cash, run.debt))} className="num rounded-[2px] border border-brick/60 px-1.5 py-0.5 text-[0.6rem] text-brick disabled:opacity-25 hover:bg-brick hover:text-bg">MAX</button>
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

      <p className="mt-4 font-serif text-sm italic text-ink-dim">
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
