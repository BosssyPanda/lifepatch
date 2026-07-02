"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { BrainIcon, CheckIcon, FreedomIcon, ReplayIcon, TrophyIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/NeonButton";
import { StreakChip } from "@/components/social/StreakChip";
import { useAudio } from "@/hooks/useAudio";
import { MODES, type ModeId } from "@/lib/modes";
import { SPRING } from "@/src/motion/tokens";

const ICON = { story: TrophyIcon, infinite: ReplayIcon, cashflow: FreedomIcon };

export function ModeSelect({
  onChoose,
  onBack,
  onLeaderboard,
  onMasteryMap,
}: {
  onChoose: (mode: ModeId) => void;
  onBack: () => void;
  onLeaderboard: () => void;
  onMasteryMap: () => void;
}) {
  const audio = useAudio();
  const modes: ModeId[] = ["story", "infinite", "cashflow"];
  const [picked, setPicked] = useState<ModeId | null>(null);

  return (
    <div className="mx-auto flex min-h-[100svh] w-full max-w-4xl flex-col justify-center px-5 py-14">
      <div className="mb-4 flex justify-end"><StreakChip /></div>
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <p className="eyebrow text-ink">Choose your run</p>
        <h1 className="display-caps mt-3 text-4xl text-ink sm:text-6xl">Three ways to play</h1>
        <div className="mx-auto mt-5 h-px w-24 bg-ink" />
      </motion.div>

      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {modes.map((id, i) => {
          const m = MODES[id];
          const Icon = ICON[id];
          const active = picked === id;
          return (
            <motion.button
              key={id}
              type="button"
              onClick={() => { audio.sfx("click"); setPicked(id); }}
              initial={{ opacity: 0, y: 26, rotate: i % 2 ? 1 : -1 }}
              animate={{ opacity: picked && !active ? 0.55 : 1, y: 0, rotate: active ? 0 : i % 2 ? 1 : -1, scale: active ? 1.03 : 1 }}
              transition={{ ...SPRING.pop, delay: i * 0.1 }}
              whileHover={{ y: -6 }}
              className={`paper relative overflow-hidden rounded-[5px] p-6 text-left ${active ? "ring-2 ring-ink ring-offset-2 ring-offset-bg" : ""}`}
            >
              {/* darker overlay + check on the chosen card */}
              {active && (
                <>
                  <span className="pointer-events-none absolute inset-0 bg-ink/15" />
                  <span className="absolute right-3 top-3 z-10 grid h-7 w-7 place-items-center rounded-full border-2 border-bg bg-ink text-bg">
                    <CheckIcon size={15} />
                  </span>
                </>
              )}
              <div className="relative">
                <div className="flex items-center justify-between border-b-2 border-ink pb-2">
                  <span className="eyebrow text-secondary">{m.meta}</span>
                  <span className="text-ink"><Icon size={22} /></span>
                </div>
                <h2 className="display-caps mt-4 text-4xl text-ink">{m.name}</h2>
                <p className="mt-1 font-body text-sm italic text-ink/60">{m.tagline}</p>
                <p className="mt-3 font-body text-[0.95rem] leading-relaxed text-ink/80">{m.blurb}</p>
              </div>
            </motion.button>
          );
        })}
      </div>

      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <NeonButton variant="ghost" size="sm" onClick={onBack}>← Back to title</NeonButton>
        <NeonButton variant="ghost" size="sm" onClick={onLeaderboard}><TrophyIcon size={14} /> Leaderboards</NeonButton>
        <NeonButton variant="ghost" size="sm" onClick={onMasteryMap}><BrainIcon size={14} /> Money Brain</NeonButton>
        <NeonButton variant="primary" size="lg" disabled={!picked} onClick={() => { if (picked) { audio.sfx("confirm"); onChoose(picked); } }}>
          {picked ? `Start ${MODES[picked].name} →` : "Pick a mode"}
        </NeonButton>
      </div>
    </div>
  );
}
