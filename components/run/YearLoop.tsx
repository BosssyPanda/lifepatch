"use client";

import { useEffect } from "react";
import { Reveal } from "@/components/ui/Reveal";
import { useAudio } from "@/hooks/useAudio";
import { useLenis } from "@/hooks/useLenis";
import type { useRun } from "@/hooks/useRun";
import { ambienceForTag } from "@/lib/audioMap";
import { LIFE_EVENTS } from "@/lib/lifeEvents";
import { macroEvent } from "@/lib/markets";
import { canRetire } from "@/lib/runEngine";
import { AdvanceBar } from "./AdvanceBar";
import { LifeEventCard } from "./LifeEventCard";
import { MarketResults } from "./MarketResults";
import { MarketTicker } from "./MarketTicker";
import { PortfolioPanel } from "./PortfolioPanel";
import { YearHud } from "./YearHud";

type Run = ReturnType<typeof useRun>;

export function YearLoop({ run, onOpenAlmanac }: { run: Run; onOpenAlmanac: () => void }) {
  useLenis(true);
  const audio = useAudio();
  const s = run.run;

  const debt = s?.debt ?? 0;
  const health = s?.life.health ?? 100;
  const happiness = s?.life.happiness ?? 100;
  const year = s?.year ?? 0;

  // adaptive music intensity from life/market pressure
  useEffect(() => {
    if (!s) return;
    const debtPressure = Math.min(0.25, (debt / 100000) * 0.25);
    const lowHealth = (1 - health / 100) * 0.15;
    const lowMood = (1 - happiness / 100) * 0.15;
    const tone = macroEvent(year)?.tone;
    const macroTension = tone === "bad" ? 0.3 : tone === "warning" ? 0.2 : 0;
    audio.setIntensity(Math.max(0, Math.min(1, 0.3 + debtPressure + lowHealth + lowMood + macroTension)));
  }, [audio, s, debt, health, happiness, year]);

  const events = (s?.pendingEvents ?? [])
    .map((id) => LIFE_EVENTS.find((e) => e.id === id))
    .filter((e): e is NonNullable<typeof e> => Boolean(e));

  // scenario ambience follows the first unanswered life event (crossfades)
  const firstOpen = events.find((e) => !s?.yearChoices[e.id]);
  const openTag = firstOpen?.tag ?? null;
  useEffect(() => {
    audio.ambience(openTag ? ambienceForTag(openTag) : null);
  }, [audio, openTag]);
  useEffect(() => () => audio.ambience(null), [audio]);

  if (!s) return null;

  return (
    <div className="min-h-[100svh] w-full pb-4">
      <YearHud run={s} saving={run.saving} onOpenAlmanac={onOpenAlmanac} />

      <MarketTicker run={s} />
      <MarketResults run={s} />

      {events.length > 0 && (
        <div className="space-y-4 py-2">
          {events.map((e) => (
            <Reveal key={e.id}>
              <LifeEventCard event={e} chosen={s.yearChoices[e.id]} onChoose={run.choose} />
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
