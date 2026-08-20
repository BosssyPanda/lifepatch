"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { playerName } from "@/components/ui/NameField";
import { useAuth } from "@/hooks/useAuth";
import { BACKGROUNDS } from "@/lib/backgrounds";
import { resolveProgressId } from "@/lib/cloud/identity";
import { getProfile } from "@/lib/cloud/profiles";
import { MODES } from "@/lib/modes";
import { fastForward } from "@/lib/mp/autoResolve";
import { loadMatch, saveMatch } from "@/lib/mp/matchStore";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  MP_PROTOCOL,
  parseMessage,
  parsePresence,
  type PresencePayload,
} from "@/lib/mp/protocol";
import { isRoomCode, makeRoomCode, normalizeRoomCode } from "@/lib/mp/roomCodes";
import { createTransport, type MatchTransport } from "@/lib/mp/transport";
import type { MatchConfig, MatchPhase, PeerInfo, PeerStatus, YearSeconds } from "@/lib/mp/types";
import { initRun, netWorth, yearIndex, type RunState } from "@/lib/runEngine";

/**
 * The room, from this device's point of view.
 *
 * There is no server and no game-state authority. Every client simulates its own
 * seeded run locally (`initRun(..., config.seed)`), and this hook carries only the
 * four things a room actually needs to share: the config that made the world, a
 * year clock, lightweight status rows for the standings, and full snapshots so a
 * disconnected player can be ghost-played and later caught up.
 *
 * Three roles, one file:
 *   - EVERY client: presence, inbound validation, its own status/snapshot writes.
 *   - The ACTING host: the clock. It emits `tick` at each year boundary, skips the
 *     wait when every live peer has locked in, ghost-plays absent players forward,
 *     and answers `snapshotRequest`.
 *   - A NON-host: re-anchors its deadline on every tick against its OWN clock (a
 *     remote wall-clock is never trusted) and self-advances after a 3s grace if the
 *     host went quiet — which is what keeps a match alive through a host death.
 *
 * Acting host = `config.hostId` while connected, else the connected player with the
 * smallest id. Everyone computes it from the same presence data, so migration needs
 * no election message.
 *
 * Every method below is referentially stable for the life of the provider (the
 * `useAudio` pattern): timers and effects can depend on them without being torn
 * down every time a peer's net worth moves.
 */

/** A row in the live standings: who they are, where they are, and whether they're here. */
export type MatchPeer = PeerInfo & PeerStatus & { connected: boolean };

export type MatchApi = {
  phase: MatchPhase | null;
  config: MatchConfig | null;
  peers: Record<string, MatchPeer>;
  selfId: string;
  /** Acting host — this is the client that owns the clock right now. */
  isHost: boolean;
  /** Local-clock deadline for the current year, ms epoch. Null outside a running match. */
  deadlineAt: number | null;
  roomYearIndex: number;
  error: string | null;
  /**
   * The run a rejoin recovered, already fast-forwarded to the room's year. Set by
   * `joinRoom` on the `"rejoined"` path; hand it to `run.resume(state, { matchCode })`.
   */
  resumeState: RunState | null;
  createRoom(name: string): Promise<string>;
  joinRoom(code: string, name: string): Promise<"joined" | "rejoined">;
  setYearSeconds(s: YearSeconds): void;
  setBackground(id: string): void;
  startMatch(): void;
  markReady(): void;
  reportAdvance(state: RunState): void;
  reportEnded(state: RunState): void;
  leaveMatch(): void;
};

/** Lobby default; the host can move it to any of `YEAR_SECONDS_OPTIONS`. */
const DEFAULT_YEAR_SECONDS: YearSeconds = 45;
/** How long a client waits past its own deadline before advancing without the host. */
const TICK_GRACE_MS = 3000;
/** How long `joinRoom` waits for a member to publish the room's config. */
const HANDSHAKE_MS = 5000;
/** How long a rejoiner waits for the acting host to answer `snapshotRequest`. */
const SNAPSHOT_WAIT_MS = 4000;
const POLL_MS = 150;

/**
 * The last playable year of the story, as a `yearIndex` (never a calendar year —
 * years are hidden from the player until the report, see lib/modes.ts).
 */
const STORY = MODES.story;
const LAST_YEAR_INDEX = (STORY.endYear ?? STORY.startYear) - STORY.startYear + 1;

/**
 * Player ids ride the wire and are validated against `[A-Za-z0-9._:-]{1,64}` by the
 * protocol. Dev sign-in ids are `dev-<email>`, which contain `@` — unsanitised, a
 * developer's own presence row would be dropped by every peer including itself.
 */
function safePlayerId(raw: string): string {
  const clean = raw.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 64);
  return clean || "device-anon";
}

/** Per-tab suffix for the same-device test room. `sessionStorage` is per tab. */
const TAB_KEY = "lifepatch.mp.tab";

/**
 * Two tabs on one machine share one device id, which makes them ONE player — so
 * the local transport's whole reason to exist (open two tabs, play a match) can
 * never reach the two-player minimum. Under `NEXT_PUBLIC_MP_LOCAL=1` only, each
 * TAB gets its own id. Cloud rooms are untouched: there, one device is one seat.
 */
function tabScopedId(base: string): string {
  if (process.env.NEXT_PUBLIC_MP_LOCAL !== "1") return base;
  try {
    let tab = sessionStorage.getItem(TAB_KEY);
    if (!tab) {
      tab = Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem(TAB_KEY, tab);
    }
    return `${base}:${tab}`;
  } catch {
    return base;
  }
}

/** A stable avatar for players with no profile row (every guest). FNV-1a → 8 hex. */
function seedFromId(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function cleanSeed(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 32) || "0";
}

/** Field by field, never a spread: `PresencePayload` also carries `v`/`status`/`config`,
 *  and none of that belongs in a standings row. */
function blankPeer(info: PeerInfo, connected: boolean): MatchPeer {
  return {
    playerId: info.playerId,
    name: info.name,
    avatarSeed: info.avatarSeed,
    joinedAt: info.joinedAt,
    yearIndex: 0,
    netWorth: 0,
    status: "playing",
    ready: false,
    connected,
  };
}

function statusOf(state: RunState, playerId: string, ghost: boolean): PeerStatus {
  const out: PeerStatus = {
    playerId,
    yearIndex: yearIndex(state),
    netWorth: Math.round(netWorth(state)),
    status: state.status,
    ready: false,
  };
  if (state.endReason) out.endReason = state.endReason;
  if (ghost) out.ghost = true;
  return out;
}

/**
 * Who owns the clock. `config.hostId` while it is connected, else the smallest
 * connected id — deterministic, so every client migrates to the same host without
 * an election. Self counts as connected: we are, after all, here.
 */
function actingHostOf(config: MatchConfig | null, peers: Record<string, MatchPeer>, selfId: string): string {
  const live = Object.values(peers)
    .filter((p) => p.connected)
    .map((p) => p.playerId);
  if (selfId && !live.includes(selfId)) live.push(selfId);
  if (config && live.includes(config.hostId)) return config.hostId;
  return live.sort()[0] ?? selfId;
}

function messageOf(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

const MatchCtx = createContext<MatchApi | null>(null);

/**
 * The match, or null when this device isn't in one.
 *
 * Everything downstream of the entry panel (`YearLoop`, `AdvanceBar`, the rails)
 * asks this: null means "solo", and every solo path renders exactly as it did
 * before multiplayer existed. The entry panel itself needs the API *before* a match
 * exists, so it uses `useMatch()` below.
 */
export function useMatchCtx(): MatchApi | null {
  const ctx = useContext(MatchCtx);
  return ctx && ctx.phase !== null ? ctx : null;
}

/** The live API, in or out of a match. For the create/join panel only. */
export function useMatch(): MatchApi {
  const ctx = useContext(MatchCtx);
  if (!ctx) throw new Error("useMatch must be used inside <MatchProvider>.");
  return ctx;
}

export function MatchProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const [phase, setPhaseState] = useState<MatchPhase | null>(null);
  const [config, setConfigState] = useState<MatchConfig | null>(null);
  const [peers, setPeersState] = useState<Record<string, MatchPeer>>({});
  const [deadlineAt, setDeadlineState] = useState<number | null>(null);
  const [roomYearIndex, setRoomYearState] = useState(0);
  const [error, setErrorState] = useState<string | null>(null);
  const [resumeState, setResumeState] = useState<RunState | null>(null);
  const [selfId, setSelfIdState] = useState("");

  // Mirrors. Timers, transport callbacks and the stable methods all read the ref
  // (they outlive the render that made them); React state exists for the UI.
  const phaseRef = useRef<MatchPhase | null>(null);
  const configRef = useRef<MatchConfig | null>(null);
  const peersRef = useRef<Record<string, MatchPeer>>({});
  const roomYearRef = useRef(0);
  const selfIdRef = useRef("");
  const authIdRef = useRef<string | null>(null);
  const avatarSeedRef = useRef("0");
  const selfInfoRef = useRef<PeerInfo | null>(null);
  const myStatusRef = useRef<PeerStatus | null>(null);
  const myStateRef = useRef<RunState | null>(null);
  const roomRef = useRef<string | null>(null);
  /** How many OTHER players presence last showed, before the eight-seat cap. */
  const othersRef = useRef(0);
  /** Did we see this room start without us? Turns a join timeout into the truth. */
  const startedWithoutMeRef = useRef(false);
  const transportRef = useRef<MatchTransport | null>(null);
  const offRef = useRef<(() => void)[]>([]);
  /** Latest known run per player — the ghost-play cache, kept by every client so a
   *  host migration doesn't lose the absent players' lives. */
  const snapshotsRef = useRef<Map<string, RunState>>(new Map());
  const snapshotWaiterRef = useRef<((s: RunState) => void) | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── mirrored setters ──────────────────────────────────────────────────────
  const setPhase = useCallback((p: MatchPhase | null) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);
  const setConfig = useCallback((c: MatchConfig | null) => {
    configRef.current = c;
    setConfigState(c);
  }, []);
  const setRoomYear = useCallback((y: number) => {
    roomYearRef.current = y;
    setRoomYearState(y);
  }, []);
  const updatePeers = useCallback((fn: (prev: Record<string, MatchPeer>) => Record<string, MatchPeer>) => {
    const next = fn(peersRef.current);
    peersRef.current = next;
    setPeersState(next);
  }, []);

  // ── identity ──────────────────────────────────────────────────────────────
  // Nothing is resolved here on purpose. `resolveProgressId` MINTS a device id in
  // localStorage and the avatar lookup is a network read, and a player who never
  // opens a room should pay for neither — this provider is mounted for everyone.
  // `ensureSelfId` (on first room entry) does the work instead.
  useEffect(() => {
    authIdRef.current = user?.id ?? null;
    // Identity is frozen for the duration of a match: signing in mid-room would
    // change our player id, orphaning the row the rest of the room is watching.
    if (phaseRef.current !== null) return;
    selfIdRef.current = "";
    avatarSeedRef.current = "0";
    setSelfIdState("");
  }, [user]);

  const ensureSelfId = useCallback((): string => {
    if (!selfIdRef.current) {
      const id = safePlayerId(tabScopedId(resolveProgressId(authIdRef.current)));
      selfIdRef.current = id;
      avatarSeedRef.current = seedFromId(id);
      setSelfIdState(id);
    }
    return selfIdRef.current;
  }, []);

  // ── wire helpers ──────────────────────────────────────────────────────────
  const presencePayload = useCallback((): PresencePayload => {
    const info = selfInfoRef.current ?? {
      playerId: ensureSelfId(),
      name: playerName(""),
      avatarSeed: avatarSeedRef.current,
      joinedAt: Date.now(),
    };
    const out: PresencePayload = { v: MP_PROTOCOL, ...info };
    if (myStatusRef.current) out.status = myStatusRef.current;
    // Every member republishes the config, so a rejoiner can read the whole room off
    // ANY member's presence — there is no table to ask.
    if (configRef.current) out.config = configRef.current;
    return out;
  }, [ensureSelfId]);

  const publish = useCallback(() => {
    transportRef.current?.updatePresence(presencePayload());
  }, [presencePayload]);

  const send = useCallback((msg: unknown) => {
    transportRef.current?.send(msg);
  }, []);

  const setError = useCallback((msg: string | null) => setErrorState(msg), []);

  /** Merge one status row into the standings. Never touches `connected` — presence
   *  owns that, and a ghost row is broadcast precisely because its player is gone. */
  const applyPeerStatus = useCallback(
    (st: PeerStatus) => {
      updatePeers((prev) => {
        const base = prev[st.playerId];
        if (base && base.yearIndex > st.yearIndex) return prev; // stale
        // A room seats eight. Nothing that arrives on the wire may seat a ninth.
        if (!base && Object.keys(prev).length >= MAX_PLAYERS) return prev;
        const info: PeerInfo = base ?? {
          playerId: st.playerId,
          name: playerName(""),
          avatarSeed: "0",
          joinedAt: Date.now(),
        };
        const row: MatchPeer = {
          playerId: st.playerId,
          name: info.name,
          avatarSeed: info.avatarSeed,
          joinedAt: info.joinedAt,
          yearIndex: st.yearIndex,
          netWorth: st.netWorth,
          status: st.status,
          // Readiness belongs to ONE year. A "locked in" sent for a year the room
          // has already left must never count again: a lock-in racing the boundary
          // used to survive into the new year and pull the room forward a second
          // time, auto-resolving a year its author never saw.
          ready: st.ready && st.yearIndex >= roomYearRef.current,
          // Written flat, not spread over the old row: a player who comes back and
          // reports for themselves must clear the ghost flag the host left behind.
          endReason: st.endReason,
          ghost: st.ghost,
          connected: base ? base.connected : st.ghost !== true,
        };
        return { ...prev, [st.playerId]: row };
      });
    },
    [updatePeers],
  );

  /** A new year starts with nobody locked in. */
  const clearReady = useCallback(() => {
    if (myStatusRef.current) myStatusRef.current = { ...myStatusRef.current, ready: false };
    updatePeers((prev) => {
      const next: Record<string, MatchPeer> = {};
      for (const [id, p] of Object.entries(prev)) next[id] = p.ready ? { ...p, ready: false } : p;
      return next;
    });
  }, [updatePeers]);

  const isActingHost = useCallback((): boolean => {
    const id = selfIdRef.current;
    return !!id && actingHostOf(configRef.current, peersRef.current, id) === id;
  }, []);

  /**
   * May this id write into the room's game state?
   *
   * Only players the room actually admitted — the frozen roster — and only once
   * the match is running. Before that there is no game state to write, so a lobby
   * carries no statuses and no snapshots at all. Without this gate anyone holding
   * the code could grow the standings and the snapshot cache a message at a time.
   */
  const isRosterMember = useCallback((id: string): boolean => {
    const cfg = configRef.current;
    if (!cfg || cfg.startedAt === 0) return false;
    return cfg.roster.some((r) => r.playerId === id);
  }, []);

  /**
   * Adopt a tick — from the host, or from our own fallback clock. The deadline is
   * always re-anchored on the LOCAL clock: latency is negligible next to a 45s year,
   * and a peer's wall-clock is neither trustworthy nor necessarily correct.
   */
  const applyTick = useCallback(
    (yi: number, yearSeconds: YearSeconds) => {
      if (phaseRef.current !== "running") return;
      // The clock lives inside the world it runs. The wire allows a far larger
      // number than the story has years, and a room whose clock lands outside the
      // story prints years that do not exist and fast-forwards lives past the end.
      const capped = Math.min(yi, LAST_YEAR_INDEX + 1);
      if (capped <= roomYearRef.current) return; // stale or duplicate
      setRoomYear(capped);
      setDeadlineState(Date.now() + yearSeconds * 1000);
      clearReady();
    },
    [clearReady, setRoomYear],
  );

  /**
   * Play every absent player's life forward with auto-decisions, so the standings
   * stay live while they're gone. Deterministic: when they rejoin, their own client
   * runs the identical `fastForward` from the identical snapshot and lands on the
   * identical state.
   */
  const ghostPlay = useCallback(
    (toYearIndex: number) => {
      for (const peer of Object.values(peersRef.current)) {
        if (peer.playerId === selfIdRef.current) continue;
        if (peer.connected || peer.status === "ended") continue;
        const snap = snapshotsRef.current.get(peer.playerId);
        if (!snap) continue; // nothing to play — their row simply stops moving
        const next = fastForward(snap, toYearIndex);
        snapshotsRef.current.set(peer.playerId, next);
        const st = statusOf(next, peer.playerId, true);
        send({ t: "status", v: MP_PROTOCOL, status: st });
        applyPeerStatus(st);
      }
    },
    [applyPeerStatus, send],
  );

  /** The clock, one beat. Acting host only. */
  const emitTick = useCallback(() => {
    const cfg = configRef.current;
    if (!cfg || phaseRef.current !== "running") return;
    const next = roomYearRef.current + 1;
    ghostPlay(next);
    send({ t: "tick", v: MP_PROTOCOL, yearIndex: next, yearSeconds: cfg.yearSeconds });
    // `broadcast.self: false` — the host has to move its own room clock too.
    setRoomYear(next);
    setDeadlineState(Date.now() + cfg.yearSeconds * 1000);
    clearReady();
  }, [clearReady, ghostPlay, send, setRoomYear]);

  /** The match begins: same config, same seed, same clock, everywhere. */
  const beginRunning = useCallback(
    (cfg: MatchConfig, atYearIndex: number) => {
      setConfig(cfg);
      setPhase("running");
      setRoomYear(Math.max(1, atYearIndex));
      setDeadlineState(Date.now() + cfg.yearSeconds * 1000);
      myStatusRef.current = {
        playerId: ensureSelfId(),
        yearIndex: Math.max(1, atYearIndex),
        netWorth: 0,
        status: "playing",
        ready: false,
      };
      // Roster members we haven't seen yet still get a row, so the standings are
      // complete from the first frame.
      updatePeers((prev) => {
        const next = { ...prev };
        for (const r of cfg.roster) if (!next[r.playerId]) next[r.playerId] = blankPeer(r, false);
        return next;
      });
      publish();
    },
    [ensureSelfId, publish, setConfig, setPhase, setRoomYear, updatePeers],
  );

  /** The highest year any peer claims — how a rejoiner learns what year it is. */
  const peerYearIndex = useCallback((): number => {
    let max = 1;
    for (const p of Object.values(peersRef.current)) if (p.yearIndex > max) max = p.yearIndex;
    return max;
  }, []);

  /**
   * Take a config off a member's presence row.
   *
   * Guarded, because presence is peer-written: only the host may define a lobby, and
   * once a match is running only its own roster may republish it. Without that, any
   * member could hand the room a new seed mid-match.
   */
  const adoptConfig = useCallback(
    (cfg: MatchConfig, from: string) => {
      if (cfg.roomCode !== roomRef.current) return;
      const trusted = from === cfg.hostId || (cfg.startedAt > 0 && cfg.roster.some((r) => r.playerId === from));
      if (!trusted) return;
      const cur = configRef.current;
      if (cur && cur.hostId !== cfg.hostId) return;
      if (cfg.startedAt > 0) {
        if (phaseRef.current === "running" || phaseRef.current === "finished") return;
        if (!cfg.roster.some((r) => r.playerId === selfIdRef.current)) {
          // The `start` broadcast is at-most-once, so a guest who was mid-handshake
          // when it went out learns of the start only from a member's presence. Say
          // so: the alternative is a lobby that waits on a host who already left.
          startedWithoutMeRef.current = true;
          if (phaseRef.current === "lobby") setError("The host started the match without you.");
          return;
        }
        beginRunning(cfg, peerYearIndex());
        return;
      }
      if (phaseRef.current !== "lobby") return;
      if (cur && cur.startedAt > 0) return;
      if (cur && cur.yearSeconds === cfg.yearSeconds && cur.backgroundId === cfg.backgroundId && cur.seed === cfg.seed) {
        return;
      }
      setConfig(cfg);
    },
    [beginRunning, peerYearIndex, setConfig, setError],
  );

  // ── inbound ───────────────────────────────────────────────────────────────
  const handleMessage = useCallback(
    (raw: unknown) => {
      const msg = parseMessage(raw);
      if (!msg) return; // malformed, wrong protocol, or a type this build doesn't speak
      switch (msg.t) {
        case "config":
        case "start": {
          const cfg = msg.config;
          if (cfg.roomCode !== roomRef.current) return;
          const cur = configRef.current;
          if (cur && cur.hostId !== cfg.hostId) return;
          if (msg.t === "config") {
            if (phaseRef.current !== "lobby" || cfg.startedAt > 0) return;
            setConfig(cfg);
            publish();
            return;
          }
          if (phaseRef.current === "running" || phaseRef.current === "finished") return;
          if (!cfg.roster.some((r) => r.playerId === selfIdRef.current)) {
            setError("The host started the match without you.");
            return;
          }
          beginRunning(cfg, 1);
          return;
        }
        case "tick": {
          // The one inbound message with no author. `TickMsg` carries no sender id,
          // and a field that claimed one would be forged just as cheaply — so the
          // clock is bounded by what the room can be SHOWN to have reached instead:
          // a tick may pull us to the next year, or catch us up to a year roster
          // members are demonstrably already at, never past it. Peer years arrive
          // only from roster members, so a stranger who was read the room code can
          // no longer end the match with one message. Airtight needs a server
          // authority, which is out of scope by contract.
          const cfg = configRef.current;
          if (!cfg || cfg.startedAt === 0) return; // no running room, no clock
          let seen = roomYearRef.current;
          for (const p of Object.values(peersRef.current)) {
            if (p.playerId !== selfIdRef.current && p.yearIndex > seen) seen = p.yearIndex;
          }
          applyTick(Math.min(msg.yearIndex, seen + 1), msg.yearSeconds);
          return;
        }
        case "status":
          // Only the acting host speaks for someone else (a ghost row), nobody
          // speaks for us, and only a player this room admitted speaks at all.
          if (msg.status.playerId === selfIdRef.current) return;
          if (!isRosterMember(msg.status.playerId)) return;
          applyPeerStatus(msg.status);
          return;
        case "snapshot":
          // Our own entry is written locally by `report`; a peer claiming to hold our
          // life is either confused or hostile, and either way we already have it.
          // Every other entry is a whole RunState held in memory, so the cache is
          // bounded by the roster and holds nothing before the match starts.
          if (msg.playerId === selfIdRef.current) return;
          if (!isRosterMember(msg.playerId)) return;
          snapshotsRef.current.set(msg.playerId, msg.state);
          return;
        case "snapshotRequest": {
          if (!isActingHost()) return;
          const snap = snapshotsRef.current.get(msg.playerId);
          if (snap) send({ t: "snapshotReply", v: MP_PROTOCOL, playerId: msg.playerId, state: snap });
          return;
        }
        case "snapshotReply": {
          if (msg.playerId !== selfIdRef.current) return;
          const waiter = snapshotWaiterRef.current;
          if (!waiter) return;
          snapshotWaiterRef.current = null;
          waiter(msg.state);
          return;
        }
      }
    },
    [applyPeerStatus, applyTick, beginRunning, isActingHost, isRosterMember, publish, send, setConfig, setError],
  );

  const handlePresence = useCallback(
    (members: unknown[]) => {
      const rows = new Map<string, PresencePayload>();
      for (const raw of members) {
        const p = parsePresence(raw);
        if (!p) continue;
        // Two tabs, one player: keep whichever row is actually carrying game state.
        const prev = rows.get(p.playerId);
        if (!prev || (!prev.status && p.status) || (!!prev.status === !!p.status && p.joinedAt <= prev.joinedAt)) {
          rows.set(p.playerId, p);
        }
      }

      const me = selfIdRef.current;
      const cfg = configRef.current;
      // Once the match is running the roster IS the room. Before that, seats go to
      // the first arrivals — a ninth player is never seated, here or in the counter.
      const roster = cfg && cfg.startedAt > 0 ? cfg.roster : null;
      const visible = [...rows.values()]
        // Our own row is the one thing this device knows for certain. A presence
        // payload claiming our playerId would otherwise rewrite our name, our
        // standing, even our "ended" status — and an "ended" self row ends the run.
        .filter((p) => p.playerId !== me)
        .filter((p) => !roster || roster.some((r) => r.playerId === p.playerId))
        .sort((a, b) => a.joinedAt - b.joinedAt || (a.playerId < b.playerId ? -1 : 1));
      // The true head count, before the cap below — `joinRoom` needs it to turn a
      // ninth player away at the door instead of at the start button.
      othersRef.current = visible.length;
      const others = visible.slice(0, MAX_PLAYERS - 1);

      updatePeers((prev) => {
        const next: Record<string, MatchPeer> = {};
        for (const [id, p] of Object.entries(prev)) next[id] = p.connected ? { ...p, connected: false } : p;
        for (const p of others) {
          const base = next[p.playerId] ?? blankPeer(p, true);
          const row: MatchPeer = {
            ...base,
            playerId: p.playerId,
            name: p.name,
            avatarSeed: p.avatarSeed,
            joinedAt: p.joinedAt,
            connected: true,
          };
          // A presence row is its author's latest word about itself; only take it
          // when it isn't behind what we already have.
          if (p.status && p.status.yearIndex >= base.yearIndex) {
            row.yearIndex = p.status.yearIndex;
            row.netWorth = p.status.netWorth;
            row.status = p.status.status;
            // Presence republishes the sender's last status until they advance, so
            // a lock-in from the year the room has left rides along in it. Same rule
            // as `applyPeerStatus`: readiness belongs to one year only.
            row.ready = p.status.ready && p.status.yearIndex >= roomYearRef.current;
            row.endReason = p.status.endReason;
            row.ghost = p.status.ghost;
          }
          next[p.playerId] = row;
        }
        // Some transports report presence before echoing our own row back; the lobby
        // must never render without the player who is looking at it. Rebuilt from
        // local truth rather than merged, for the reason above.
        const info = selfInfoRef.current;
        if (me && info) {
          const mine = myStatusRef.current;
          const was = next[me];
          next[me] = {
            playerId: me,
            name: info.name,
            avatarSeed: info.avatarSeed,
            joinedAt: info.joinedAt,
            yearIndex: mine?.yearIndex ?? was?.yearIndex ?? 0,
            netWorth: mine?.netWorth ?? was?.netWorth ?? 0,
            status: mine?.status ?? was?.status ?? "playing",
            ready: mine?.ready ?? was?.ready ?? false,
            endReason: mine?.endReason ?? was?.endReason,
            connected: true,
          };
        }
        for (const r of configRef.current?.roster ?? []) if (!next[r.playerId]) next[r.playerId] = blankPeer(r, false);
        return next;
      });

      for (const p of rows.values()) if (p.config) adoptConfig(p.config, p.playerId);
    },
    [adoptConfig, updatePeers],
  );

  // ── connection lifecycle ──────────────────────────────────────────────────
  const stopTimers = useCallback(() => {
    if (tickTimerRef.current !== null) clearTimeout(tickTimerRef.current);
    if (fallbackTimerRef.current !== null) clearTimeout(fallbackTimerRef.current);
    tickTimerRef.current = null;
    fallbackTimerRef.current = null;
  }, []);

  const teardown = useCallback(async () => {
    stopTimers();
    for (const off of offRef.current) off();
    offRef.current = [];
    const t = transportRef.current;
    transportRef.current = null;
    roomRef.current = null;
    snapshotsRef.current.clear();
    snapshotWaiterRef.current = null;
    await t?.leave();
  }, [stopTimers]);

  const connect = useCallback(
    async (room: string, name: string) => {
      await teardown();
      const t = createTransport();
      if (!t) throw new Error("Online play needs the cloud connection — this build doesn't have one configured.");
      const info: PeerInfo = {
        playerId: ensureSelfId(),
        name: playerName(name),
        avatarSeed: avatarSeedRef.current,
        joinedAt: Date.now(),
      };
      selfInfoRef.current = info;
      // Best effort and off the critical path: a signed-in player wears the avatar
      // the rest of the social layer already knows them by. A guest has no row (and
      // must not create one), and `seedFromId` is a perfectly good stable fallback.
      // It runs on room entry rather than at mount so a solo player never queries
      // `profiles` at all.
      void getProfile(info.playerId)
        .then((p) => {
          if (!p?.avatarSeed || selfInfoRef.current !== info) return;
          const seed = cleanSeed(p.avatarSeed);
          avatarSeedRef.current = seed;
          selfInfoRef.current = { ...info, avatarSeed: seed };
          updatePeers((prev) => {
            const row = prev[info.playerId];
            return row ? { ...prev, [info.playerId]: { ...row, avatarSeed: seed } } : prev;
          });
          publish();
        })
        .catch(() => {});
      myStatusRef.current = null;
      myStateRef.current = null;
      transportRef.current = t;
      roomRef.current = room;
      othersRef.current = 0;
      startedWithoutMeRef.current = false;
      offRef.current = [t.onMessage(handleMessage), t.onPresence(handlePresence)];
      updatePeers(() => ({ [info.playerId]: blankPeer(info, true) }));
      await t.join(room, presencePayload());
    },
    [ensureSelfId, handleMessage, handlePresence, presencePayload, publish, teardown, updatePeers],
  );

  const resetState = useCallback(() => {
    setPhase(null);
    setConfig(null);
    setRoomYear(0);
    setDeadlineState(null);
    setResumeState(null);
    updatePeers(() => ({}));
    myStatusRef.current = null;
    myStateRef.current = null;
    selfInfoRef.current = null;
  }, [setConfig, setPhase, setRoomYear, updatePeers]);

  const leaveMatch = useCallback(() => {
    void teardown();
    resetState();
    setError(null);
  }, [resetState, setError, teardown]);

  useEffect(() => {
    return () => {
      void teardown();
    };
  }, [teardown]);

  // ── entry points ──────────────────────────────────────────────────────────
  const createRoom = useCallback(
    async (name: string): Promise<string> => {
      setError(null);
      const code = makeRoomCode();
      const cfg: MatchConfig = {
        v: MP_PROTOCOL,
        roomCode: code,
        seed: Math.floor(Math.random() * 1e9),
        yearSeconds: DEFAULT_YEAR_SECONDS,
        backgroundId: BACKGROUNDS[0].id,
        hostId: ensureSelfId(),
        startedAt: 0,
        roster: [],
      };
      try {
        setConfig(cfg);
        setPhase("lobby");
        await connect(code, name);
        publish();
        return code;
      } catch (e) {
        await teardown();
        resetState();
        const msg = messageOf(e, "Couldn't open a room.");
        setError(msg);
        throw new Error(msg);
      }
    },
    [connect, ensureSelfId, publish, resetState, setConfig, setError, setPhase, teardown],
  );

  /** Poll a ref rather than race a callback: presence and broadcast both feed it. */
  const waitFor = useCallback(async <T,>(read: () => T | null, ms: number): Promise<T | null> => {
    const until = Date.now() + ms;
    for (;;) {
      const v = read();
      if (v !== null) return v;
      if (Date.now() >= until) return null;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }, []);

  /** Ask the acting host for our own last snapshot. Rejoin's second-best source. */
  const requestSnapshot = useCallback(async (): Promise<RunState | null> => {
    let got: RunState | null = null;
    snapshotWaiterRef.current = (s) => {
      got = s;
    };
    send({ t: "snapshotRequest", v: MP_PROTOCOL, playerId: selfIdRef.current });
    const out = await waitFor(() => got, SNAPSHOT_WAIT_MS);
    snapshotWaiterRef.current = null;
    return out;
  }, [send, waitFor]);

  const joinRoom = useCallback(
    async (rawCode: string, name: string): Promise<"joined" | "rejoined"> => {
      setError(null);
      const code = normalizeRoomCode(rawCode);
      if (!isRoomCode(code)) {
        const msg = "That room code doesn't look right.";
        setError(msg);
        throw new Error(msg);
      }
      try {
        setPhase("lobby");
        await connect(code, name);
        publish();
        const cfg = await waitFor(() => configRef.current, HANDSHAKE_MS);
        if (!cfg) {
          // A running room whose roster excludes us never hands us a config at all,
          // so the timeout has two meanings. Tell them apart.
          throw new Error(
            startedWithoutMeRef.current
              ? "That match has already started."
              : "No room with that code — check the letters and try again.",
          );
        }
        if (cfg.startedAt === 0) {
          // Eight seats, checked at the door. Slicing the surplus off at start time
          // instead means a player sits in a lobby they were never really in.
          if (othersRef.current >= MAX_PLAYERS) {
            throw new Error(`That room is full (${MAX_PLAYERS} players).`);
          }
          return "joined";
        }

        // Running match: the roster is the gate. A stranger can't walk in mid-run,
        // but the player who dropped out of it can.
        if (!cfg.roster.some((r) => r.playerId === selfIdRef.current)) {
          throw new Error("That match has already started.");
        }
        // `peerYearIndex` is peer-written and the wire allows far more years than
        // the story has. Never auto-play a returning player past the end of it.
        const target = Math.min(Math.max(roomYearRef.current, peerYearIndex(), 1), LAST_YEAR_INDEX + 1);
        // Best source first: this device's own copy of OUR life — a record another
        // player on this device wrote is refused, not resumed. Then the host's cache.
        // Failing both, rebuild from the shared seed — auto-play from year one is
        // exactly what the room has been watching anyway.
        const local = loadMatch(cfg.roomCode, selfIdRef.current)?.state ?? null;
        const remote = local ? null : await requestSnapshot();
        const base = local ?? remote ?? initRun("story", cfg.backgroundId, playerName(name), cfg.seed);
        const caught = fastForward(base, target);
        myStateRef.current = caught;
        myStatusRef.current = statusOf(caught, selfIdRef.current, false);
        setResumeState(caught);
        saveMatch(cfg.roomCode, selfIdRef.current, cfg, caught);
        applyPeerStatus(myStatusRef.current);
        send({ t: "status", v: MP_PROTOCOL, status: myStatusRef.current });
        send({ t: "snapshot", v: MP_PROTOCOL, playerId: selfIdRef.current, state: caught });
        publish();
        return "rejoined";
      } catch (e) {
        await teardown();
        resetState();
        const msg = messageOf(e, "Couldn't join that room.");
        setError(msg);
        throw new Error(msg);
      }
    },
    [applyPeerStatus, connect, peerYearIndex, publish, requestSnapshot, resetState, send, setError, setPhase, teardown, waitFor],
  );

  // ── host lobby controls ───────────────────────────────────────────────────
  const patchConfig = useCallback(
    (patch: Partial<MatchConfig>) => {
      const cur = configRef.current;
      if (!cur || phaseRef.current !== "lobby") return;
      if (cur.hostId !== selfIdRef.current) return;
      const next: MatchConfig = { ...cur, ...patch };
      setConfig(next);
      send({ t: "config", v: MP_PROTOCOL, config: next });
      publish();
    },
    [publish, send, setConfig],
  );

  const setYearSeconds = useCallback((s: YearSeconds) => patchConfig({ yearSeconds: s }), [patchConfig]);
  const setBackground = useCallback((id: string) => patchConfig({ backgroundId: id }), [patchConfig]);

  const startMatch = useCallback(() => {
    const cur = configRef.current;
    if (!cur || phaseRef.current !== "lobby") return;
    if (cur.hostId !== selfIdRef.current) return;
    const roster: PeerInfo[] = Object.values(peersRef.current)
      .filter((p) => p.connected)
      .sort((a, b) => a.joinedAt - b.joinedAt || (a.playerId < b.playerId ? -1 : 1))
      .slice(0, MAX_PLAYERS)
      .map((p) => ({ playerId: p.playerId, name: p.name, avatarSeed: p.avatarSeed, joinedAt: p.joinedAt }));
    if (!roster.some((r) => r.playerId === cur.hostId) && selfInfoRef.current) {
      roster.unshift(selfInfoRef.current);
    }
    if (roster.length < MIN_PLAYERS) {
      setError(`A match needs at least ${MIN_PLAYERS} players.`);
      return;
    }
    const final: MatchConfig = { ...cur, startedAt: Date.now(), roster };
    send({ t: "start", v: MP_PROTOCOL, config: final });
    beginRunning(final, 1);
  }, [beginRunning, send, setError]);

  // ── in-run reporting ──────────────────────────────────────────────────────
  const markReady = useCallback(() => {
    if (phaseRef.current !== "running") return;
    const base = myStatusRef.current ?? {
      playerId: selfIdRef.current,
      yearIndex: roomYearRef.current,
      netWorth: 0,
      status: "playing" as const,
      ready: false,
    };
    if (base.status === "ended" || base.ready) return;
    const st: PeerStatus = { ...base, ready: true };
    myStatusRef.current = st;
    applyPeerStatus(st);
    send({ t: "status", v: MP_PROTOCOL, status: st });
    publish();
  }, [applyPeerStatus, publish, send]);

  /** One local advance: the standings row, the ghost-play snapshot, and the save. */
  const report = useCallback(
    (state: RunState) => {
      if (phaseRef.current === null) return;
      const id = selfIdRef.current;
      myStateRef.current = state;
      const st = statusOf(state, id, false);
      myStatusRef.current = st;
      applyPeerStatus(st);
      snapshotsRef.current.set(id, state);
      const cfg = configRef.current;
      if (cfg) saveMatch(cfg.roomCode, id, cfg, state);
      send({ t: "status", v: MP_PROTOCOL, status: st });
      send({ t: "snapshot", v: MP_PROTOCOL, playerId: id, state });
      publish();
    },
    [applyPeerStatus, publish, send],
  );

  const reportAdvance = useCallback((state: RunState) => report(state), [report]);
  const reportEnded = useCallback((state: RunState) => report(state), [report]);

  // ── clocks ────────────────────────────────────────────────────────────────
  const actingHostId = useMemo(() => actingHostOf(config, peers, selfId), [config, peers, selfId]);
  const isHost = phase !== null && !!selfId && actingHostId === selfId;

  // Host: the year boundary. One timer, re-armed on every year and every migration.
  useEffect(() => {
    if (tickTimerRef.current !== null) clearTimeout(tickTimerRef.current);
    tickTimerRef.current = null;
    if (phase !== "running" || !isHost || deadlineAt === null) return;
    const t = setTimeout(emitTick, Math.max(0, deadlineAt - Date.now()));
    tickTimerRef.current = t;
    return () => clearTimeout(t);
  }, [phase, isHost, deadlineAt, roomYearIndex, emitTick]);

  // Everyone else: the same boundary plus a grace period. If the host died mid-year
  // the room keeps moving anyway — the world is deterministic, so a client that
  // advances alone is still playing the same match.
  useEffect(() => {
    if (fallbackTimerRef.current !== null) clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = null;
    if (phase !== "running" || isHost || deadlineAt === null || !config) return;
    const t = setTimeout(
      () => applyTick(roomYearRef.current + 1, config.yearSeconds),
      Math.max(0, deadlineAt - Date.now()) + TICK_GRACE_MS,
    );
    fallbackTimerRef.current = t;
    return () => clearTimeout(t);
  }, [phase, isHost, deadlineAt, roomYearIndex, config, applyTick]);

  // Host resync. A hidden tab keeps its socket but loses its timers — Chrome defers
  // them to about once a minute — so an acting host can stop ticking while staying
  // connected, which means it is never migrated away from either. Its own clock
  // then falls behind the room forever: every tick it emits is stale, so the
  // all-ready skip stops working for everyone. The room's own year is the fix: if
  // the players it can see have moved past it, it moves too, then re-arms.
  useEffect(() => {
    if (phase !== "running" || !isHost || !config) return;
    let ahead = roomYearIndex;
    for (const p of Object.values(peers)) {
      // Ghost rows are this client's own fast-forwards — following them would be
      // the host chasing its own tail.
      if (p.playerId === selfId || !p.connected || p.ghost) continue;
      if (p.yearIndex > ahead) ahead = p.yearIndex;
    }
    // One step per commit. A host that legitimately fell N years behind a frozen
    // tab walks forward a year at a time (this effect re-runs on `roomYearIndex`),
    // while a single bogus row can no longer teleport the room to the story's end.
    if (ahead > roomYearIndex) applyTick(Math.min(ahead, roomYearIndex + 1), config.yearSeconds);
  }, [phase, isHost, peers, config, roomYearIndex, selfId, applyTick]);

  // All-ready skip: the clock waits for no one, but it doesn't make everyone wait
  // either. Only the acting host may pull the year forward.
  useEffect(() => {
    if (phase !== "running" || !isHost) return;
    // The resync effect above runs in the SAME flush and moves the clock through a
    // ref, so this closure's `peers`/`roomYearIndex` can already be a year stale.
    // `emitTick` reads the ref and increments blindly, so acting on a stale decision
    // would push the room N -> N+2 and auto-resolve a year nobody played. Bail and
    // re-decide on the render the resync schedules, where readiness is cleared too.
    if (roomYearRef.current !== roomYearIndex) return;
    const live = Object.values(peers).filter((p) => p.connected && p.status === "playing");
    // Readiness is bound to the year it was sent for: a lock-in from the year the
    // room has already left is not consent to skip the year that replaced it.
    if (live.length === 0 || !live.every((p) => p.ready && p.yearIndex >= roomYearIndex)) return;
    emitTick();
  }, [phase, isHost, peers, roomYearIndex, emitTick]);

  // The room is over when every life in it is over — or when the story runs out.
  useEffect(() => {
    if (phase !== "running") return;
    const rows = Object.values(peers);
    const allEnded = rows.length > 0 && rows.every((p) => p.status === "ended");
    if (!allEnded && roomYearIndex <= LAST_YEAR_INDEX) return;
    stopTimers();
    setDeadlineState(null);
    setPhase("finished");
  }, [phase, peers, roomYearIndex, setPhase, stopTimers]);

  const api = useMemo<MatchApi>(
    () => ({
      phase,
      config,
      peers,
      selfId,
      isHost,
      deadlineAt,
      roomYearIndex,
      error,
      resumeState,
      createRoom,
      joinRoom,
      setYearSeconds,
      setBackground,
      startMatch,
      markReady,
      reportAdvance,
      reportEnded,
      leaveMatch,
    }),
    [
      phase, config, peers, selfId, isHost, deadlineAt, roomYearIndex, error, resumeState,
      createRoom, joinRoom, setYearSeconds, setBackground, startMatch, markReady,
      reportAdvance, reportEnded, leaveMatch,
    ],
  );

  return <MatchCtx.Provider value={api}>{children}</MatchCtx.Provider>;
}
