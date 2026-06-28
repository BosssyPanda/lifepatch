"use client";

import { Reveal } from "@/components/ui/Reveal";
import { useLenis } from "@/hooks/useLenis";
import type { useRun } from "@/hooks/useRun";
import { LIFE_EVENTS } from "@/lib/lifeEvents";
import { canRetire } from "@/lib/runEngine";
import { AdvanceBar } from "./AdvanceBar";
import { LifeEventCard } from "./LifeEventCard";
import { MarketTicker } from "./MarketTicker";
import { PortfolioPanel } from "./PortfolioPanel";
import { YearHud } from "./YearHud";

type Run = ReturnType<typeof useRun>;

export function YearLoop({ run }: { run: Run }) {
  useLenis(true);
  const s = run.run;
  if (!s) return null;

  const events = s.pendingEvents
    .map((id) => LIFE_EVENTS.find((e) => e.id === id))
    .filter((e): e is NonNullable<typeof e> => Boolean(e));

  return (
    <div className="min-h-[100svh] w-full pb-4">
      <YearHud run={s} saving={run.saving} />

      <MarketTicker run={s} />

      {events.length > 0 && (
        <div className="space-y-4 py-2">
          {events.map((e) => (
            <Reveal key={e.id}>
              <LifeEventCard event={e} chosenId={s.yearChoices[e.id]} onChoose={run.choose} />
            </Reveal>
          ))}
        </div>
      )}

      <Reveal>
        <PortfolioPanel run={s} onTrade={run.trade} onPayDebt={run.payDebt} />
      </Reveal>

      <AdvanceBar
        run={s}
        canRetire={canRetire(s)}
        onAdvance={run.advance}
        onRetire={run.retire}
        onQuit={run.quit}
      />
    </div>
  );
}
