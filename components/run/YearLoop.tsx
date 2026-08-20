"use client";

import { useEffect, useMemo } from "react";
import { MatchRail } from "@/components/mp/MatchRail";
import { YearTimer } from "@/components/mp/YearTimer";
import { Reveal } from "@/components/ui/Reveal";
import { useAudio } from "@/hooks/useAudio";
import { useLenis } from "@/hooks/useLenis";
import { useMatchCtx } from "@/hooks/useMatch";
import type { useRun } from "@/hooks/useRun";
import { ambienceForTag } from "@/lib/audioMap";
import { LIFE_EVENTS } from "@/lib/lifeEvents";
import { macroEvent } from "@/lib/markets";
import { MODES } from "@/lib/modes";
import { autoChoiceFor } from "@/lib/mp/autoResolve";
import { canRetire, netWorth, yearIndex } from "@/lib/runEngine";
import { HudRail } from "@/components/ui/HudRail";
import { AdvanceBar } from "./AdvanceBar";
import { InsolvencyNotice } from "./InsolvencyNotice";
import { LifeEventCard } from "./LifeEventCard";
import { MarketResults } from "./MarketResults";
import { MarketTicker } from "./MarketTicker";
import { PortfolioPanel } from "./PortfolioPanel";
import { RunTicker } from "./RunTicker";
import { YearHud } from "./YearHud";

type Run = ReturnType<typeof useRun>;

export function YearLoop({ run, onOpenAlmanac }: { run: Run; onOpenAlmanac: () => void }) {
  useLenis(true);
  // Pulled apart rather than held as one object: every method on the audio API is
  // referentially stable, but `audio` itself changes identity whenever mute /
  // volume / started does. Depending on the whole object made a volume-fader drag
  // re-fire these effects — which tore the ambience bed down and rebuilt it on
  // every step of the slider.
  const { setIntensity, ambience, sfx } = useAudio();
  // null for a solo run — everything below that reads it is additive.
  const match = useMatchCtx();
  const s = run.run;
  const { choose, advance, stillPlaying } = run;

  const debt = s?.debt ?? 0;
  const health = s?.life.health ?? 100;
  const happiness = s?.life.happiness ?? 100;
  const year = s?.year ?? 0;
  const hasRun = Boolean(s);

  // adaptive music intensity from life/market pressure. Derived as a NUMBER so the
  // effect below re-runs only when the mix should actually move: the run state is a
  // fresh object on every slider tick, and depending on it re-ramped every stem
  // continuously.
  const intensity = useMemo(() => {
    if (!hasRun) return null;
    const debtPressure = Math.min(0.25, (debt / 100000) * 0.25);
    const lowHealth = (1 - health / 100) * 0.15;
    const lowMood = (1 - happiness / 100) * 0.15;
    const tone = macroEvent(year)?.tone;
    const macroTension = tone === "bad" ? 0.3 : tone === "warning" ? 0.2 : 0;
    return Math.max(0, Math.min(1, 0.3 + debtPressure + lowHealth + lowMood + macroTension));
  }, [hasRun, debt, health, happiness, year]);

  useEffect(() => {
    if (intensity === null) return;
    setIntensity(intensity);
  }, [setIntensity, intensity]);

  const events = (s?.pendingEvents ?? [])
    .map((id) => LIFE_EVENTS.find((e) => e.id === id))
    .filter((e): e is NonNullable<typeof e> => Boolean(e));

  // scenario ambience follows the first unanswered life event (crossfades)
  const firstOpen = events.find((e) => !s?.yearChoices[e.id]);
  const openTag = firstOpen?.tag ?? null;
  useEffect(() => {
    ambience(openTag ? ambienceForTag(openTag) : null);
  }, [ambience, openTag]);
  useEffect(() => () => ambience(null), [ambience]);

  // ── the room's clock ──────────────────────────────────────────────────────
  // In a match the year turns for everyone at once and the clock waits for no
  // one: when the room has moved past this life (a `tick` from the acting host,
  // or this client's own fallback deadline), anything the player left open is
  // answered with the same deterministic auto-choice that ghost-plays an absent
  // player — then the year rolls. One year per pass, so a tab that was asleep
  // catches up a year per commit instead of freezing on a long loop.
  //
  // Reporting the new state to the room is AppShell's job: the ending unmounts
  // this screen in the same commit that produces it.
  //
  // `stillPlaying()` is not the same test as `s.status`. The ending unmounts this
  // screen, but `AnimatePresence mode="wait"` keeps the OLD one on screen — with
  // the props of its last render, which still say "playing" at the final year —
  // until its exit finishes, while the room's context around it keeps changing and
  // re-firing this effect. That stale copy must never drive the live run: it is a
  // picture of a life that is already over.
  useEffect(() => {
    if (!match || !s || s.status !== "playing" || !stillPlaying()) return;
    if (match.roomYearIndex <= yearIndex(s)) return;
    for (const id of s.pendingEvents) {
      if (s.yearChoices[id]) continue;
      const auto = autoChoiceFor(s, id);
      // An event this build no longer knows can't be answered; `advanceYear`
      // clears the pending list anyway, so the year still turns.
      if (auto) choose(id, auto);
    }
    // The same page turn the solo bar plays on "Advance the year". In a match the
    // bar only locks in, so without this the room's loudest shared beat — the year
    // actually turning — would be silent.
    sfx("page");
    advance();
  }, [match, s, choose, advance, sfx, stillPlaying]);

  if (!s) return null;

  return (
    <div className="min-h-[100svh] w-full pb-4">
      {/* The run screen's title. It has no visible headline — the year sits in the HUD as a
          figure, not a heading — so the document's h1 is carried here for assistive tech. */}
      <h1 className="sr-only">{s.name}&rsquo;s life — year {s.year - s.startYear + 1}, age {s.age}</h1>
      {/* Phase M2 chrome rail — relative year only (calendar years are end-report spoilers) */}
      <HudRail mode={MODES[s.mode].name} counter={`Year ${s.year - s.startYear + 1} — Age ${s.age}`} />
      {/* The room's chrome sits with the run's own: the shared countdown and the
          live standings read as one band under the rail, so everything that is
          LIVE is in a single column instead of scattered down the page. */}
      {match && (
        <div className="border-b border-hairline bg-bg">
          <div className="mx-auto max-w-5xl space-y-3 px-3 py-3 sm:px-5">
            <YearTimer />
            <MatchRail selfNetWorth={netWorth(s)} />
          </div>
        </div>
      )}
      <YearHud run={s} saving={run.saving} onOpenAlmanac={onOpenAlmanac} />
      <RunTicker run={s} />

      <MarketTicker run={s} />
      <MarketResults run={s} />

      {events.length > 0 && (
        <div className="space-y-4 py-2">
          {events.map((e, i) => (
            <Reveal key={e.id}>
              <LifeEventCard
                event={e}
                /* folio within THIS year, so the card reads like a numbered form in a
                   filing — matching the board's plate numbers and the landing's folios */
                plate={String(i + 1).padStart(2, "0")}
                chosen={s.yearChoices[e.id]}
                onChoose={run.choose}
                runState={s}
              />
            </Reveal>
          ))}
        </div>
      )}

      <Reveal>
        <PortfolioPanel run={s} onTrade={run.trade} onPayDebt={run.payDebt} />
      </Reveal>

      {/* Sits directly above the one control that advances the clock, because that is
          the control the warning is about. */}
      <InsolvencyNotice run={s} />

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
