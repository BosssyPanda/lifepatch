"use client";

import { type CSSProperties } from "react";
import { AnimatedNumber } from "@/components/story/AnimatedNumber";
import type { AssetDef } from "@/lib/assets";
import { currency } from "@/lib/format";
import type { AssetId } from "@/lib/markets";
import { Sparkline } from "./Sparkline";

const RISK_HEX: Record<string, string> = {
  low: "#7f8b52",
  med: "#c9a24a",
  high: "#c8861e",
  extreme: "#a33218",
};

export function AssetRow({
  asset,
  value,
  pct,
  cash,
  series,
  lastReturn,
  onTrade,
}: {
  asset: AssetDef;
  value: number;
  pct: number;
  cash: number;
  series: number[];
  lastReturn: number | null;
  onTrade: (id: AssetId, dollars: number) => void;
}) {
  const Icon = asset.Icon;
  const riskHex = RISK_HEX[asset.risk];

  // This asset's ceiling = what it already holds + the shared free cash on hand.
  // The slider allocates LIVE: moving it buys/sells against real cash immediately,
  // so spending here shrinks every other row's ceiling in the same tick — two
  // assets can never both claim the same dollars (the old bug where $6k could go
  // into two $6k sliders at once).
  const investable = value + cash;
  const heldPct = investable > 0 ? Math.round((value / investable) * 100) : 0;

  const allocate = (nextPct: number) => {
    const target = Math.round((nextPct / 100) * investable);
    const delta = target - value;
    if (delta !== 0) onTrade(asset.id, delta);
  };

  return (
    <div className="rounded-[4px] border border-ink/12 bg-bg p-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-ink-dim">
          <Icon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
              {asset.short}
            </span>
            <span
              className="eyebrow rounded-[2px] border px-1 py-0.5"
              style={{ color: riskHex, borderColor: `${riskHex}55`, fontSize: "0.52rem" }}
            >
              {asset.risk}
            </span>
          </div>
          {/* the reason to hold it — always visible, no hover required */}
          <p className="mt-1 font-serif text-[0.78rem] leading-snug text-ink-dim">{asset.blurb}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <Sparkline values={series} width={56} height={18} />
            {lastReturn !== null && (
              <span
                className="num text-[0.7rem]"
                style={{ color: lastReturn >= 0 ? "#7f8b52" : "#a33218" }}
              >
                {lastReturn >= 0 ? "+" : ""}
                {lastReturn.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="num text-base text-ink">
            <AnimatedNumber value={value} format={currency} />
          </p>
          <p className="eyebrow text-ink-dim" style={{ fontSize: "0.56rem" }}>
            {pct.toFixed(0)}% of port
          </p>
        </div>
      </div>

      {/* one control: allocate this asset as a share of your free cash + its holding */}
      <div className="mt-2.5">
        <div className="flex items-center gap-2.5">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={heldPct}
            disabled={investable <= 0}
            aria-label={`${asset.short} allocation, ${heldPct}% of available cash`}
            onChange={(e) => allocate(Number(e.target.value))}
            className="allocator flex-1 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
            style={
              {
                "--accent": riskHex,
                "--fill": `${heldPct}%`,
              } as CSSProperties
            }
          />
          <span className="num w-9 shrink-0 text-right text-[0.7rem] tabular-nums text-ink-dim">
            {heldPct}%
          </span>
        </div>
        <div className="mt-1 h-3.5">
          <span className="eyebrow text-ink-dim/70" style={{ fontSize: "0.55rem" }}>
            {cash > 0 ? `${currency(cash)} cash free to allocate` : "fully invested"}
          </span>
        </div>
      </div>
    </div>
  );
}
