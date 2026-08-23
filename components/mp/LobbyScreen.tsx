"use client";

import { motion } from "framer-motion";
import { useEffect, useId, useRef, useState } from "react";
import { CheckIcon } from "@/components/icons";
import { Avatar } from "@/components/social/Avatar";
import { Badge } from "@/components/ui/Badge";
import { NeonButton } from "@/components/ui/LedgerButton";
import { SoundCell } from "@/components/ui/SoundCell";
import { TerminalOp } from "@/components/ui/TerminalOp";
import { ArmedLabel, useArmedAction } from "@/components/ui/useArmedAction";
import { useAudio } from "@/hooks/useAudio";
import { useMatchCtx, type MatchPeer } from "@/hooks/useMatch";
import { BACKGROUNDS, getBackground } from "@/lib/backgrounds";
import { currency } from "@/lib/format";
import { MAX_PLAYERS, MIN_PLAYERS, YEAR_SECONDS_OPTIONS } from "@/lib/mp/protocol";
import type { YearSeconds } from "@/lib/mp/types";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { DUR, EASE, SPRING, STAGGER, stepDelay } from "@/src/motion/tokens";

/** How long the copy confirmation stays up. */
const COPIED_MS = 1600;
/**
 * How long a lobby waits for the host's presence before it stops calling them
 * "the host we're waiting for" and calls them gone. The join handshake gives up
 * on a config after 5s, so a host seat still empty well past that is empty for
 * good, not slow.
 */
const HOST_SEAT_GRACE_MS = 8000;
/**
 * How long Start stays armed once it has asked about an away player. Longer than
 * `useArmedAction`'s 3s house window on purpose — see `HostStart`.
 */
const ARM_START_MS = 7000;

/**
 * The waiting room.
 *
 * One screen, two audiences. The player who opened the room (`config.hostId` —
 * NOT `match.isHost`, which is the acting *clock* host and can migrate) picks the
 * background and the year length and starts the match; everybody else watches the
 * same picks land, read-only.
 *
 * The room code is the one place in the game where wide-tracked uppercase mono is
 * the point: it is a stamp on a filing, meant to be read out loud over a call.
 *
 * Leaving the lobby happens here whenever the phase flips to `"running"` — on the
 * host's own Start, and on a guest's `start` broadcast. The rejoin cases are NOT
 * this screen's to catch: it is a dynamic import, so it is frequently unmounted at
 * the moment a rejoin settles the room. AppShell owns that door.
 */
export function LobbyScreen({ onStartRun, onLeave }: { onStartRun: () => void; onLeave: () => void }) {
  const match = useMatchCtx();
  const { sfx } = useAudio();
  const { reduced } = useMotionCtx();
  const [copied, setCopied] = useState(false);
  const startedRef = useRef(false);
  const hintId = useId();

  const phase = match?.phase ?? null;

  // The one exit from this screen. Ref-guarded rather than effect-guarded because the
  // parent's callback identity is not ours to depend on, and a match starts once.
  useEffect(() => {
    if (phase !== "running" || startedRef.current) return;
    startedRef.current = true;
    onStartRun();
  }, [phase, onStartRun]);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(id);
  }, [copied]);

  /**
   * A player who joins a room the host has ALREADY left never receives the host's
   * presence at all, so `peers[hostId]` is missing rather than disconnected — the
   * "host is gone" test below looks at a row that was never there, and the
   * newcomer gets the one thing this screen must never show: a spinner waiting on
   * somebody who is not coming. Presence lands inside the handshake, so a host
   * seat still absent long after it is absent for good.
   */
  const hostId = match?.config?.hostId ?? null;
  const hostSeatMissing = !!hostId && !!match && !match.peers[hostId];
  const [hostSeatOverdue, setHostSeatOverdue] = useState(false);
  useEffect(() => {
    setHostSeatOverdue(false);
    if (!hostSeatMissing) return;
    const id = window.setTimeout(() => setHostSeatOverdue(true), HOST_SEAT_GRACE_MS);
    return () => window.clearTimeout(id);
  }, [hostSeatMissing, hostId]);

  const config = match?.config ?? null;
  if (!match || !config) return null;

  const roomCode = config.roomCode;
  /** The lobby owner. `match.isHost` is the acting clock host and is a different question. */
  const hosting = config.hostId === match.selfId;
  const roster = Object.values(match.peers).sort(
    (a, b) => a.joinedAt - b.joinedAt || (a.playerId < b.playerId ? -1 : 1),
  );
  const here = roster.filter((p) => p.connected).length;
  /**
   * The lobby's owner, as presence last saw them. Starting the match, the
   * background and the clock are all `config.hostId`'s alone and none of it
   * migrates — so a lobby whose host closed their tab cannot start, and telling
   * everybody else to keep waiting for them is the one thing it must not do.
   * `hostRow` exists only once presence has actually seen the host, so this can't
   * fire on a guest's first frame.
   */
  const hostRow = match.peers[config.hostId];
  // Two ways to lose a host: presence saw them leave, or it never saw them at all.
  const hostGone = (!!hostRow && !hostRow.connected) || hostSeatOverdue;
  /** Seats that are here in the list but not on the wire. `startMatch` freezes the
   *  roster from the CONNECTED rows, so starting now leaves these players out. */
  const away = roster.filter((p) => !p.connected).map((p) => p.name);
  // Only ever draws the seats the room still NEEDS — eight hollow rows would read as
  // eight missing players rather than as headroom.
  const openSlots = Math.max(0, MIN_PLAYERS - roster.length);
  const ready = here >= MIN_PLAYERS;
  const picked = getBackground(config.backgroundId);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      sfx("uitick");
    } catch {
      // No clipboard permission (or no API): the code is selectable text right there.
      setCopied(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[100svh] w-full max-w-3xl flex-col justify-center px-5 py-14">
      <div className="mb-4 flex items-center justify-end"><SoundCell /></div>

      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <p className="eyebrow text-ink">The waiting room</p>
        <h1 className="display-caps mt-3 text-4xl text-ink sm:text-5xl">Same years, same markets</h1>
        <div className="mx-auto mt-5 h-px w-24 bg-ink" />
      </motion.div>

      {/* ── the stamp ─────────────────────────────────────────────────────── */}
      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.35 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={reduced ? { duration: DUR.instant, ease: EASE } : SPRING.pop}
        className="mx-auto mt-8 w-full max-w-sm border-2 border-hairline-strong p-1.5 text-center"
      >
        <div className="border border-hairline px-4 py-5">
          <p className="eyebrow text-secondary" style={{ fontSize: "0.58rem" }}>
            Room code
          </p>
          {/* `textIndent` cancels the trailing letter-space so wide tracking stays
              optically centred instead of sitting a third of a character left. */}
          <p
            className="num mt-2 text-4xl leading-none text-ink sm:text-5xl"
            style={{ letterSpacing: "0.32em", textIndent: "0.32em" }}
          >
            {roomCode}
          </p>
          <button
            type="button"
            onClick={copyCode}
            data-radius=""
            className="mt-4 inline-flex min-h-11 items-center gap-1.5 border border-hairline-strong px-3 eyebrow text-ink-dim transition-colors hover:border-ink hover:text-ink"
            style={{ fontSize: "0.6rem" }}
          >
            {copied ? (
              <>
                <CheckIcon size={13} /> Copied
              </>
            ) : (
              "Copy the code"
            )}
          </button>
        </div>
      </motion.div>
      <p className="voice mx-auto mt-3 max-w-sm text-center text-sm text-ink/60">
        Read it out. Anyone with the code can take a seat until the host starts.
      </p>

      {/* ── the table ─────────────────────────────────────────────────────── */}
      <section aria-label="Players in the room" className="paper mt-8 p-4">
        <div className="flex items-baseline justify-between border-b border-hairline pb-2">
          <p className="eyebrow text-secondary">At the table</p>
          <p className="num text-[0.65rem] tracking-[0.16em] text-tertiary" aria-live="polite">
            {here} / {MAX_PLAYERS}
          </p>
        </div>
        <ul className="mt-1">
          {roster.map((p, i) => (
            <PlayerRow
              key={p.playerId}
              peer={p}
              index={i}
              reduced={reduced}
              isSelf={p.playerId === match.selfId}
              isHost={p.playerId === config.hostId}
            />
          ))}
          {Array.from({ length: openSlots }, (_, i) => (
            <li
              key={`open-${i}`}
              className="flex items-center gap-3 border-b border-hairline/60 py-2 last:border-b-0"
            >
              <span aria-hidden className="h-[30px] w-[30px] shrink-0 border border-hairline" />
              <span className="eyebrow text-tertiary" style={{ fontSize: "0.6rem" }}>
                Open seat
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── the picks ─────────────────────────────────────────────────────── */}
      <section aria-label="Match settings" className="mt-6">
        <div className="flex items-baseline justify-between border-b border-hairline pb-2">
          <p className="eyebrow text-secondary">Everyone starts here</p>
          {/* One live region per screen is plenty — the bottom of the lobby already
              carries the "waiting on the host" caret, so this stays quiet text. */}
          {!hosting && (
            <p className="eyebrow text-tertiary" style={{ fontSize: "0.55rem" }}>
              The host&rsquo;s pick
            </p>
          )}
        </div>

        {hosting ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {BACKGROUNDS.map((b, i) => {
              const active = b.id === config.backgroundId;
              return (
                <motion.button
                  key={b.id}
                  type="button"
                  onClick={() => { sfx("uitick"); match.setBackground(b.id); }}
                  aria-pressed={active}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SPRING.pop, delay: stepDelay(i, STAGGER.base) }}
                  data-radius=""
                  // `ring-*` is box-shadow, which the LEDGER reset kills — a real inset outline.
                  style={active ? { outline: "2px solid var(--color-accent)", outlineOffset: "-2px" } : undefined}
                  className="paper relative overflow-hidden p-3 text-left"
                >
                  {active && (
                    <>
                      <span aria-hidden className="pointer-events-none absolute inset-0 z-[1] bg-ink/15" />
                      <span
                        data-radius="round"
                        className="absolute right-2 top-2 z-10 grid h-6 w-6 place-items-center border-2 border-bg bg-accent text-bg"
                      >
                        <CheckIcon size={13} />
                      </span>
                    </>
                  )}
                  {/* The check disc sits in this corner when the card is picked, and it
                      is drawn over the header — so the header gives the badge room to
                      move out from under it rather than losing its last letter. */}
                  <div className={`relative flex items-center justify-between border-b border-ink pb-1.5 ${active ? "pr-7" : ""}`}>
                    <span className="eyebrow text-secondary" style={{ fontSize: "0.56rem" }}>
                      Age {b.startAge}
                    </span>
                    <Badge tone={b.difficulty}>{b.difficulty}</Badge>
                  </div>
                  <h2 className="display-caps relative mt-2 text-lg text-ink">{b.name}</h2>
                  <p className="relative mt-1 num text-[0.68rem] text-tertiary">
                    {currency(b.cash)} cash · {currency(b.debt)} debt
                  </p>
                </motion.button>
              );
            })}
          </div>
        ) : (
          <div className="paper mt-3 p-4">
            <div className="flex items-center justify-between border-b border-ink pb-1.5">
              <span className="eyebrow text-secondary" style={{ fontSize: "0.56rem" }}>
                Age {picked.startAge}
              </span>
              <Badge tone={picked.difficulty}>{picked.difficulty}</Badge>
            </div>
            <h2 className="display-caps mt-2 text-xl text-ink">{picked.name}</h2>
            <p className="voice mt-1 text-sm text-ink/60">{picked.tagline}</p>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="eyebrow text-secondary">Each year lasts</p>
          {hosting ? (
            <div role="group" aria-label="Seconds per year" className="flex gap-1">
              {YEAR_SECONDS_OPTIONS.map((s: YearSeconds) => {
                const on = s === config.yearSeconds;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => { sfx("uitick"); match.setYearSeconds(s); }}
                    aria-pressed={on}
                    data-radius=""
                    className={`num inline-flex min-h-11 min-w-[3.5rem] items-center justify-center gap-1 border px-2 text-sm transition-colors ${
                      on ? "border-ink bg-ink text-bg" : "border-hairline-strong text-ink-dim hover:bg-ink/10 hover:text-ink"
                    }`}
                  >
                    {/* non-colour selection cue, kept in flow so picking never reflows */}
                    <span aria-hidden className={on ? "opacity-100" : "opacity-0"}>[</span>
                    {s}s
                    <span aria-hidden className={on ? "opacity-100" : "opacity-0"}>]</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="num text-lg text-ink">{config.yearSeconds}s</p>
          )}
        </div>
        <p className="voice mt-2 text-xs text-secondary">
          When the clock runs out the year turns for everyone — unanswered choices resolve themselves.
        </p>
      </section>

      {/* Not an alert and not loss-red: nothing is wrong and nothing is refused —
          this tab is simply not the one the room is listening to. */}
      {match.openElsewhere && (
        <p className="voice mx-auto mt-5 max-w-sm text-center text-xs leading-snug text-ink-dim">
          This room is also open in another tab on this device. That tab holds the seat.
        </p>
      )}

      {match.error && (
        <p role="alert" className="mt-5 font-body text-[0.82rem] leading-snug text-loss">
          <span aria-hidden>▲ </span>
          {match.error}
        </p>
      )}

      {/* ── out ───────────────────────────────────────────────────────────── */}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <NeonButton
          variant="ghost"
          size="sm"
          onClick={() => { match.leaveMatch(); onLeave(); }}
        >
          ← Leave the room
        </NeonButton>
        {hosting ? (
          <HostStart away={away} here={here} ready={ready} hintId={hintId} onStart={() => match.startMatch()} />
        ) : hostGone ? (
          // A spinner here would be a lie: nobody inherits the Start button.
          <p role="alert" className="voice max-w-xs text-xs leading-snug text-ink-dim">
            The host left. Nobody else can start this room — wait for them to come back
            with the code, or leave and open a new one.
          </p>
        ) : (
          <TerminalOp label="Waiting for the host to start" />
        )}
      </div>
    </div>
  );
}

/**
 * Start, and the question it has to ask first.
 *
 * `startMatch` freezes the roster from the CONNECTED rows, so a player showing
 * away is left out of the match for good — a consequence that earns the house's
 * two-tap confirmation (`useArmedAction`, the same idiom as AuthGate's overwrite)
 * rather than a line of text beside the button that a host in a hurry reads after
 * the fact.
 *
 * It is never DISABLED for it, though: nothing prunes an away row, so a friend who
 * wandered off an hour ago must not be able to hold the room shut for good. The
 * only thing that greys this button is the two-player minimum, as before.
 *
 * Its own component so the arming hook can live below this screen's early return.
 */
function HostStart({
  away,
  here,
  ready,
  hintId,
  onStart,
}: {
  /** Names of the seats Start would leave behind. Empty means nothing to ask. */
  away: string[];
  /** Seats actually on the wire — the only ones the minimum counts. */
  here: number;
  ready: boolean;
  hintId: string;
  onStart: () => void;
}) {
  const { sfx } = useAudio();
  const fire = () => { sfx("uitick"); onStart(); };
  /**
   * One name reads as a person; several read as a count. Seven names of up to 24
   * characters each, joined into a button label, wrap the CTA off a 390px screen —
   * and the roster directly above this button already marks every one of them
   * "Away", so the count is a pointer at a list the host is already looking at.
   */
  const who = away.length === 1 ? away[0] : `${away.length} players`;
  const start = useArmedAction({
    label: "Start the match →",
    armedLabel: `Tap again to start without ${who}`,
    onConfirm: fire,
    onArm: () => sfx("uitick"),
    // Longer than the house 3s. Every other armed control asks the host about
    // their OWN last action ("really overwrite your save?"), which needs no
    // reading. This one names another person and the honest response is to look
    // back up at the roster before answering — at 3s the question times out
    // mid-glance and the next tap re-arms instead of starting, which reads as a
    // button that refuses to work.
    timeoutMs: ARM_START_MS,
  });
  const asking = away.length > 0;
  // Everybody came back, so the question no longer has an answer. Left armed, the
  // next tap would confirm something that has stopped being true.
  const reset = start.reset;
  useEffect(() => {
    if (!asking) reset();
  }, [asking, reset]);

  const armed = asking && start.armed;
  /**
   * Why the button is grey. `here` counts only CONNECTED rows, so a host whose
   * only friend just closed their tab is told to wait for "1 more" while that
   * friend's name sits in the roster right above — which reads as needing a
   * stranger to turn up, and nothing ever prunes the away row, so the wait would
   * have no end. Name the away seat instead: the count is the same, the reason
   * for it is not.
   */
  const need = MIN_PLAYERS - here;
  // `who` is either one person's name or a count of them, so the verb has to follow.
  const hint = asking
    ? `${who} ${away.length === 1 ? "is away and doesn't" : "are away and don't"} count — you need ${need} more here to start`
    : `Waiting for ${need} more`;
  return (
    <>
      {!ready && (
        <span id={hintId} className="voice max-w-[16rem] text-xs leading-snug text-ink-dim">
          {hint}
        </span>
      )}
      <NeonButton
        // The armed label is the question the host has to READ, so it cannot sit on
        // the accent fill: ink on orange measures 1.12:1 and DESIGN.md § Palette
        // hard rule 1 allows only paper there. `danger` puts the red on the page
        // ground instead (5.4:1) and knocks the label out in paper on hover — the
        // same swap AuthGate and CashflowGame make for their armed CTAs. The screen
        // keeps one accent path either way: this button is the only one on it.
        variant={armed ? "danger" : "primary"}
        size="lg"
        disabled={!ready}
        aria-describedby={ready ? undefined : hintId}
        // Armed, the label IS the message, so it has to be the accessible name too.
        aria-label={armed ? start.label : undefined}
        onClick={asking ? start.onClick : fire}
        onBlur={asking ? start.onBlur : undefined}
      >
        {/* The label only ever changes while somebody is away, so a room with
            everyone present is exactly the room it has always been. */}
        <ArmedLabel>
          {asking ? start.label : "Start the match →"}
        </ArmedLabel>
      </NeonButton>
    </>
  );
}

function PlayerRow({
  peer,
  index,
  reduced,
  isSelf,
  isHost,
}: {
  peer: MatchPeer;
  index: number;
  reduced: boolean;
  isSelf: boolean;
  isHost: boolean;
}) {
  return (
    <motion.li
      initial={reduced ? { opacity: 0 } : { opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: DUR.instant, ease: EASE, delay: stepDelay(index, STAGGER.tight) }}
      className="flex items-center gap-3 border-b border-hairline/60 py-2 last:border-b-0"
    >
      <Avatar seed={peer.avatarSeed} username={peer.name} size={30} />
      <span className={`min-w-0 flex-1 truncate font-body text-sm ${peer.connected ? "text-ink" : "text-tertiary"}`}>
        {peer.name}
        {isSelf && <span className="ml-1.5 eyebrow text-tertiary" style={{ fontSize: "0.55rem" }}>you</span>}
      </span>
      {isHost && (
        <span className="eyebrow text-secondary" style={{ fontSize: "0.55rem" }}>
          Host
        </span>
      )}
      {/* Never a colour-only state, and never an opacity dim: dropping this row's
          text to read as "away" would take it under the 4.5:1 floor. */}
      {!peer.connected && (
        <span className="eyebrow text-tertiary" style={{ fontSize: "0.55rem" }}>
          Away
        </span>
      )}
    </motion.li>
  );
}
