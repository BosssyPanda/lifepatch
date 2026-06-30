"use client";

import { useEffect, useState, type CSSProperties } from "react";
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

  // Most this asset could hold = what's already in it + free cash on hand.
  const investable = value + cash;
  const heldPct = investable > 0 ? Math.round((value / investable) * 100) : 0;

  // Slider tracks a *target* allocation; commit the delta only on release.
  const [draft, setDraft] = useState(heldPct);
  const [dragging, setDragging] = useState(false);

  // Resync from engine truth whenever holdings/cash change and we're not dragging.
  useEffect(() => {
    if (!dragging) setDraft(heldPct);
  }, [heldPct, dragging]);

  const target = Math.round((draft / 100) * investable);
  const delta = target - value;
  const previewValue = dragging ? target : value;
  const previewPct = dragging
    ? investable > 0
      ? draft
      : 0
    : pct;

  // Commit from the input's live value so keyboard steps trade the right amount
  // even if React hasn't re-rendered `draft` yet between keydown and keyup.
  const commit = (e: { currentTarget: HTMLInputElement }) => {
    setDragging(false);
    const livePct = Number(e.currentTarget.value);
    const liveDelta = Math.round((livePct / 100) * investable) - value;
    if (liveDelta !== 0) onTrade(asset.id, liveDelta);
  };

  const deltaLabel =
    dragging && Math.abs(delta) >= 1
      ? `${delta > 0 ? "buy " : "sell "}${currency(Math.abs(delta))}`
      : null;

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
            <AnimatedNumber value={previewValue} format={currency} />
          </p>
          <p className="eyebrow text-ink-dim" style={{ fontSize: "0.56rem" }}>
            {previewPct.toFixed(0)}% of port
          </p>
        </div>
      </div>

      {/* one control: a target-allocation slider, commits the trade on release */}
      <div className="mt-2.5">
        <div className="flex items-center gap-2.5">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={draft}
            disabled={investable <= 0}
            aria-label={`${asset.short} allocation, ${draft}% of investable cash`}
            onPointerDown={() => setDragging(true)}
            onChange={(e) => setDraft(Number(e.target.value))}
            onPointerUp={commit}
            onPointerCancel={commit}
            onKeyDown={() => setDragging(true)}
            onKeyUp={commit}
            className="allocator flex-1 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
            style={
              {
                "--accent": riskHex,
                "--fill": `${draft}%`,
              } as CSSProperties
            }
          />
          <span
            className="num w-9 shrink-0 text-right text-[0.7rem] tabular-nums"
            style={{ color: deltaLabel ? riskHex : "var(--color-ink-dim)" }}
          >
            {draft}%
          </span>
        </div>
        <div className="mt-1 h-3.5">
          {deltaLabel && (
            <span className="eyebrow" style={{ color: riskHex, fontSize: "0.55rem" }}>
              {deltaLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
