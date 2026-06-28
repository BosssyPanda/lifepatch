"use client";

import { motion } from "framer-motion";
import { TrophyIcon, ReplayIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/NeonButton";
import { MODES, type ModeId } from "@/lib/modes";

const ICON = { story: TrophyIcon, infinite: ReplayIcon };

export function ModeSelect({
  onChoose,
  onBack,
}: {
  onChoose: (mode: ModeId) => void;
  onBack: () => void;
}) {
  const modes: ModeId[] = ["story", "infinite"];
  return (
    <div className="mx-auto flex min-h-[100svh] w-full max-w-4xl flex-col justify-center px-5 py-14">
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <p className="eyebrow text-accent">Choose your run</p>
        <h1 className="display-caps mt-3 text-4xl text-ink sm:text-6xl">Two ways to play</h1>
        <div className="mx-auto mt-5 h-px w-24 bg-accent" />
      </motion.div>

      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        {modes.map((id, i) => {
          const m = MODES[id];
          const Icon = ICON[id];
          return (
            <motion.button
              key={id}
              type="button"
              onClick={() => onChoose(id)}
              initial={{ opacity: 0, y: 26, rotate: i % 2 ? 1 : -1 }}
              animate={{ opacity: 1, y: 0, rotate: 0 }}
              transition={{ type: "spring", stiffness: 220, damping: 20, delay: i * 0.1 }}
              whileHover={{ y: -6 }}
              className="paper rounded-[5px] p-6 text-left"
            >
              <div className="flex items-center justify-between border-b-2 border-paper-ink pb-2">
                <span className="eyebrow text-paper-dim">{m.range}</span>
                <span className="text-paper-ink"><Icon size={22} /></span>
              </div>
              <h2 className="display-caps mt-4 text-4xl text-paper-ink">{m.name}</h2>
              <p className="mt-1 font-serif text-sm italic text-paper-ink/60">{m.tagline}</p>
              <p className="mt-3 font-serif text-[0.95rem] leading-relaxed text-paper-ink/80">{m.blurb}</p>
              <span className="mt-4 inline-block eyebrow text-accent">Play {m.name} →</span>
            </motion.button>
          );
        })}
      </div>

      <div className="mt-9 text-center">
        <NeonButton variant="ghost" size="sm" onClick={onBack}>← Back to title</NeonButton>
      </div>
    </div>
  );
}
