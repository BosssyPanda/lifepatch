"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useRef } from "react";
import { Avatar } from "@/components/social/Avatar";
import { AnimatedNumber } from "@/components/story/AnimatedNumber";
import { NeonButton } from "@/components/ui/LedgerButton";
import { SoundCell } from "@/components/ui/SoundCell";
import { TerminalOp } from "@/components/ui/TerminalOp";
import { useAudio } from "@/hooks/useAudio";
import { useMatchCtx, type MatchPeer } from "@/hooks/useMatch";
import { currency } from "@/lib/format";
import { netWorth, type RunState } from "@/lib/runEngine";
import { deriveVerdict } from "@/lib/verdict";
import { useMotionCtx } from "@/src/motion/MotionProvider";
import { DUR, EASE, SPRING, STAGGER, stepDelay } from "@/src/motion/tokens";

/**
 * Gold / silver / bronze as the ledger prints them — three tiers of ink, never a
 * decorative palette. Same discs the global leaderboard uses.
 */
const MEDALS = ["var(--color-ink)", "var(--color-secondary)", "var(--color-tertiary)"];

/** How each ending reads in a standings row. Derived from the engine's own reasons. */
const END_LABEL: Record<string, string> = {
  "story-complete": "Finished",
  retired: "Retired",
  quit: "Dropped out",
  died: "Died",
  insolvent: "Debt won",
};

/**
 * Where a match ends.
 *
 * Two states, one screen. While anyone is still playing it is a live board and the
 * player who got here first watches the rest of the room finish; once the room is
 * `"finished"` the top three are stamped in and the whole list prints below them.
 *
 * The run prop is this player's own closed ledger — it supplies the figure and the
 * verdict for the "you" strip, and it is the run the report button opens. If the
 * player has already left the room (no match context) the screen still prints that
 * strip and both doors, because a match that ended is not a reason to trap someone.
 */
export function MatchPodium({
  run,
  onSeeReport,
  onExit,
}: {
  run: RunState;
  onSeeReport: () => void;
  onExit: () => void;
}) {
  const match = useMatchCtx();
  const { accent, sting } = useAudio();
  const { reduced } = useMotionCtx();
  const celebratedRef = useRef(false);

  const selfId = match?.selfId ?? "";
  const peers = match?.peers;
  const finished = match?.phase === "finished";
  const mine = Math.round(netWorth(run));

  const rows = useMemo(() => {
    if (!peers) return [];
    return Object.values(peers)
      .map((p) => (p.playerId === selfId ? { ...p, netWorth: mine, reported: true } : p))
      // A player nobody ever reported for has no result, and no result ranks below
      // every real one — including the ones that finished underwater. Sorting them
      // by their placeholder zero used to place a no-show above people who played
      // the whole match.
      .sort(
        (a, b) =>
          Number(b.reported) - Number(a.reported) ||
          b.netWorth - a.netWorth ||
          (a.playerId < b.playerId ? -1 : 1),
      );
  }, [peers, selfId, mine]);

  const won = rows.length > 0 && rows[0].playerId === selfId;
  const open = rows.filter((p) => p.status === "playing");
  const stillPlaying = open.length;
  /** Nobody the room can see is still playing: what is left is auto-play. Saying
   *  "waiting on the room" for that reads as waiting on people. */
  const ghostsOnly = stillPlaying > 0 && open.every((p) => !p.connected);

  useEffect(() => {
    if (!finished || celebratedRef.current) return;
    celebratedRef.current = true;
    // The existing score's vocabulary, nothing new: the win is a good sting plus the
    // level-up accent, everyone else gets the hit that says "that's the result".
    if (won) {
      sting("good");
      accent("levelup");
    } else {
      accent("hit");
    }
  }, [finished, won, accent, sting]);

  const verdict = deriveVerdict(run);
  const top = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <div className="mx-auto flex min-h-[100svh] w-full max-w-3xl flex-col justify-center px-5 py-14">
      <div className="mb-4 flex items-center justify-end"><SoundCell /></div>

      <motion.header initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <p className="eyebrow text-ink">{finished ? "The room · final" : "The room · still running"}</p>
        <h1 className="display-caps mt-3 text-4xl text-ink sm:text-5xl">
          {finished ? "Final standings" : "Your ledger is closed"}
        </h1>
        <div className="mx-auto mt-5 h-px w-24 bg-ink" />
        {!finished && (
          <p className="voice mt-4 text-sm text-ink/70">
            {stillPlaying > 0
              ? `${stillPlaying} of ${rows.length} still living their lives…`
              : "Closing the books on the room…"}
          </p>
        )}
      </motion.header>

      {/* ── your own closing figure ───────────────────────────────────────── */}
      <section aria-label="Your result" className="paper mt-8 p-4">
        <div className="flex items-baseline justify-between border-b border-hairline pb-2">
          <p className="eyebrow text-secondary">Your ledger</p>
          {/* Years LIVED, not the engine's year index: `advanceYear` rolls the year
              past the end before it stamps "story-complete", so a finished story run
              carries index 22 for a life the player saw 21 years of. The history
              length is the same figure the report prints on the very next screen,
              and it is right for every ending — retire/quit never advance the year. */}
          <p className="num text-[0.62rem] tracking-[0.16em] text-tertiary">
            YEARS {run.history.length} · AGE {run.age}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="figure text-4xl" style={{ color: mine >= 0 ? "var(--color-gain)" : "var(--color-loss)" }}>
            <AnimatedNumber value={mine} format={currency} />
          </p>
          <p className="display-caps text-lg" style={{ color: verdict.hex }}>
            {verdict.title}
          </p>
        </div>
        {run.endReason && (
          <p className="voice mt-1 text-xs text-secondary">{END_LABEL[run.endReason] ?? "Run over"}</p>
        )}
      </section>

      {rows.length === 0 ? (
        <p className="voice mt-8 text-center text-sm text-secondary">
          You&rsquo;ve left the room — your run is still yours.
        </p>
      ) : finished ? (
        <>
          <ol className="mt-8 grid gap-3 sm:grid-cols-3">
            {top.map((p, i) => (
              <Plinth key={p.playerId} peer={p} rank={i + 1} isSelf={p.playerId === selfId} reduced={reduced} />
            ))}
          </ol>
          {rest.length > 0 && (
            <ol className="mt-4">
              {rest.map((p, i) => (
                <ResultRow key={p.playerId} peer={p} rank={i + 4} isSelf={p.playerId === selfId} index={i} reduced={reduced} />
              ))}
            </ol>
          )}
        </>
      ) : (
        <section aria-label="Live standings" className="mt-8">
          <div className="flex items-baseline justify-between border-b border-hairline pb-2">
            <p className="eyebrow text-secondary">The board, live</p>
            <TerminalOp label={ghostsOnly ? "Auto-playing the last lives" : "Waiting on the room"} />
          </div>
          <ol className="mt-1">
            {rows.map((p, i) => (
              <ResultRow key={p.playerId} peer={p} rank={i + 1} isSelf={p.playerId === selfId} index={i} reduced={reduced} />
            ))}
          </ol>
        </section>
      )}

      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <NeonButton
          variant="ghost"
          size="sm"
          onClick={() => {
            match?.leaveMatch();
            onExit();
          }}
        >
          ← Back to title
        </NeonButton>
        <NeonButton variant="primary" size="lg" onClick={onSeeReport}>
          See your life report →
        </NeonButton>
      </div>
    </div>
  );
}

/** One of the top three — the stamped plate, at three sizes of ceremony. */
function Plinth({
  peer,
  rank,
  isSelf,
  reduced,
}: {
  peer: MatchPeer;
  rank: number;
  isSelf: boolean;
  reduced: boolean;
}) {
  // The winner's card is taller. Structural padding, not an animated height.
  const pad = rank === 1 ? "py-6" : rank === 2 ? "py-5" : "py-4";
  return (
    <motion.li
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.3 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={reduced ? { duration: DUR.instant, ease: EASE } : { ...SPRING.reward, delay: stepDelay(rank - 1, STAGGER.loose) }}
      className={`paper flex flex-col items-center px-3 text-center ${pad} ${isSelf ? "bg-ink/10" : ""}`}
    >
      <span
        className="grid h-7 w-7 place-items-center text-[0.78rem] font-bold text-bg"
        style={{ background: MEDALS[rank - 1] }}
      >
        <span className="num">{rank}</span>
      </span>
      <span className="mt-3"><Avatar seed={peer.avatarSeed} username={peer.name} size={rank === 1 ? 44 : 36} /></span>
      <p className={`mt-2 max-w-full truncate font-body text-sm ${isSelf ? "text-ink" : "text-ink-dim"}`}>
        {peer.name}
        {isSelf && <span className="ml-1 eyebrow text-tertiary" style={{ fontSize: "0.5rem" }}>you</span>}
      </p>
      {peer.reported ? (
        <p
          className={`num mt-1 ${rank === 1 ? "text-lg" : "text-base"}`}
          style={{ color: peer.netWorth >= 0 ? "var(--color-gain)" : "var(--color-loss)" }}
        >
          {currency(peer.netWorth)}
        </p>
      ) : (
        <p className={`num mt-1 text-tertiary ${rank === 1 ? "text-lg" : "text-base"}`}>
          No result
        </p>
      )}
      {rank === 1 && peer.reported && (
        <p className="eyebrow mt-1.5 text-secondary" style={{ fontSize: "0.55rem" }}>
          Took the room
        </p>
      )}
      {/* A placing must never silently look earned. This life was played out by the
          room after its player left, so the board says so in words — it still ranks,
          it just doesn't pretend. */}
      {peer.ghost && peer.reported && (
        <p className="eyebrow mt-1.5 text-tertiary" style={{ fontSize: "0.55rem" }}>
          Auto-played
        </p>
      )}
    </motion.li>
  );
}

/** A line on the board — live while the room runs, final once it doesn't. */
function ResultRow({
  peer,
  rank,
  isSelf,
  index,
  reduced,
}: {
  peer: MatchPeer;
  rank: number;
  isSelf: boolean;
  index: number;
  reduced: boolean;
}) {
  const ended = peer.status === "ended";
  const away = !peer.connected && !ended;
  return (
    <motion.li
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.instant, ease: EASE, delay: stepDelay(index, STAGGER.list) }}
      className={`flex items-center gap-3 border-b border-hairline/60 px-2 py-2 last:border-b-0 ${
        isSelf ? "bg-ink/10" : ""
      }`}
    >
      <span className="num w-5 shrink-0 text-right text-sm text-tertiary">{rank}</span>
      <Avatar seed={peer.avatarSeed} username={peer.name} size={28} />
      <span className={`min-w-0 flex-1 truncate font-body text-sm ${isSelf ? "text-ink" : away ? "text-tertiary" : "text-ink-dim"}`}>
        {peer.name}
        {isSelf && <span className="ml-1.5 eyebrow text-tertiary" style={{ fontSize: "0.55rem" }}>you</span>}
      </span>
      <span className="eyebrow shrink-0 text-tertiary" style={{ fontSize: "0.55rem" }}>
        {/* The ghost mark outlives the ending: a life the room finished on its
            player's behalf reads "Auto-played", not just "Retired", so the figure
            beside it is never mistaken for one somebody sat and earned. */}
        {!peer.reported
          // A row this client has never had a word for is not the same as a seat
          // nobody ever played: see `pending` in `hooks/useMatch.tsx`.
          ? (peer.pending ? "Away" : "Never played")
          : peer.ghost
            ? "Auto-played"
            : ended
              ? (END_LABEL[peer.endReason ?? ""] ?? "Done")
              : away
                ? "Away"
                : `Year ${Math.max(1, peer.yearIndex)}`}
      </span>
      {peer.reported ? (
        <span
          className="num w-[6rem] shrink-0 text-right text-sm"
          style={{ color: peer.netWorth >= 0 ? "var(--color-gain)" : "var(--color-loss)" }}
        >
          <AnimatedNumber value={peer.netWorth} format={currency} />
        </span>
      ) : (
        <span className="num w-[6rem] shrink-0 text-right text-sm text-tertiary">
          <span aria-hidden>—</span>
          <span className="sr-only">no result</span>
        </span>
      )}
    </motion.li>
  );
}
