"use client";

import { AnimatedNumber } from "@/components/story/AnimatedNumber";
import type { AssetDef } from "@/lib/assets";
import { currency } from "@/lib/format";
import type { AssetId } from "@/lib/markets";

const RISK_HEX: Record<string, string> = {
  low: "#7f8b52",
  med: "#c9a24a",
  high: "#c8861e",
  extreme: "#a33218",
};

const BUY_AMOUNTS = [100, 1000, 10000];
const SELL_AMOUNTS = [100, 1000];

export function AssetRow({
  asset,
  value,
  pct,
  cash,
  onTrade,
}: {
  asset: AssetDef;
  value: number;
  pct: number;
  cash: number;
  onTrade: (id: AssetId, dollars: number) => void;
}) {
  const Icon = asset.Icon;
  return (
    <div className="rounded-[4px] border border-ink/12 bg-bg p-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-ink-dim"><Icon size={20} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-display text-sm font-semibold uppercase tracking-wide text-ink">{asset.short}</span>
            <span className="eyebrow rounded-[2px] border px-1 py-0.5" style={{ color: RISK_HEX[asset.risk], borderColor: `${RISK_HEX[asset.risk]}55`, fontSize: "0.52rem" }}>
              {asset.risk}
            </span>
          </div>
          <p className="font-serif text-[0.72rem] leading-tight text-ink-dim">{asset.blurb}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="num text-base text-ink"><AnimatedNumber value={value} format={currency} /></p>
          <p className="eyebrow text-ink-dim" style={{ fontSize: "0.56rem" }}>{pct.toFixed(0)}% of port</p>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1">
        <span className="eyebrow mr-1 text-olive" style={{ fontSize: "0.55rem" }}>Buy</span>
        {BUY_AMOUNTS.map((a) => (
          <Chip key={`b${a}`} label={`$${a >= 1000 ? `${a / 1000}k` : a}`} disabled={cash < a} accent="#7f8b52" onClick={() => onTrade(asset.id, a)} />
        ))}
        <Chip label="MAX" disabled={cash <= 0} accent="#7f8b52" onClick={() => onTrade(asset.id, cash)} />
        <span className="ml-2 eyebrow mr-1 text-brick" style={{ fontSize: "0.55rem" }}>Sell</span>
        {SELL_AMOUNTS.map((a) => (
          <Chip key={`s${a}`} label={`$${a >= 1000 ? `${a / 1000}k` : a}`} disabled={value < a} accent="#a33218" onClick={() => onTrade(asset.id, -a)} />
        ))}
        <Chip label="MAX" disabled={value <= 0} accent="#a33218" onClick={() => onTrade(asset.id, -value)} />
      </div>
    </div>
  );
}

function Chip({ label, accent, disabled, onClick }: { label: string; accent: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="num rounded-[2px] border px-1.5 py-0.5 text-[0.62rem] transition-colors disabled:opacity-25 enabled:hover:text-bg"
      style={{ color: accent, borderColor: `${accent}66` }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = accent; }}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {label}
    </button>
  );
}
