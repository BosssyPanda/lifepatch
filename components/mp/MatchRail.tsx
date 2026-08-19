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
      .map((p) => (p.playerId === selfId ? { ...p, netWorth: Math.round(selfNetWorth) } : p))
      .sort((a, b) => b.netWorth - a.netWorth || (a.playerId < b.playerId ? -1 : 1));
  }, [peers, selfId, selfNetWorth]);

  const selfRank = rows.findIndex((r) => r.playerId === selfId);

  useEffect(() => {
    if (selfRank < 0 || rows.length < 2) return;
    const prev = prevRankRef.current;
    prevRankRef.current = selfRank;
    // A smaller index is a better place. First read is the baseline, never a cue.
    if (prev === null || selfRank >= prev) return;
    const now = Date.now();
    if (now - lastCueRef.current < beat.msPerBar) return;
    lastCueRef.current = now;
    accent("streak");
  }, [selfRank, rows.length, accent, beat]);

  if (!match || rows.length === 0) return null;

  return (
    <section aria-label="Live standings" className="paper w-full p-2.5">
      <div className="flex items-baseline justify-between border-b border-hairline pb-1.5">
        <p className="eyebrow text-secondary" style={{ fontSize: "0.56rem" }}>
          The room
        </p>
        <p className="num text-[0.58rem] tracking-[0.16em] text-tertiary">
          {rows.length} IN THE ROOM
        </p>
      </div>
      <ol className="mt-0.5">
        {rows.map((p, i) => (
          <StandingRow key={p.playerId} peer={p} rank={i + 1} isSelf={p.playerId === selfId} />
        ))}
      </ol>
    </section>
  );
}

function StandingRow({ peer, rank, isSelf }: { peer: MatchPeer; rank: number; isSelf: boolean }) {
  const ended = peer.status === "ended";
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
          {peer.ghost ? "Auto" : "Away"}
        </span>
      )}
      {ended && (
        <span className="eyebrow shrink-0 text-tertiary" style={{ fontSize: "0.5rem" }}>
          Done
        </span>
      )}
      {/* Relative year only — calendar years are an end-of-run reveal (lib/modes.ts). */}
      <span className="num w-7 shrink-0 text-right text-[0.62rem] text-tertiary">
        Y{Math.max(1, peer.yearIndex)}
      </span>
      <span
        className="num w-[5.5rem] shrink-0 text-right text-xs"
        style={{ color: peer.netWorth >= 0 ? "var(--color-gain)" : "var(--color-loss)" }}
      >
        <AnimatedNumber value={peer.netWorth} format={currency} />
      </span>
    </li>
  );
}
