"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { NeonButton } from "@/components/ui/NeonButton";
import { BACKGROUNDS } from "@/lib/backgrounds";
import { currency } from "@/lib/format";
import { MODES, type ModeId } from "@/lib/modes";

export function Setup({
  mode,
  onStart,
  onBack,
}: {
  mode: ModeId;
  onStart: (backgroundId: string, name: string) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string>(BACKGROUNDS[0].id);

  return (
    <div className="mx-auto flex min-h-[100svh] w-full max-w-5xl flex-col justify-center px-5 py-14">
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <p className="eyebrow text-accent">{MODES[mode].name} · starts at age {BACKGROUNDS.find((b) => b.id === picked)?.startAge}</p>
        <h1 className="display-caps mt-3 text-4xl text-ink sm:text-5xl">Who do you become?</h1>
      </motion.div>

      <div className="mx-auto mt-7 w-full max-w-sm">
        <label htmlFor="name" className="eyebrow text-ink-dim">Your name</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Type a name"
          className="mt-1.5 w-full rounded-[4px] border border-ink/20 bg-bg2 px-3 py-2.5 font-serif text-ink outline-none focus:border-accent placeholder:text-ink-dim/60"
        />
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {BACKGROUNDS.map((b, i) => {
          const active = picked === b.id;
          return (
            <motion.button
              key={b.id}
              type="button"
              onClick={() => setPicked(b.id)}
              initial={{ opacity: 0, y: 24, rotate: i % 2 ? 1 : -1 }}
              animate={{ opacity: 1, y: 0, rotate: active ? 0 : i % 2 ? 1 : -1, scale: active ? 1.03 : 1 }}
              transition={{ type: "spring", stiffness: 220, damping: 20, delay: i * 0.07 }}
              whileHover={{ y: -5 }}
              className={`paper rounded-[5px] p-5 text-left ${active ? "ring-2 ring-accent ring-offset-2 ring-offset-bg" : ""}`}
            >
              <div className="flex items-center justify-between border-b-2 border-paper-ink pb-2">
                <span className="eyebrow text-paper-dim">Age {b.startAge}</span>
                <Badge tone={b.difficulty}>{b.difficulty}</Badge>
              </div>
              <h2 className="display-caps mt-3 text-2xl text-paper-ink">{b.name}</h2>
              <p className="mt-1 font-serif text-sm italic text-paper-ink/60">{b.tagline}</p>
              <p className="mt-2.5 font-serif text-[0.86rem] leading-snug text-paper-ink/75">{b.story}</p>
              <dl className="mt-3 space-y-1">
                <Row k="Cash" v={currency(b.cash)} />
                <Row k="Debt" v={currency(b.debt)} />
                <Row k="Salary" v={`${currency(b.salary)}/yr`} />
                <Row k="Job" v={b.job} />
              </dl>
            </motion.button>
          );
        })}
      </div>

      <div className="mt-9 flex items-center justify-center gap-3">
        <NeonButton variant="ghost" size="sm" onClick={onBack}>← Back</NeonButton>
        <NeonButton variant="primary" size="lg" onClick={() => onStart(picked, name)}>
          Start your life →
        </NeonButton>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-paper-ink/15 pb-1">
      <dt className="eyebrow text-paper-dim">{k}</dt>
      <dd className="num text-sm text-paper-ink">{v}</dd>
    </div>
  );
}
