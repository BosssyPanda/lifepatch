"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Mascot } from "@/components/brand/Mascot";
import { AnimatedNumber } from "@/components/story/AnimatedNumber";
import { NeonButton } from "@/components/ui/NeonButton";
import { useAudio } from "@/hooks/useAudio";
import { RECAP_BEATS, type RecapKind } from "@/lib/cinematic";
import { currency } from "@/lib/format";
import { macroEvent } from "@/lib/markets";
import { netWorth, type RunState } from "@/lib/runEngine";
import { deriveVerdict } from "@/lib/verdict";
import type { AccentKind } from "@/src/audio/AudioEngine";
import { MuteButton, SkipButton } from "./Controls";
import { VerdictStamp } from "./VerdictStamp";

const SOUND: Record<RecapKind, AccentKind> = {
  open: "thump", years: "rise", networth: "rise", win: "ping", loss: "thud", mascot: "stab", verdict: "thump",
};

export function Outro({ run, onDone }: { run: RunState; onDone: () => void }) {
  const audio = useAudio();
  const [i, setI] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef(false);
  const startedRef = useRef(false);

  const verdict = deriveVerdict(run);
  const nw = netWorth(run);
  const hist = run.history;
  const firstYear = hist[0]?.year ?? run.startYear;
  const lastYear = hist[hist.length - 1]?.year ?? run.startYear;
  const best = [...hist].sort((a, b) => b.portfolioDelta - a.portfolioDelta)[0];
  const worst = [...hist].sort((a, b) => a.portfolioDelta - b.portfolioDelta)[0];

  // crossfade the running score into the verdict-keyed recap preset (no restart)
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const preset = verdict.good ? "recapGood" : "recapBad";
    audio.unlock(preset); // idempotent: starts the engine here only if it never started
    audio.setPhase(preset);
    audio.ambience(null); // drop any lingering scenario ambience
  }, [audio, verdict.good]);

  useEffect(() => {
    const beat = RECAP_BEATS[i];
    if (!beat) {
      if (!doneRef.current) { doneRef.current = true; onDone(); }
      return;
    }
    try { audio.accent(beat.kind === "verdict" ? (verdict.good ? "stampGood" : "stampBad") : SOUND[beat.kind]); } catch {}
    if (beat.kind === "verdict" && verdict.good) audio.swellWarmth();
    timerRef.current = setTimeout(() => setI((n) => n + 1), beat.ms);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [i, audio, onDone, verdict.good]);

  const finish = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    // no stopAll — music keeps playing and AppShell crossfades it to the report bed
    if (!doneRef.current) { doneRef.current = true; onDone(); }
  };

  const kind = RECAP_BEATS[i]?.kind;

  return (
    <div className="bg-arena relative flex min-h-[100svh] w-full items-center justify-center overflow-hidden px-5">
      <AnimatePresence mode="wait">
        <motion.div
          key={kind ?? "end"}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -14 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-3xl text-center"
        >
          {kind === "open" && (
            <>
              <p className="eyebrow text-accent">The life of {run.name}</p>
              <p className="display-caps mt-3 text-5xl text-ink sm:text-7xl">{hist.length} years.<br />One life.</p>
            </>
          )}

          {kind === "years" && (
            <>
              <p className="eyebrow text-ink-dim">You lived through</p>
              <p className="num mt-3 text-6xl text-ink sm:text-8xl">{firstYear} – {lastYear}</p>
              <p className="mt-2 font-serif italic text-ink-dim">…and you never saw it coming.</p>
            </>
          )}

          {kind === "networth" && (
            <>
              <p className="eyebrow text-ink-dim">Final net worth</p>
              <CountUp to={nw} />
            </>
          )}

          {kind === "win" && (
            <>
              <p className="eyebrow text-olive">Your biggest win</p>
              <p className="num mt-3 text-5xl text-olive sm:text-7xl">+{currency(Math.max(0, best?.portfolioDelta ?? 0))}</p>
              <p className="mt-2 font-serif italic text-ink/70">{macroEvent(best?.year ?? 0)?.title ?? "a quiet, green year"}</p>
            </>
          )}

          {kind === "loss" && (
            <>
              <p className="eyebrow text-brick">Your biggest hit</p>
              <p className="num mt-3 text-5xl text-brick sm:text-7xl">−{currency(Math.abs(Math.min(0, worst?.portfolioDelta ?? 0)))}</p>
              <p className="mt-2 font-serif italic text-ink/70">{macroEvent(worst?.year ?? 0)?.title ?? "the market just shrugged"}</p>
            </>
          )}

          {kind === "mascot" && (
            <div className="flex flex-col items-center gap-4">
              <div className="w-28 sm:w-36"><Mascot mood={verdict.good ? "rattled" : "gloating"} /></div>
              <p className="display-caps max-w-2xl text-3xl text-ink sm:text-4xl">
                {verdict.good ? "Hm. You actually made it work. Disgusting." : "Cooked — just like the rest. See you next run."}
              </p>
              <span className="eyebrow text-accent">— The System</span>
            </div>
          )}

          {kind === "verdict" && (
            <div className="flex flex-col items-center gap-6">
              <VerdictStamp title={verdict.title} hex={verdict.hex} />
              <p className="mx-auto max-w-md font-serif italic text-ink/75">{verdict.blurb}</p>
              <NeonButton variant="primary" size="lg" onClick={finish}>See the full report →</NeonButton>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="absolute right-4 top-4 z-20"><MuteButton muted={audio.muted} onToggle={() => audio.setMuted(!audio.muted)} /></div>
      <div className="absolute bottom-6 right-4 z-20"><SkipButton onSkip={finish} /></div>
    </div>
  );
}

function CountUp({ to }: { to: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => setV(to), 30);
    return () => clearTimeout(id);
  }, [to]);
  return (
    <p className="num mt-3 text-6xl sm:text-8xl" style={{ color: to >= 0 ? "#7f8b52" : "#a33218" }}>
      <AnimatedNumber value={v} format={currency} duration={2000} />
    </p>
  );
}
