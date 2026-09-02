"use client";

import { motion } from "framer-motion";
import { useEffect, useId, useState } from "react";
import { CheckIcon } from "@/components/icons";
import { WithFriendsPanel } from "@/components/mp/WithFriendsPanel";
import { Badge } from "@/components/ui/Badge";
import { NeonButton } from "@/components/ui/LedgerButton";
import { NameField, playerName } from "@/components/ui/NameField";
import { SoundCell } from "@/components/ui/SoundCell";
import { ArmedLabel, useArmedAction } from "@/components/ui/useArmedAction";
import { useAudio } from "@/hooks/useAudio";
import { useMatch } from "@/hooks/useMatch";
import { BACKGROUNDS } from "@/lib/backgrounds";
import { currency } from "@/lib/format";
import { MODES, type ModeId } from "@/lib/modes";
import { dismissRoom, lastPlayerName, recentRoom, rememberPlayerName, type RecentRoom } from "@/lib/mp/matchStore";
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
  // `createRoom`/`joinRoom` publish the room's phase SYNCHRONOUSLY and only then
  // await the transport handshake — several seconds of spinner on a slow or wrong
  // code. The panel below greys its own buttons for that window; this door has to
  // close too, or an impatient tap starts a solo life that already wears the room's
  // chrome and is taken away the moment the join lands. Every failure path in the
  // hook resets the phase to null, so this is disabled for exactly that window.
  const match = useMatch();
  const opening = match.phase !== null;
  const openingId = useId();
  const [name, setName] = useState("");
  /**
   * The name this device last played under. Read on mount rather than in the
   * initial state, for the same reason `room` below is: the server paints no
   * localStorage, and the first client paint has to agree with it.
   *
   * SOLO-VISIBLE, and deliberately so — it is also the only fix available for a
   * player who reloads out of a LOBBY, where presence is self-authored and there
   * is no frozen roster to take a name back from (see lib/mp/matchStore).
   */
  useEffect(() => {
    const last = lastPlayerName();
    if (last) setName((cur) => cur || last);
  }, []);
  const [picked, setPicked] = useState<string>(BACKGROUNDS[0].id);
  const chosen = BACKGROUNDS.find((b) => b.id === picked);
  /**
   * The room this device is still in, if any. Read once on mount rather than in
   * the initial state so the server and the first client paint agree.
   *
   * It answers two questions on this screen: the panel below offers it back, and
   * the CTA beside it asks twice before starting a SECOND life — a player who
   * reloaded mid-match lands here with the room still holding their seat and
   * ghost-playing them, and the orange button one tap above the way back would
   * otherwise start a solo run with no hint that the first life still exists.
   */
  const [room, setRoom] = useState<RecentRoom | null>(null);
  useEffect(() => {
    if (mode !== "story") return;
    setRoom(recentRoom());
  }, [mode]);
  const roomGone = () => {
    if (room) dismissRoom(room.roomCode);
    setRoom(null);
  };
  const startSolo = () => {
    audio.sfx("confirm");
    // A name is committed here, not while it is being typed.
    rememberPlayerName(name);
    onStart(picked, playerName(name));
  };
  // Only a room whose life is still open can be walked away from by accident.
  const liveRoom = room && !room.ended ? room.roomCode : null;
  const armedStart = useArmedAction({
    label: "Start your life →",
    armedLabel: liveRoom ? `Still in room ${liveRoom} — tap again to start a solo life` : "Tap again to start a solo life",
    onConfirm: startSolo,
    onArm: () => audio.sfx("uitick"),
  });

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
              {/* The check disc sits in this corner when the card is picked, and it
                  is drawn over the header — so the header gives the badge room to
                  move out from under it rather than losing its last letter. The
                  same card in `components/mp/LobbyScreen.tsx` already does this;
                  this one is where the note came from. The disc is 28px at
                  `right-3`, and CHILL / NORMAL / BRUTAL sit flush right, so what
                  it covered was the final letter or two and the badge's border. */}
              <div
                className={`relative flex items-center justify-between border-b-2 border-ink pb-2 ${active ? "pr-9" : ""}`}
              >
                <span className="eyebrow text-secondary">Age {b.startAge}</span>
                <Badge tone={b.difficulty}>{b.difficulty}</Badge>
              </div>
              {/* `relative` on each: the `bg-ink/15` selected-wash above is
                  `absolute inset-0 z-[1]`, so anything left un-positioned is
                  painted OVER rather than merely tinted. */}
              <h2 className="display-caps relative mt-3 text-2xl text-ink">{b.name}</h2>
              <p className="voice relative mt-1 text-sm text-ink/60">{b.tagline}</p>
              <p className="relative mt-2.5 font-body text-[0.86rem] leading-snug text-ink/75">{b.story}</p>
              <dl className="relative mt-3 space-y-1">
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
          // Armed, this button asks a question the player has to READ, and a red
          // label cannot sit on the accent fill (DESIGN.md § Palette, hard rule 1 —
          // ink on orange measures 1.12:1). The fill hands back for exactly the
          // window in which this is a question, the same swap AuthGate makes.
          // Reachable ONLY for a player still sitting in a room: a solo screen
          // never arms, so it is exactly the screen it has always been.
          variant={liveRoom && armedStart.armed ? "danger" : "primary"}
          size="lg"
          // The CTA copy never changes, and a card is already picked on mount — so the
          // accessible name has to carry which one, the way ModeSelect's visible label does.
          // Armed, the label IS the message and has to be the accessible name too.
          aria-label={
            liveRoom && armedStart.armed
              ? armedStart.label
              : chosen
                ? `Start your life as ${chosen.name}`
                : undefined
          }
          disabled={opening}
          aria-describedby={opening ? openingId : undefined}
          onClick={liveRoom ? armedStart.onClick : startSolo}
          onBlur={liveRoom ? armedStart.onBlur : undefined}
        >
          {/* The label only ever changes for a player who is still in a room, so a
              solo screen is exactly the screen it has always been. */}
          <ArmedLabel>
            {liveRoom ? armedStart.label : "Start your life →"}
          </ArmedLabel>
        </NeonButton>
      </div>

      {/* A greyed CTA never ships without its reason (same rule as AdvanceBar). Its
          own line, so the solo row above is exactly the row it has always been. */}
      {opening && (
        <p id={openingId} className="voice mt-3 text-center text-xs text-ink-dim">
          Opening your room…
        </p>
      )}

      {/* The second door. Solo remains the primary path — it keeps the one accent
          CTA on this screen — and the room is ruled off below it the way a form
          separates its sections. Story only: a shared 1990–2010 world is the whole
          basis of a fair match, and Infinite has no shared ending to race to. */}
      {mode === "story" && onEnterLobby && (
        <div className="mx-auto mt-10 w-full max-w-md border-t border-hairline pt-8">
          <WithFriendsPanel
            name={playerName(name)}
            onEnterLobby={onEnterLobby}
            lastRoom={room?.roomCode ?? null}
            onRoomGone={roomGone}
          />
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
