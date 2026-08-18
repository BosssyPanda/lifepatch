"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatedNumber } from "@/components/story/AnimatedNumber";
import type { AssetDef } from "@/lib/assets";
import { currency } from "@/lib/format";
import type { AssetId } from "@/lib/markets";
import { Sparkline } from "./Sparkline";

/** Palette token references, never literal hex — alpha comes from `color-mix`, because a
 *  `var()` with a hex suffix glued on is invalid CSS the browser silently drops. */
const RISK_TINT: Record<string, `var(--color-${string})`> = {
  low: "var(--color-gain)",
  med: "var(--color-secondary)",
  high: "var(--color-secondary)",
  extreme: "var(--color-loss)",
};

/** Keys that move a range input — the ones that open a keyboard gesture. */
const NUDGE_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
]);

/** Keyboard idle that ends a gesture: long enough to hold an arrow key, short enough to feel live. */
const KEY_IDLE_MS = 250;

/**
 * A round dollar detent, ~100 notches wide, snapped to 1/2/5×10ⁿ and never below $1.
 *
 * The old control was `step={1}` over `0–100` *percent*: a slow drag hit all hundred
 * detents, and once the pool got small consecutive percents rounded to the same dollar
 * target — the thumb moved and nothing happened. Denominating the track in dollars and
 * sizing the detent off the ceiling removes both: every notch is a different, round
 * amount of money.
 */
function stepFor(ceiling: number): number {
  if (!(ceiling > 0)) return 1;
  const raw = ceiling / 100;
  if (raw <= 1) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
}

/**
 * Snap the top notch onto the ceiling.
 *
 * `max` is only reachable when `(max − min)` is a whole number of steps, so a $1,537
 * ceiling on a $20 detent would strand $17 and make "all in" impossible. The last
 * attainable notch — and only that one — resolves to the ceiling itself.
 */
function stageValue(raw: number, ceiling: number): number {
  const step = stepFor(ceiling);
  if (raw > ceiling - step) return ceiling;
  return Math.max(0, Math.min(raw, ceiling));
}

/** A gesture: the ceiling frozen at its start, plus the dollars staged so far. */
type Gesture = { ceiling: number; staged: number };

export function AssetRow({
  asset,
  value,
  total,
  cash,
  series,
  lastReturn,
  onTrade,
}: {
  asset: AssetDef;
  /** Dollars currently held in this asset. */
  value: number;
  /** Every dollar the player has — cash + everything invested. The one denominator on screen. */
  total: number;
  /** The shared free-cash pool, unspent by any row. */
  cash: number;
  series: number[];
  lastReturn: number | null;
  onTrade: (id: AssetId, dollars: number) => void;
}) {
  const Icon = asset.Icon;
  const riskTint = RISK_TINT[asset.risk];

  /**
   * The slider is denominated in DOLLARS HELD, and its ceiling is frozen for the whole
   * gesture. Live-recomputing `value + cash` on every input event was what made the six
   * rows fight each other: spending here shrank every other row's denominator mid-drag,
   * so the thumb remapped under the finger and rows locked at 100%. The ceiling is
   * snapshotted on pointerdown / first arrow key and held until release.
   *
   * Nothing touches game state during the drag: the staged dollars live here, and
   * exactly one `onTrade` — and therefore exactly one sound — fires on commit.
   */
  const [gesture, setGesture] = useState<Gesture | null>(null);

  const liveCeiling = Math.max(0, value + cash);
  const ceiling = gesture ? gesture.ceiling : liveCeiling;
  const staged = Math.max(0, Math.min(gesture ? gesture.staged : value, ceiling));
  const step = stepFor(ceiling);
  const share = total > 0 ? (staged / total) * 100 : 0;
  const fill = ceiling > 0 ? Math.max(0, Math.min(100, (staged / ceiling) * 100)) : 0;
  const dragging = gesture !== null;

  // Props read from timers and window listeners, which outlive the render that made them.
  const latest = useRef({ value, cash, staged, ceiling, onTrade, id: asset.id });
  latest.current = { value, cash, staged, ceiling, onTrade, id: asset.id };

  const pointerRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  /** End of gesture: one trade, one sound, one engine mutation. */
  const commit = useCallback(() => {
    clearTimer();
    const { value: held, cash: free, staged: want, ceiling: cap, onTrade: trade, id } = latest.current;
    setGesture(null);
    // "All in" means every free dollar, not a rounded notch — the engine clamps the rest.
    const target = want >= cap ? held + free : Math.round(want);
    const delta = target - held;
    if (Math.abs(delta) >= 0.5) trade(id, delta);
  }, []);

  /** Freeze the ceiling. Idempotent: a gesture already open keeps its snapshot. */
  const begin = useCallback(() => {
    setGesture((g) => g ?? { ceiling: Math.max(0, latest.current.value + latest.current.cash), staged: latest.current.value });
  }, []);

  const scheduleKeyCommit = useCallback(() => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      commit();
    }, KEY_IDLE_MS);
  }, [commit]);

  // Release can land anywhere — outside the track, outside the window. The pointer that
  // opened the gesture is the one that closes it, wherever it comes up.
  useEffect(() => {
    const end = () => {
      if (!pointerRef.current) return;
      pointerRef.current = false;
      commit();
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [commit]);

  useEffect(() => clearTimer, []);

  const stage = (raw: number) => {
    setGesture((g) => {
      const cap = g ? g.ceiling : Math.max(0, latest.current.value + latest.current.cash);
      return { ceiling: cap, staged: stageValue(raw, cap) };
    });
    // No pointer down means arrow keys (or assistive tech) drove it: commit on idle.
    if (!pointerRef.current) scheduleKeyCommit();
  };

  // Announced in dollars first — the figure the player is actually choosing — with the
  // same share, off the same denominator, as the visible label under it.
  const valueText = `${currency(staged)}, ${share.toFixed(0)}% of total`;

  return (
    <div className="border border-hairline bg-bg p-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-ink-dim">
          <Icon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-sm font-semibold uppercase tracking-wide text-ink">
              {asset.short}
            </span>
            <span
              className="eyebrow border px-1 py-0.5"
              style={{ color: riskTint, borderColor: `color-mix(in srgb, ${riskTint} 33%, transparent)`, fontSize: "0.52rem" }}
            >
              {asset.risk}
            </span>
          </div>
          {/* the reason to hold it — always visible, no hover required */}
          <p className="mt-1 font-body text-[0.78rem] leading-snug text-ink-dim">{asset.blurb}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <Sparkline values={series} width={56} height={18} />
            {lastReturn !== null && (
              <span
                className="num text-[0.7rem]"
                style={{ color: lastReturn >= 0 ? "var(--color-gain)" : "var(--color-loss)" }}
              >
                {lastReturn >= 0 ? "+" : ""}
                {lastReturn.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
        {/* Fixed width + tabular figures: $0 and $250,000 occupy the same column, so a
            figure counting up mid-gesture can never reflow the row under the finger.
            While a gesture is open the staged dollars are printed straight — the count-up
            tween is for settled figures, not for tracking a drag. */}
        <div className="w-[6.25rem] shrink-0 text-right">
          <p className="num text-base tabular-nums text-ink">
            {dragging ? currency(staged) : <AnimatedNumber value={value} format={currency} />}
          </p>
          <p className="eyebrow tabular-nums text-ink-dim" style={{ fontSize: "0.56rem" }}>
            {share.toFixed(0)}% of total
          </p>
        </div>
      </div>

      {/* One control, denominated in dollars: 0 → everything this row could hold. */}
      <div className="mt-2.5">
        <input
          type="range"
          min={0}
          max={Math.max(ceiling, 1)}
          step={step}
          value={staged}
          disabled={ceiling <= 0}
          aria-label={`${asset.short} holding, in dollars`}
          aria-valuetext={valueText}
          onPointerDown={() => {
            // A pending keyboard commit must not land in the middle of a drag that
            // started before it fired — the pointer now owns this gesture.
            clearTimer();
            pointerRef.current = true;
            begin();
          }}
          onKeyDown={(e) => {
            if (NUDGE_KEYS.has(e.key)) begin();
          }}
          onKeyUp={(e) => {
            if (NUDGE_KEYS.has(e.key)) scheduleKeyCommit();
          }}
          onChange={(e) => stage(Number(e.target.value))}
          onBlur={() => {
            if (gesture) commit();
          }}
          className="allocator w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          style={
            {
              "--accent": riskTint,
              "--fill": `${fill}%`,
            } as CSSProperties
          }
        />
        {/* The track's scale, so the ceiling is never a mystery. Fixed height — this line
            changes wording as money moves and must not shove the track around. */}
        <div className="mt-1 flex h-3.5 items-center justify-between">
          <span className="eyebrow tabular-nums text-tertiary" style={{ fontSize: "0.55rem" }}>
            $0
          </span>
          <span className="eyebrow tabular-nums text-tertiary" style={{ fontSize: "0.55rem" }}>
            max {currency(ceiling)}
          </span>
        </div>
      </div>
    </div>
  );
}
