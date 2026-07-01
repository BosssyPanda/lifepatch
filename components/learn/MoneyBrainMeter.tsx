import { BrainIcon } from "@/components/icons";
import { MAX_MASTERY_LEVEL } from "@/lib/cloud/mastery";
import type { MasteryRow } from "@/lib/cloud/types";
import { CONCEPTS } from "@/lib/concepts";

/** 0–100: share of total possible mastery earned (mastery-only — levels, not exposure). */
export function moneyBrainPct(mastery: MasteryRow[]): number {
  const max = CONCEPTS.length * MAX_MASTERY_LEVEL;
  if (max === 0) return 0;
  const sum = mastery.reduce((t, m) => t + Math.min(Math.max(m.level, 0), MAX_MASTERY_LEVEL), 0);
  return Math.round((sum / max) * 100);
}

/** Compact "Money Brain" progress bar. Sized for the paper report/map surfaces. */
export function MoneyBrainMeter({
  mastery,
  label = true,
}: {
  mastery: MasteryRow[];
  label?: boolean;
}) {
  const pct = moneyBrainPct(mastery);
  return (
    <div className="w-full">
      {label && (
        <div className="mb-1 flex items-baseline justify-between">
          <span className="eyebrow inline-flex items-center gap-1.5 opacity-60"><BrainIcon size={12} /> Money Brain</span>
          <span className="display-caps text-sm">{pct}%</span>
        </div>
      )}
      {/* currentColor track → works on both the paper map and the dark reports. */}
      <div
        className="relative h-2.5 w-full overflow-hidden rounded-full"
        style={{ background: "color-mix(in srgb, currentColor 14%, transparent)" }}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%`, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.28)" }}
        />
        {/* faint quarter-marks so progress reads against milestones */}
        {[25, 50, 75].map((t) => (
          <span key={t} className="absolute top-0 h-full w-px opacity-20" style={{ left: `${t}%`, background: "currentColor" }} />
        ))}
      </div>
    </div>
  );
}
