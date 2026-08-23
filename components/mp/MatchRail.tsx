"use client";

import { useEffect, useMemo, useRef } from "react";
import { CheckIcon } from "@/components/icons";
import { Avatar } from "@/components/social/Avatar";
import { AnimatedNumber } from "@/components/story/AnimatedNumber";
import { useAudio } from "@/hooks/useAudio";
import { useBeatClock } from "@/hooks/useBeatClock";
import { useMatchCtx, type MatchPeer } from "@/hooks/useMatch";
import { currency } from "@/lib/format";

/**
 * The live standings, at run scale.
 *
 * Every row but yours comes off the wire (`match.peers`); yours comes from the run
 * you are actually playing, because the local figure is always fresher than the
 * status row you last broadcast.
 *
 * Passing someone is the one thing in here that makes a sound — `accent("streak")`,
 * throttled to one bar of the score so a volatile market can't turn the rail into a
 * drum machine.
 */
export function MatchRail({ selfNetWorth }: { selfNetWorth: number }) {
  const match = useMatchCtx();
  const { accent } = useAudio();
  const beat = useBeatClock();
  const prevRankRef = useRef<number | null>(null);
  const lastCueRef = useRef(0);

  const selfId = match?.selfId ?? "";
  const peers = match?.peers;

  const rows = useMemo(() => {
    if (!peers) return [];
    return Object.values(peers)
      .map((p) => (p.playerId === selfId ? { ...p, netWorth: Math.round(selfNetWorth), reported: true } : p))
      // No result ranks below every real one — see MatchPodium for why a
      // placeholder zero must not out-place a player who is genuinely underwater.
      .sort(
        (a, b) =>
          Number(b.reported) - Number(a.reported) ||
          b.netWorth - a.netWorth ||
          (a.playerId < b.playerId ? -1 : 1),
      );
  }, [peers, selfId, selfNetWorth]);

  const selfRank = rows.findIndex((r) => r.playerId === selfId);
  const roomYear = match?.roomYearIndex ?? 0;

  useEffect(() => {
    if (selfRank < 0 || rows.length < 2) return;
    const prev = prevRankRef.current;
    prevRankRef.current = selfRank;
    // Year one is the roster settling in, not a race. Every peer row starts as a $0
    // placeholder while this life is already at its background's real net worth —
    // for the room's default that is negative, which seeds us BELOW every row that
    // hasn't reported yet, and the first statuses of the match then slide us upward
    // on nothing but the id tiebreak. Nobody's standing can genuinely move before
    // the first tick, so there is no real overtake to miss here.
    if (roomYear < 2) return;
    // A smaller index is a better place. First read is the baseline, never a cue.
    if (prev === null || selfRank >= prev) return;
    const now = Date.now();
    if (now - lastCueRef.current < beat.msPerBar) return;
    lastCueRef.current = now;
    accent("streak");
  }, [selfRank, rows.length, roomYear, accent, beat]);

  if (!match || rows.length === 0) return null;

  return (
    <section aria-label="Live standings" className="paper w-full p-2.5">
      <div className="flex items-baseline justify-between gap-2 border-b border-hairline pb-1.5">
        {/* The code stays on screen for the whole match, not just the lobby. It is
            the only way back in after a tab closes by accident, and it is how you
            read the room out to someone who wants to watch. Hiding it once the
            match starts meant the door locked behind everybody. */}
        <p className="eyebrow shrink-0 text-secondary" style={{ fontSize: "0.56rem" }}>
          Room{" "}
          <span className="num tracking-[0.18em] text-ink" style={{ fontSize: "0.62rem" }}>
            {match?.config?.roomCode ?? ""}
          </span>
        </p>
        <p className="num shrink-0 text-[0.58rem] tracking-[0.16em] text-tertiary">
          {rows.length} IN THE ROOM
        </p>
      </div>
      {/* Not an alert and not loss-red: nothing is wrong and nothing is refused —
          this tab is simply not the one the room is listening to, so the figures
          it is about to broadcast will not reach the seat. */}
      {match.openElsewhere && (
        <p className="voice mt-1 text-[0.72rem] leading-snug text-ink-dim">
          This room is also open in another tab on this device. That tab holds the seat.
        </p>
      )}
      <ol className="mt-0.5">
        {rows.map((p, i) => (
          <StandingRow key={p.playerId} peer={p} rank={i + 1} isSelf={p.playerId === selfId} roomYear={roomYear} />
        ))}
      </ol>
    </section>
  );
}

function StandingRow({
  peer,
  rank,
  isSelf,
  roomYear,
}: {
  peer: MatchPeer;
  rank: number;
  isSelf: boolean;
  roomYear: number;
}) {
  const ended = peer.status === "ended";
  /**
   * Is somebody still playing this life for them, right now?
   *
   * The ghost mark says a figure came from auto-play; it does not say auto-play is
   * still happening. Whoever holds the clock can only fast-forward a life it holds
   * a snapshot of, and a client that inherited the clock after its player left
   * starts with an empty cache — so the row stops moving while the last mark left
   * on it still reads "Auto". A ghost row that has fallen behind the room's year is
   * nobody's business any more, and "Away" is what that is. It comes back on its
   * own when the snapshot lands and the row starts moving again.
   */
  const auto = peer.ghost === true && peer.yearIndex >= roomYear;
  // "Away" and "auto" are stated in words, not by fading the row: a dimmed name at
  // this size drops straight through the contrast floor (DESIGN.md § Palette).
  const away = !peer.connected && !ended;
  const nameTone = isSelf ? "text-ink" : away ? "text-tertiary" : "text-ink-dim";

  return (
    <li
      className={`flex items-center gap-2 border-b border-hairline/50 px-1 py-1.5 last:border-b-0 ${
        isSelf ? "bg-ink/10" : ""
      }`}
    >
      <span className="num w-4 shrink-0 text-right text-[0.68rem] text-tertiary">{rank}</span>
      <Avatar seed={peer.avatarSeed} username={peer.name} size={20} />
      <span className={`min-w-0 flex-1 truncate font-body text-xs ${nameTone}`}>
        {peer.name}
        {isSelf && (
          <span className="ml-1 eyebrow text-tertiary" style={{ fontSize: "0.5rem" }}>
            you
          </span>
        )}
      </span>
      {peer.ready && !ended && (
        <span className="shrink-0 text-ink">
          <span aria-hidden><CheckIcon size={12} /></span>
          <span className="sr-only">locked in</span>
        </span>
      )}
      {away && (
        <span className="eyebrow shrink-0 text-tertiary" style={{ fontSize: "0.5rem" }}>
          {/* "Away" means someone who was here and left — including a seat this
              client has simply never heard about, which is every absent player on
              a rail that has just rejoined (`pending`). "Absent" is the stronger
              claim, and it is only true of a seat the room itself has never had a
              word for: empty the whole match. */}
          {auto ? "Auto" : peer.reported || peer.pending ? "Away" : "Absent"}
        </span>
      )}
      {ended && (
        <span className="eyebrow shrink-0 text-tertiary" style={{ fontSize: "0.5rem" }}>
          Done
        </span>
      )}
      {/* Relative year only — calendar years are an end-of-run reveal (lib/modes.ts). */}
      <span className="num w-7 shrink-0 text-right text-[0.62rem] text-tertiary">
        {peer.reported ? `Y${Math.max(1, peer.yearIndex)}` : "—"}
      </span>
      {/* Nobody has reported for this seat, so there is no figure to print. A dash
          says that; a $0 would be a claim, and a false one — it sits above every
          player who is genuinely underwater. */}
      {peer.reported ? (
        <span
          className="num w-[5.5rem] shrink-0 text-right text-xs"
          style={{ color: peer.netWorth >= 0 ? "var(--color-gain)" : "var(--color-loss)" }}
        >
          <AnimatedNumber value={peer.netWorth} format={currency} />
        </span>
      ) : (
        <span className="num w-[5.5rem] shrink-0 text-right text-xs text-tertiary">
          <span aria-hidden>—</span>
          <span className="sr-only">no result yet</span>
        </span>
      )}
    </li>
  );
}
