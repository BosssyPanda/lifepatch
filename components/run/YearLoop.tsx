"use client";

import { useEffect, useRef, useState } from "react";
import { Reveal } from "@/components/ui/Reveal";
import { useAudio } from "@/hooks/useAudio";
import { useLenis } from "@/hooks/useLenis";
import type { useRun } from "@/hooks/useRun";
import { ambienceForTag } from "@/lib/audioMap";
import { LIFE_EVENTS } from "@/lib/lifeEvents";
import { macroEvent } from "@/lib/markets";
import { MODES } from "@/lib/modes";
import { bigMarketEvent, canRetire, type YearRecord } from "@/lib/runEngine";
import { HudRail } from "@/components/ui/HudRail";
import { AdvanceBar } from "./AdvanceBar";
import { LifeEventCard } from "./LifeEventCard";
import { MarketEventBeat } from "./MarketEventBeat";
import { MarketResults } from "./MarketResults";
import { MarketTicker } from "./MarketTicker";
import { PortfolioPanel } from "./PortfolioPanel";
import { RunTicker } from "./RunTicker";
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

  // ── Big market event (Phase 3): mood + full-screen caption ────────────────
  // The mood tracks the LAST RESOLVED year (the crash the player is living in
  // the aftermath of) and clears on the next calm year or when leaving the run.
  const lastRec = s?.history[s.history.length - 1] ?? null;
  const bigKind = lastRec ? (bigMarketEvent(lastRec)?.kind ?? null) : null;
  useEffect(() => {
    audio.setMarketMood(bigKind ?? "calm");
  }, [audio, bigKind]);
  useEffect(() => () => audio.setMarketMood("calm"), [audio]);

  // The caption ceremony plays once per crash/boom year, and only for advances
  // made this session — resuming a save mid-aftermath must not replay it.
  const [beatRec, setBeatRec] = useState<YearRecord | null>(null);
  const seenYearsRef = useRef<Set<number> | null>(null);
  if (seenYearsRef.current === null) {
    seenYearsRef.current = new Set((s?.history ?? []).map((h) => h.year));
  }
  useEffect(() => {
    if (!lastRec) return;
    const seen = seenYearsRef.current!;
    if (seen.has(lastRec.year)) return;
    seen.add(lastRec.year);
    if (bigMarketEvent(lastRec)) setBeatRec(lastRec);
  }, [lastRec]);

  if (!s) return null;
  const beatEvent = beatRec ? bigMarketEvent(beatRec) : null;

  return (
    <div className="min-h-[100svh] w-full pb-4">
      {/* Phase M2 chrome rail — relative year only (calendar years are end-report spoilers) */}
      <HudRail mode={MODES[s.mode].name} counter={`Year ${s.year - s.startYear + 1} — Age ${s.age}`} />
      <YearHud run={s} saving={run.saving} onOpenAlmanac={onOpenAlmanac} />
      <RunTicker run={s} />

      <MarketTicker run={s} />
      <MarketResults run={s} />

      {events.length > 0 && (
        <div className="space-y-4 py-2">
          {events.map((e) => (
            <Reveal key={e.id}>
              <LifeEventCard event={e} chosen={s.yearChoices[e.id]} onChoose={run.choose} runState={s} />
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

      {beatRec && beatEvent && (
        <MarketEventBeat record={beatRec} event={beatEvent} onDone={() => setBeatRec(null)} />
      )}
    </div>
  );
}
