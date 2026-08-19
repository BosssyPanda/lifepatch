"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { CheckIcon } from "@/components/icons";
import { WithFriendsPanel } from "@/components/mp/WithFriendsPanel";
import { Badge } from "@/components/ui/Badge";
import { NeonButton } from "@/components/ui/LedgerButton";
import { NameField, playerName } from "@/components/ui/NameField";
import { SoundCell } from "@/components/ui/SoundCell";
import { useAudio } from "@/hooks/useAudio";
import { BACKGROUNDS } from "@/lib/backgrounds";
import { currency } from "@/lib/format";
import { MODES, type ModeId } from "@/lib/modes";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { useSpotlightHandler } from "@/src/motion/useSpotlight";
import { SPRING, STAGGER } from "@/src/motion/tokens";

export function Setup({
  mode,
  onStart,
  onBack,
  onEnterLobby,
}: {
  mode: ModeId;
  onStart: (backgroundId: string, name: string) => void;
  onBack: () => void;
  /** Story only: the player opened or joined a room and the lobby takes over. */
  onEnterLobby?: () => void;
}) {
  const audio = useAudio();
  const { reduced } = useMotionCtx();
  const onSpot = useSpotlightHandler<HTMLButtonElement>();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string>(BACKGROUNDS[0].id);
  const chosen = BACKGROUNDS.find((b) => b.id === picked);

  return (
    <div className="mx-auto flex min-h-[100svh] w-full max-w-5xl flex-col justify-center px-5 py-14">
      <SoundCell className="mb-4" />
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <p className="eyebrow text-ink">{MODES[mode].name} · starts at age {chosen?.startAge}</p>
        <h1 className="display-caps mt-3 text-4xl text-ink sm:text-5xl">Who do you become?</h1>
      </motion.div>

      <NameField value={name} onChange={setName} className="mx-auto mt-7 w-full max-w-sm" />

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {BACKGROUNDS.map((b, i) => {
          const active = picked === b.id;
          return (
            <motion.button
              key={b.id}
              type="button"
              onClick={() => setPicked(b.id)}
              aria-pressed={active}
              initial={{ opacity: 0, y: 24, rotate: i % 2 ? 1 : -1 }}
              // No dim on the unpicked cards: one is pre-picked on mount, so dimming would
              // hold the other two below the contrast floor for the whole screen. Selection
              // already reads from the outline, the ink wash, the check badge and the scale.
              animate={{ opacity: 1, y: 0, rotate: active ? 0 : i % 2 ? 1 : -1, scale: active ? 1.03 : 1 }}
              transition={{ ...SPRING.pop, delay: i * STAGGER.base }}
              whileHover={reduced ? undefined : { y: -5 }}
              data-radius=""
              // `ring-*` is box-shadow, which the LEDGER reset kills — a real inset outline.
              style={active ? { outline: "2px solid var(--color-accent)", outlineOffset: "-2px" } : undefined}
              onPointerMove={onSpot}
              className="paper spotlight relative overflow-hidden p-5 text-left"
            >
              {active && (
                <>
                  <span className="pointer-events-none absolute inset-0 z-[1] bg-ink/15" />
                  <span data-radius="round" className="absolute right-3 top-3 z-10 grid h-7 w-7 place-items-center border-2 border-bg bg-accent text-bg">
                    <CheckIcon size={15} />
                  </span>
                </>
              )}
              <div className="flex items-center justify-between border-b-2 border-ink pb-2">
                <span className="eyebrow text-secondary">Age {b.startAge}</span>
                <Badge tone={b.difficulty}>{b.difficulty}</Badge>
              </div>
              <h2 className="display-caps mt-3 text-2xl text-ink">{b.name}</h2>
              <p className="voice mt-1 text-sm text-ink/60">{b.tagline}</p>
              <p className="mt-2.5 font-body text-[0.86rem] leading-snug text-ink/75">{b.story}</p>
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
        <NeonButton
          variant="primary"
          size="lg"
          // The CTA copy never changes, and a card is already picked on mount — so the
          // accessible name has to carry which one, the way ModeSelect's visible label does.
          aria-label={chosen ? `Start your life as ${chosen.name}` : undefined}
          onClick={() => { audio.sfx("confirm"); onStart(picked, playerName(name)); }}
        >
          Start your life →
        </NeonButton>
      </div>

      {/* The second door. Solo remains the primary path — it keeps the one accent
          CTA on this screen — and the room is ruled off below it the way a form
          separates its sections. Story only: a shared 1990–2010 world is the whole
          basis of a fair match, and Infinite has no shared ending to race to. */}
      {mode === "story" && onEnterLobby && (
        <div className="mx-auto mt-10 w-full max-w-md border-t border-hairline pt-8">
          <WithFriendsPanel name={playerName(name)} onEnterLobby={onEnterLobby} />
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-ink/15 pb-1">
      <dt className="eyebrow text-secondary">{k}</dt>
      <dd className="num text-sm text-ink">{v}</dd>
    </div>
  );
}
