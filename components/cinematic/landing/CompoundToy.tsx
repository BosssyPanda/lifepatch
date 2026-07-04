"use client";

import { useMemo, useState } from "react";
import { assetReturn, FIRST_YEAR, LAST_YEAR, type AssetId } from "@/lib/markets";
import { NumberTicker } from "./NumberTicker";

/**
 * Landing set piece 005 — "RUN THE NUMBERS" (spectacle Phase K3).
 * An interactive compound-growth toy: pick a monthly amount, a horizon, and
 * one of three real assets. The average annual return per asset is COMPUTED
 * from the same 1957–2025 history the game runs on (geometric mean), then a
 * standard future-value-of-annuity formula does the rest. UI math only —
 * nothing here touches game state.
 */

const PRESETS: { id: AssetId; label: string }[] = [
  { id: "savings", label: "Savings" },
  { id: "bonds", label: "Bonds" },
  { id: "index", label: "Index fund" },
];

/** Geometric-mean annual return (%) of an asset across the full lib history. */
function histAvg(asset: AssetId): number {
  let acc = 1;
  let n = 0;
  for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) {
    acc *= 1 + assetReturn(asset, y) / 100;
    n++;
  }
  return (Math.pow(acc, 1 / n) - 1) * 100;
}

/** Future value of `monthly` invested every month for `years` at `annualPct`. */
function futureValue(monthly: number, years: number, annualPct: number): number {
  const i = annualPct / 100 / 12;
  const n = years * 12;
  if (i === 0) return monthly * n;
  return monthly * ((Math.pow(1 + i, n) - 1) / i);
}

function Slider({ label, value, min, max, step, format, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="eyebrow text-secondary">{label}</span>
        <span className="num text-ink" style={{ fontSize: "0.9rem" }}>{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-3 h-px w-full cursor-ew-resize appearance-none bg-hairline outline-none
          [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-ink [&::-webkit-slider-thumb]:bg-bg
          [&::-webkit-slider-thumb]:hover:bg-ink
          [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:rounded-none
          [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-ink [&::-moz-range-thumb]:bg-bg"
        aria-label={label}
      />
    </label>
  );
}

export function CompoundToy() {
  const [monthly, setMonthly] = useState(200);
  const [years, setYears] = useState(20);
  const [asset, setAsset] = useState<AssetId>("index");

  const avgs = useMemo(() => {
    const m = new Map<AssetId, number>();
    for (const p of PRESETS) m.set(p.id, histAvg(p.id));
    return m;
  }, []);

  const rate = avgs.get(asset) ?? 0;
  const fv = futureValue(monthly, years, rate);
  const contributed = monthly * years * 12;
  const growth = fv - contributed;

  return (
    <section className="border-t border-hairline px-5 py-20 sm:px-10 lg:px-16" aria-labelledby="toy-heading">
      <p className="eyebrow text-secondary">005 — Run the Numbers</p>
      <h2 id="toy-heading" className="display-caps mt-3 text-3xl text-ink sm:text-5xl">
        Boring money, absurd endings.
      </h2>

      <div className="mt-10 grid gap-px border border-hairline bg-hairline lg:grid-cols-[1.1fr_1.4fr]">
        {/* controls */}
        <div className="space-y-8 bg-bg p-6 sm:p-8">
          <Slider label="Every month" value={monthly} min={25} max={1500} step={25}
            format={(v) => `$${v.toLocaleString("en-US")}`} onChange={setMonthly} />
          <Slider label="For how long" value={years} min={5} max={40} step={1}
            format={(v) => `${v} yrs`} onChange={setYears} />

          <div>
            <span className="eyebrow text-secondary">Parked in</span>
            <div className="mt-3 grid grid-cols-3 gap-px border border-hairline bg-hairline">
              {PRESETS.map((p) => {
                const active = asset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setAsset(p.id)}
                    aria-pressed={active}
                    className="flex flex-col items-center gap-1 px-2 py-3 transition-colors duration-200"
                    style={{
                      background: active ? "var(--color-ink)" : "var(--color-bg)",
                      color: active ? "var(--color-bg)" : "var(--color-secondary)",
                    }}
                  >
                    <span className="eyebrow" style={{ fontSize: "0.56rem", color: "inherit" }}>{p.label}</span>
                    <span className="num" style={{ fontSize: "0.78rem", color: "inherit" }}>
                      ~{(avgs.get(p.id) ?? 0).toFixed(1)}%/yr
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* output */}
        <div className="flex flex-col justify-between bg-bg2 p-6 sm:p-8">
          <div>
            <p className="eyebrow text-secondary">After {years} years</p>
            <p className="font-anton mt-2 text-5xl leading-none text-ink sm:text-7xl" key={`${monthly}-${years}-${asset}`}>
              <NumberTicker value={Math.round(fv)} prefix="$" durationMs={700} />
            </p>
          </div>
          <div className="mt-8 space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="eyebrow text-secondary" style={{ fontSize: "0.6rem" }}>You put in</span>
              <span className="mt-1 flex-1 rule-dotted" />
              <span className="num text-ink">${contributed.toLocaleString("en-US")}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="eyebrow text-secondary" style={{ fontSize: "0.6rem" }}>The math added</span>
              <span className="mt-1 flex-1 rule-dotted" />
              <span className="num" style={{ color: growth >= 0 ? "var(--color-gain)" : "var(--color-loss)" }}>
                {growth >= 0 ? "+" : "−"}${Math.abs(Math.round(growth)).toLocaleString("en-US")}
              </span>
            </div>
          </div>
          <p className="voice mt-6 text-base text-ink">
            &ldquo;Time does the heavy lifting. You just have to not flinch.&rdquo;
          </p>
        </div>
      </div>

      <p className="mt-4 font-body text-xs italic text-ink-dim">
        Average returns are the geometric mean of each asset&apos;s {FIRST_YEAR}–{LAST_YEAR} history inside the game
        (savings ~{(avgs.get("savings") ?? 0).toFixed(1)}%, bonds ~{(avgs.get("bonds") ?? 0).toFixed(1)}%, index
        ~{(avgs.get("index") ?? 0).toFixed(1)}%). A steady average is a fiction — the game makes you live the bumpy version.
        This is a toy, not financial advice.
      </p>
    </section>
  );
}
