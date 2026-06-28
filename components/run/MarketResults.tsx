"use client";

import { assetsForYear } from "@/lib/assets";
import { lastAssetReturn, priceSeries, type RunState } from "@/lib/runEngine";
import { Sparkline } from "./Sparkline";

export function MarketResults({ run }: { run: RunState }) {
  if (run.marketLog.length === 0) return null;
  const assets = assetsForYear(run.year);

  return (
    <section aria-label="Market results" className="mx-auto max-w-3xl px-5 py-2">
      <div className="rounded-[5px] border border-ink/12 bg-bg2 p-4">
        <p className="eyebrow text-ink-dim">How each market moved last year</p>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
          {assets.map((a) => {
            const r = lastAssetReturn(run, a.id);
            const Icon = a.Icon;
            const hex = r === null ? "#a89f8c" : r >= 0 ? "#7f8b52" : "#a33218";
            return (
              <div key={a.id} className="flex items-center gap-2">
                <Icon size={16} className="shrink-0 text-ink-dim" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-[0.72rem] font-semibold uppercase tracking-wide text-ink/85">{a.short}</p>
                  <p className="num text-sm" style={{ color: hex }}>
                    {r === null ? "—" : `${r >= 0 ? "+" : ""}${r.toFixed(1)}%`}
                  </p>
                </div>
                <Sparkline values={priceSeries(run, a.id)} width={46} height={18} />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
