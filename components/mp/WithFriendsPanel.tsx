"use client";

import { motion } from "framer-motion";
import { useEffect, useId, useState } from "react";
import { ArrowRight, CloseIcon } from "@/components/icons";
import { NeonButton } from "@/components/ui/LedgerButton";
import { playerName } from "@/components/ui/NameField";
import { useAudio } from "@/hooks/useAudio";
import { useMatch } from "@/hooks/useMatch";
import { MAX_PLAYERS, MIN_PLAYERS } from "@/lib/mp/protocol";
import { ROOM_CODE_LENGTH, isRoomCode, normalizeRoomCode } from "@/lib/mp/roomCodes";
import { createTransport } from "@/lib/mp/transport";
import { DUR, EASE } from "@/src/motion/tokens";

/**
 * The entry to a live room, mounted under Setup's solo flow (story only).
 *
 * It reads `useMatch()` rather than `useMatchCtx()` on purpose: `useMatchCtx()` is
 * null until a match EXISTS, which is exactly the state this panel is here to leave.
 * Everything downstream of it (YearLoop, AdvanceBar, the rails) keeps using
 * `useMatchCtx()`, so every solo path still renders as if multiplayer weren't here.
 *
 * Both entry points end in one callback. `onEnterLobby()` fires for a fresh join AND
 * for a rejoin into a match that is already running — the parent routes on
 * `match.phase` (`"lobby"` vs `"running"`), which is already settled by the time the
 * callback runs. See LobbyScreen: it calls `onStartRun()` whenever the phase is
 * `"running"`, including on mount, so the rejoin path needs no second door.
 *
 * LEDGER: the panel carries NO primary (orange) button. Setup's "Start your life"
 * is the primary path on that screen and the accent marks one path per screen —
 * playing with friends is the alternative, so it is stated in secondary.
 *
 * The room worth going back to is Setup's to know, not this panel's: the same
 * answer decides whether the solo CTA above needs to ask twice, and two lookups
 * would drift the moment one of them learns the room is gone.
 */
export function WithFriendsPanel({
  name,
  onEnterLobby,
  lastRoom,
  onRoomGone,
}: {
  name: string;
  onEnterLobby: () => void;
  /** The last room this device was in, if it is recent enough to still be live. */
  lastRoom?: string | null;
  /** That room turned us away — stop offering it. */
  onRoomGone?: () => void;
}) {
  const match = useMatch();
  const { sfx } = useAudio();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /**
   * Whether this build can reach other players at all. Assumed true for the first
   * paint so the server and the client agree — `createTransport()` reads
   * `BroadcastChannel`, which does not exist during SSR, and probing it in render
   * would hand hydration two different answers.
   */
  const [online, setOnline] = useState(true);
  const codeId = useId();
  const errId = useId();

  useEffect(() => {
    setOnline(createTransport() !== null);
  }, []);

  const disabled = busy !== null;
  const shown = err ?? match.error;

  async function create() {
    setErr(null);
    setBusy("create");
    sfx("uitick");
    try {
      await match.createRoom(playerName(name));
      onEnterLobby();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't open a room.");
    } finally {
      setBusy(null);
    }
  }

  async function joinCode(raw: string) {
    if (!isRoomCode(raw)) {
      setErr("A room code is six letters and numbers.");
      return;
    }
    setErr(null);
    setBusy("join");
    sfx("uitick");
    try {
      await match.joinRoom(raw, playerName(name));
      onEnterLobby();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Couldn't join that room.");
      // The room is gone or finished, so stop offering it as a way back — and
      // remember that, or a reload offers the same dead room all over again.
      if (raw === lastRoom) onRoomGone?.();
    } finally {
      setBusy(null);
    }
  }

  async function join(e: React.FormEvent) {
    e.preventDefault();
    await joinCode(code);
  }

  return (
    <motion.section
      aria-label="Play with friends"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.base, ease: EASE, delay: 0.18 }}
      className="paper mx-auto mt-8 w-full max-w-2xl p-5"
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-2">
        <p className="eyebrow text-ink">Play with friends</p>
        <p className="num text-[0.6rem] tracking-[0.16em] text-tertiary">
          {MIN_PLAYERS}–{MAX_PLAYERS} PLAYERS
        </p>
      </div>
      {/* Somebody who lost a match to a closed tab lands here needing one thing, and
          it is not a fresh room. Offer the way back first, before the two doors that
          start something new. */}
      {online && lastRoom && (
        <div className="mt-3.5 border-l-2 border-hairline-strong bg-bg2 px-3 py-2.5">
          <p className="voice text-[0.82rem] leading-snug text-secondary">
            You were in room{" "}
            <span className="num tracking-[0.18em] text-ink">{lastRoom}</span>. If it is
            still running, you can pick your life back up where the room got to.
          </p>
          <div className="mt-2.5">
            <NeonButton
              variant="secondary"
              size="sm"
              onClick={() => void joinCode(lastRoom)}
              disabled={disabled}
              loading={busy === "join"}
            >
              Rejoin {lastRoom} <ArrowRight size={14} />
            </NeonButton>
          </div>
        </div>
      )}

      <p className="voice mt-2.5 text-sm text-ink/70">
        One room, one seed — the same markets and the same clock for everybody in it.
      </p>

      {!online ? (
        <p className="mt-4 border-l-2 border-hairline-strong bg-bg2 px-3 py-2.5 font-body text-[0.85rem] leading-snug text-secondary">
          Online play needs the cloud connection — this build doesn&rsquo;t have one configured.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <NeonButton
              variant="secondary"
              size="md"
              onClick={create}
              disabled={disabled}
              loading={busy === "create"}
            >
              Create a room
            </NeonButton>
            {!open && (
              <NeonButton variant="ghost" size="md" onClick={() => { sfx("uitick"); setOpen(true); }} disabled={disabled}>
                Join with a code
              </NeonButton>
            )}
          </div>

          {open && (
            <motion.form
              onSubmit={join}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DUR.instant, ease: EASE }}
              className="mt-4 border-t border-hairline pt-4"
            >
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label htmlFor={codeId} className="eyebrow text-ink-dim">
                    Room code
                  </label>
                  {/* The stamp typography of the lobby's big code, at input scale — a
                      player types what they were read out, and it should look the same. */}
                  <input
                    id={codeId}
                    value={code}
                    onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
                    maxLength={ROOM_CODE_LENGTH}
                    placeholder="KX7F2M"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    aria-describedby={shown ? errId : undefined}
                    data-radius=""
                    className="num mt-1.5 w-full border border-hairline-strong bg-bg2 px-3 py-2.5 text-lg uppercase text-ink outline-none placeholder:text-tertiary focus:border-ink"
                    style={{ letterSpacing: "0.3em" }}
                  />
                </div>
                <NeonButton variant="secondary" size="md" type="submit" disabled={disabled} loading={busy === "join"}>
                  Join <ArrowRight size={15} />
                </NeonButton>
                <button
                  type="button"
                  onClick={() => { setOpen(false); setCode(""); setErr(null); }}
                  aria-label="Cancel joining a room"
                  data-radius=""
                  className="grid h-11 w-11 shrink-0 place-items-center border border-hairline-strong text-ink-dim transition-colors hover:border-ink hover:text-ink"
                >
                  <CloseIcon size={14} />
                </button>
              </div>
            </motion.form>
          )}
        </>
      )}

      {shown && (
        // Colour is never the only channel: the mark carries the alarm too.
        <p id={errId} role="alert" className="mt-3 font-body text-[0.82rem] leading-snug text-loss">
          <span aria-hidden>▲ </span>
          {shown}
        </p>
      )}
    </motion.section>
  );
}
