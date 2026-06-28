"use client";

import { AnimatedNumber } from "@/components/story/AnimatedNumber";
import { InfoIcon } from "@/components/icons";
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

const BUY_AMOUNTS = [100, 1000, 10000];
const SELL_AMOUNTS = [100, 1000, 10000];

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
  return (
    <div className="rounded-[4px] border border-ink/12 bg-bg p-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-ink-dim"><Icon size={20} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-display text-sm font-semibold uppercase tracking-wide text-ink">{asset.short}</span>
            <span className="eyebrow rounded-[2px] border px-1 py-0.5" style={{ color: riskHex, borderColor: `${riskHex}55`, fontSize: "0.52rem" }}>
              {asset.risk}
            </span>
            {/* hover tooltip */}
            <span className="group/info relative inline-flex">
              <button type="button" aria-label={`About ${asset.name}`} className="text-ink-dim/60 hover:text-accent">
                <InfoIcon size={13} />
              </button>
              <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-52 -translate-x-1/2 rounded-[4px] border border-ink/25 bg-bg2 p-2.5 text-left shadow-[0_10px_30px_-12px_rgba(0,0,0,0.9)] group-hover/info:block">
                <span className="block font-display text-[0.7rem] font-semibold uppercase tracking-wide text-ink">{asset.name}</span>
                <span className="mt-1 block font-serif text-[0.78rem] leading-snug text-ink/80">{asset.blurb}</span>
                <span className="mt-1.5 block eyebrow" style={{ color: riskHex }}>{asset.risk} risk</span>
              </span>
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <Sparkline values={series} width={56} height={18} />
            {lastReturn !== null && (
              <span className="num text-[0.7rem]" style={{ color: lastReturn >= 0 ? "#7f8b52" : "#a33218" }}>
                {lastReturn >= 0 ? "+" : ""}{lastReturn.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="num text-base text-ink"><AnimatedNumber value={value} format={currency} /></p>
          <p className="eyebrow text-ink-dim" style={{ fontSize: "0.56rem" }}>{pct.toFixed(0)}% of port</p>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1">
        <span className="eyebrow mr-0.5 text-olive" style={{ fontSize: "0.55rem" }}>Buy</span>
        {BUY_AMOUNTS.map((a) => (
          <Chip key={`b${a}`} label={chipLabel(a)} disabled={cash < a} accent="#7f8b52" onClick={() => onTrade(asset.id, a)} />
        ))}
        <Chip label="MAX" disabled={cash <= 0} accent="#7f8b52" onClick={() => onTrade(asset.id, cash)} />
        <span className="ml-1.5 eyebrow mr-0.5 text-brick" style={{ fontSize: "0.55rem" }}>Sell</span>
        {SELL_AMOUNTS.map((a) => (
          <Chip key={`s${a}`} label={chipLabel(a)} disabled={value < a} accent="#a33218" onClick={() => onTrade(asset.id, -a)} />
        ))}
        <Chip label="MAX" disabled={value <= 0} accent="#a33218" onClick={() => onTrade(asset.id, -value)} />
      </div>
    </div>
  );
}

function chipLabel(a: number) {
  return `$${a >= 1000 ? `${a / 1000}k` : a}`;
}

function Chip({ label, accent, disabled, onClick }: { label: string; accent: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="num rounded-[2px] border px-1.5 py-0.5 text-[0.6rem] transition-colors disabled:opacity-25 enabled:hover:text-bg"
      style={{ color: accent, borderColor: `${accent}66` }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = accent; }}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {label}
    </button>
  );
}
