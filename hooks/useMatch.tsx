"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { playerName } from "@/components/ui/NameField";
import { useAuth } from "@/hooks/useAuth";
import { BACKGROUNDS } from "@/lib/backgrounds";
import { resolveProgressId } from "@/lib/cloud/identity";
import { getProfile } from "@/lib/cloud/profiles";
import { MODES } from "@/lib/modes";
import { fastForward } from "@/lib/mp/autoResolve";
import { forgetRoom, loadMatch, rememberPlayerName, rememberRoom, saveMatch } from "@/lib/mp/matchStore";
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
/**
 * `reported` is the difference between "$0" and "no result".
 *
 * A rostered player who never sends a status — closed the tab in the gap between
 * start and their first year, never loaded the run — used to sit at a placeholder
 * netWorth of 0. Zero is not neutral in this game: a Broke Grad opens at −$22,500,
 * and a real player can finish six figures underwater. So the placeholder quietly
 * out-placed people who played the whole match. A row nobody has ever reported for
 * is ranked last and says so, instead of pretending to a figure.
 */
export type MatchPeer = PeerInfo & PeerStatus & {
  connected: boolean;
  reported: boolean;
  /**
   * "Nobody has spoken for this seat" and "nobody has spoken for it TO ME" are not
   * the same sentence, and only this client can tell them apart.
   *
   * A client that joins a match already in progress builds a row for every absent
   * roster member out of thin air (`blankPeer`), because presence only carries the
   * players who are here. Printed as `reported: false` those rows claimed the seat
   * had been empty all match — so a rejoining player's rail called somebody who was
   * LEADING "Absent", with a dash where their figure should be, ranked last. Marked
   * pending instead, the row says "Away" and admits it has no figure yet; the
   * `snapshotRequest` the next year boundary sends is what fills it in.
   *
   * Only ever true while `reported` is false: once anyone speaks for the seat there
   * is nothing left to be pending about.
   */
  pending?: boolean;
};

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
  /**
   * What the room played on this player's behalf while they were gone, set by the
   * same rejoin: they left at `from` and the room had reached `to` (both
   * `yearIndex`). Null when nothing was auto-played. The run screen says so —
   * coming back to a net worth you never chose, with no word about it, reads as
   * the game having lost your decisions.
   */
  resumeCatchup: { from: number; to: number } | null;
  /**
   * Another tab on this device has this room open and presence seated it after
   * us, so the room is listening to that one.
   *
   * A NOTICE, never a gate. A tab that closed hard leaves its presence row behind
   * for seconds, and refusing to join, start or report on the strength of one
   * would break exactly the rejoin this whole path exists for.
   */
  openElsewhere: boolean;
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

/**
 * A join that failed because the room ANSWERED and turned this device away.
 *
 * Everything else `joinRoom` throws is a silence: the handshake ran out without a
 * config, which is what a room full of backgrounded tabs looks like as much as a
 * room that has emptied. The difference matters exactly once, and expensively —
 * `components/mp/WithFriendsPanel.tsx` withdraws the one-tap way back into a live
 * match on it, so it may only act on proof, never on a timeout.
 */
export class RoomRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoomRefusedError";
  }
}

/** Lobby default; the host can move it to any of `YEAR_SECONDS_OPTIONS`. */
const DEFAULT_YEAR_SECONDS: YearSeconds = 45;
/** How long a client waits past its own deadline before advancing without the host. */
const TICK_GRACE_MS = 3000;
/** How long `joinRoom` waits for a member to publish the room's config. */
const HANDSHAKE_MS = 5000;
/** How long a rejoiner waits for the acting host to answer `snapshotRequest`. */
const SNAPSHOT_WAIT_MS = 4000;
/**
 * The year length EVERY client falls back to once nobody still in the room is
 * playing — only absent, ghost-played rows are left. At a real year length the
 * players who finished would watch a life nobody is living take up to twenty
 * minutes to run out. Short, but not instant: a player on their way back can still
 * land in the room before it closes.
 */
const GHOST_CATCHUP_MS = 1500;
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

/**
 * One tab's turn at a seat.
 *
 * `tabScopedId` above only splits tabs under `NEXT_PUBLIC_MP_LOCAL=1`. In
 * PRODUCTION the player id comes from localStorage and is the DEVICE, so two tabs
 * are one player id and both believe they own the seat: each filters out presence
 * rows carrying its own id and never sees the other, while the rest of the room
 * watches one row flip between two different lives — and the first tab to finish
 * closes the seat, ending the match for everybody while the other is still
 * playing. A session token, minted per mounted provider and carried on presence
 * and `status`, is what tells the two of them apart.
 */
function newSessionId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Of two presence rows for ONE player id, is `p` the later session?
 *
 * Newest `joinedAt` wins, and the session token breaks an exact tie so that every
 * client in the room reaches the same answer regardless of the order its transport
 * hands presence rows over. A row with no token sorts below one that has it: an
 * older build cannot take the seat from a client that can actually be told apart.
 */
function newerSession(p: PresencePayload, prev: PresencePayload): boolean {
  if (p.joinedAt !== prev.joinedAt) return p.joinedAt > prev.joinedAt;
  return (p.sessionId ?? "") > (prev.sessionId ?? "");
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
 *  and none of that belongs in a standings row.
 *
 *  `pending` is for the rows this client is inventing rather than hearing: a seat
 *  on a running match's frozen roster whose player is not here. See `MatchPeer`. */
function blankPeer(info: PeerInfo, connected: boolean, pending = false): MatchPeer {
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
    reported: false,
    pending,
  };
}

/**
 * A status row: our own, or a ghost row the acting host writes for an absent
 * player. `sessionId` is ours to stamp and only ours — a ghost row speaks FOR
 * somebody else, so it carries none and every peer takes it exactly as it always
 * did.
 */
function statusOf(state: RunState, playerId: string, ghost: boolean, sessionId?: string): PeerStatus {
  const out: PeerStatus = {
    playerId,
    yearIndex: yearIndex(state),
    netWorth: Math.round(netWorth(state)),
    status: state.status,
    ready: false,
  };
  if (sessionId) out.sessionId = sessionId;
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
  const [resumeCatchup, setResumeCatchup] = useState<{ from: number; to: number } | null>(null);
  const [selfId, setSelfIdState] = useState("");
  const [openElsewhere, setOpenElsewhere] = useState(false);

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
  /** Absent players we've already asked the room for, so the ask is once per gap. */
  const snapshotAskedRef = useRef<Set<string>>(new Set());
  const tickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** This tab's session (see `newSessionId`). A ref is the whole implementation:
   *  per tab and per mount is exactly what "session" means here. Minted lazily so
   *  a player who never opens a room pays nothing, and only once. */
  const sessionRef = useRef("");
  if (!sessionRef.current) sessionRef.current = newSessionId();
  /** Which session presence last showed owning each player id. A `status` from a
   *  different session of the same player is a losing tab, and is ignored. */
  const sessionOwnersRef = useRef<Map<string, string>>(new Map());
  /** `openElsewhere`, readable from callbacks that must not re-create on it. */
  const openElsewhereRef = useRef(false);
  /**
   * What this tab would have told the room, had it been the seated one.
   *
   * A tab presence has not seated must not write — that fence is the whole of
   * `report` below — but "must not write" was implemented as "is thrown away", and
   * a run that ENDS inside the seconds a hard-closed tab's presence row lingers was
   * never reported at all: the room ghost-played the player past their real ending
   * from a stale snapshot, and the podium showed a life they never lived. Held
   * instead of dropped, and flushed the moment presence hands this tab the seat.
   * Latest only — an older year is not news once a newer one exists.
   */
  const deferredRef = useRef<{ status: PeerStatus; state: RunState | null } | null>(null);

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
    const out: PresencePayload = { v: MP_PROTOCOL, ...info, sessionId: sessionRef.current };
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
          // Somebody has now spoken for this player — the figure is real, and
          // there is nothing left to be pending about.
          reported: true,
          pending: false,
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
      // The notice belongs to the year the player came back into, not to the match.
      setResumeCatchup(null);
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
      const stalled: MatchPeer[] = [];
      for (const peer of Object.values(peersRef.current)) {
        if (peer.playerId === selfIdRef.current) continue;
        if (peer.connected || peer.status === "ended") continue;
        const snap = snapshotsRef.current.get(peer.playerId);
        if (!snap) {
          stalled.push(peer);
          continue;
        }
        const next = fastForward(snap, toYearIndex);
        snapshotsRef.current.set(peer.playerId, next);
        const st = statusOf(next, peer.playerId, true);
        send({ t: "status", v: MP_PROTOCOL, status: st });
        applyPeerStatus(st);
      }
      for (const peer of stalled) {
        // We hold no life for this player, so their row has stopped moving. That
        // happens to any client that inherited the clock after they left — a
        // rejoiner starts with an empty cache — so ask the room rather than freeze
        // them for the rest of the match: any client still holding the snapshot
        // answers, and the row starts moving again on the next boundary.
        if (!snapshotAskedRef.current.has(peer.playerId)) {
          snapshotAskedRef.current.add(peer.playerId);
          send({ t: "snapshotRequest", v: MP_PROTOCOL, playerId: peer.playerId });
        }
        // Until it does, the row must stop claiming to be auto-played. The ghost
        // mark the previous host left behind prints "Auto-played" on the board
        // beside a figure that is frozen years in the past; "Away" is the truth.
        //
        // Deliberately NOT gated on `peer.ghost`. The client this matters most to
        // is the one that just rejoined and inherited the clock, and it built this
        // row from the roster — it never received the ghost mark it is now being
        // asked to withdraw, so gating on it meant the one client that could speak
        // never did. `reported` still gates, because a status is a claim about a
        // FIGURE and a pending row has none: a placeholder $0 on the wire would
        // out-place every player who is genuinely underwater (see `MatchPeer`).
        // Those rows wait for the snapshot asked for above instead — and until it
        // lands, every screen already reads a ghost row that has fallen behind the
        // room's year as "Away" rather than "Auto" (`components/mp/MatchRail.tsx`).
        if (peer.reported) {
          const st: PeerStatus = {
            playerId: peer.playerId,
            yearIndex: peer.yearIndex,
            netWorth: peer.netWorth,
            status: peer.status,
            ready: false,
          };
          if (peer.endReason) st.endReason = peer.endReason;
          applyPeerStatus(st);
          send({ t: "status", v: MP_PROTOCOL, status: st });
        }
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
    (cfg: MatchConfig, atYearIndex: number, fresh = false) => {
      // The year this room opens on can come off a PEER'S status row (a rejoin reads
      // the room's clock from presence), and the wire allows far more years than the
      // story has. Clamped here for the same reason `applyTick` clamps: a room whose
      // clock starts outside the story prints years that do not exist.
      const at = Math.min(Math.max(1, atYearIndex), LAST_YEAR_INDEX + 1);
      setConfig(cfg);
      setPhase("running");
      setRoomYear(at);
      setDeadlineState(Date.now() + cfg.yearSeconds * 1000);
      // Only a match that is STARTING may publish an opening figure. On a rejoin
      // this runs first (the config arrives off a member's presence, before the
      // life is recovered), and a fabricated `$0` at the room's current year
      // replaces the real figure the standings were showing — out-placing everyone
      // who finished underwater, and permanently, since a lower real year is then
      // refused as stale. `joinRoom` sets the true status a moment later; until
      // then this device says nothing about itself.
      if (fresh) {
        myStatusRef.current = {
          playerId: ensureSelfId(),
          sessionId: sessionRef.current,
          yearIndex: at,
          netWorth: 0,
          status: "playing",
          ready: false,
        };
      }
      /**
       * The roster IS the match. Two things follow, and both are this one place.
       *
       * Roster members we haven't seen yet still get a row, so the standings are
       * complete from the first frame — and anyone NOT in it loses theirs. A lobby
       * member showing away is left out of the frozen roster deliberately (the
       * host is asked to confirm exactly that), but nothing else pruned them:
       * `updatePeers` only ever marks a row disconnected, so the excluded player
       * stayed in the rail as "no result yet" and took a plinth on the final
       * podium. Worse, that row is seeded `status: "playing"` and can never move —
       * every status and snapshot for a non-roster id is refused — so "the room is
       * over when every life in it is over" could never be true, and the room
       * ground out its remaining years at `GHOST_CATCHUP_MS` each instead of
       * ending. Dropping the row here fixes the rail, the podium and the hang at
       * once, on the host and on every guest, because both reach this function.
       */
      updatePeers((prev) => {
        const seated = cfg.startedAt > 0 ? new Set(cfg.roster.map((r) => r.playerId)) : null;
        const next: Record<string, MatchPeer> = {};
        for (const [id, p] of Object.entries(prev)) if (!seated || seated.has(id)) next[id] = p;
        // `fresh` is this client saying it was here when the match STARTED, and it
        // is exactly what tells the two silences apart: a roster member with no row
        // at the opening bell has genuinely not played a year yet, while one still
        // missing when we adopt a running room is a player the room has been
        // watching all along and we have simply never heard about. See `pending`.
        for (const r of cfg.roster) if (!next[r.playerId]) next[r.playerId] = blankPeer(r, false, !fresh);
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
      const cur = configRef.current;
      // Who may define this room? The host always. Once it is running, its own
      // roster. And in a LOBBY, any member — but only to SEED a client that holds
      // nothing yet, never to change one that does. Host-only was a dead end: when
      // the host closed their tab the lobby became unreadable, so nobody could join
      // a room people were sitting in and the host couldn't get back into their own
      // ("No room with that code"). Mutation stays host-only, so a member still
      // can't push a new seed or background onto a room that already has one.
      const trusted =
        from === cfg.hostId ||
        (cfg.startedAt > 0 ? cfg.roster.some((r) => r.playerId === from) : cur === null);
      if (!trusted) return;
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
      // Carry it: presence attaches whatever config this client holds, so adopting
      // without republishing leaves the host as the room's only source of it.
      publish();
    },
    [beginRunning, peerYearIndex, publish, setConfig, setError],
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
          beginRunning(cfg, 1, true);
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
        case "status": {
          // Only the acting host speaks for someone else (a ghost row), nobody
          // speaks for us, and only a player this room admitted speaks at all.
          if (msg.status.playerId === selfIdRef.current) return;
          if (!isRosterMember(msg.status.playerId)) return;
          // And for one player, only the session presence currently seats. Two tabs
          // share one player id in production and both keep reporting; without this
          // the row the whole room is watching flips between two different lives,
          // and the first tab to end closes the seat under the other one. A status
          // carrying no session is an older build or a ghost row the acting host
          // wrote for an absent player — taken, exactly as before.
          const owner = sessionOwnersRef.current.get(msg.status.playerId);
          if (msg.status.sessionId && owner && msg.status.sessionId !== owner) return;
          applyPeerStatus(msg.status);
          return;
        }
        case "snapshot": {
          // Our own entry is written locally by `report`; a peer claiming to hold our
          // life is either confused or hostile, and either way we already have it.
          // Every other entry is a whole RunState held in memory, so the cache is
          // bounded by the roster and holds nothing before the match starts.
          if (msg.playerId === selfIdRef.current) return;
          if (!isRosterMember(msg.playerId)) return;
          // And the same session fence as `status` above — because the seat and the
          // LIFE behind it have to be the same tab's. This cache is what ghost-play
          // fast-forwards from and what a rejoiner is handed when its own record is
          // missing, so leaving it last-writer-wins meant the room could watch one
          // tab's figures all match and then hand the returning player the other
          // tab's life. Fails open on an absent token for exactly the reasons
          // `status` does: an older build, and the acting host's sessionless ghost
          // rows, both still land.
          const owner = sessionOwnersRef.current.get(msg.playerId);
          if (msg.sessionId && owner && msg.sessionId !== owner) return;
          // Newest life wins. Any client holding a life may answer a
          // `snapshotRequest` and the asker takes the first reply, so a relay can
          // easily be an OLDER copy than the one already cached here — and letting
          // it land would hand the next ghost catch-up, or the player's own rejoin,
          // a life with years missing from it.
          const held = snapshotsRef.current.get(msg.playerId);
          if (held && yearIndex(held) > yearIndex(msg.state)) return;
          snapshotsRef.current.set(msg.playerId, msg.state);
          return;
        }
        case "snapshotRequest": {
          // Anyone holding this life may hand it back. "Only the acting host
          // answers" failed exactly when it was needed: a returning HOST is
          // re-elected by its own presence before it can ask for its life back, and
          // its cache went with the tab — so the only eligible answerer was the
          // asker, and the rejoin silently rebuilt a different life from the seed.
          // There is no authority to protect here: a snapshot for a player is
          // either their own report or a byte-identical deterministic fast-forward
          // of it, and duplicate answers are harmless (the waiter takes the first).
          if (msg.playerId === selfIdRef.current) return;
          if (!isRosterMember(msg.playerId)) return;
          const snap = snapshotsRef.current.get(msg.playerId);
          if (!snap) return;
          send({ t: "snapshotReply", v: MP_PROTOCOL, playerId: msg.playerId, state: snap });
          // Asked for on behalf of somebody who is still away? Then the asker is an
          // acting host that inherited an empty ghost-play cache — put it on the
          // wire as a plain snapshot too, which every client caches.
          const row = peersRef.current[msg.playerId];
          if (row && !row.connected) {
            send({ t: "snapshot", v: MP_PROTOCOL, playerId: msg.playerId, state: snap });
          }
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
    [applyPeerStatus, applyTick, beginRunning, isRosterMember, publish, send, setConfig, setError],
  );

  /**
   * Say the thing this tab was not seated to say when it happened.
   *
   * Called from presence, which is the only place the seat can change hands. The
   * status may be several years old by now, and that is fine: every peer takes the
   * later of what it holds and what it hears (`applyPeerStatus`), and readiness is
   * bound to the year it was sent for, so a stale lock-in is ignored rather than
   * pulling a year forward that nobody played.
   */
  const flushDeferred = useCallback(() => {
    const held = deferredRef.current;
    if (!held || openElsewhereRef.current || phaseRef.current === null) return;
    deferredRef.current = null;
    const cfg = configRef.current;
    const id = selfIdRef.current;
    if (held.state && cfg) saveMatch(cfg.roomCode, id, cfg, held.state);
    send({ t: "status", v: MP_PROTOCOL, status: held.status });
    if (held.state) {
      send({ t: "snapshot", v: MP_PROTOCOL, playerId: id, state: held.state, sessionId: sessionRef.current });
    }
    publish();
  }, [publish, send]);

  const handlePresence = useCallback(
    (members: unknown[]) => {
      const me = selfIdRef.current;
      const rows = new Map<string, PresencePayload>();
      for (const raw of members) {
        const p = parsePresence(raw);
        if (!p) continue;
        // Two tabs, one player: keep whichever row is actually carrying game state,
        // and only among equals the one that sat down LAST.
        //
        // Status first, and that order has a cost worth stating plainly, because it
        // is the opposite of what "newest wins" suggests: a tab that closed hard
        // leaves its presence row behind for a few seconds WITH its last status on
        // it, while a tab reopening into the same room has none until its handshake
        // finishes — so for that window the dead row keeps the seat. The window is
        // bounded at both ends (presence expiry, and the handshake), and the price
        // of the other order is worse: a tab three seconds into a rejoin holds no
        // life at all, and seating it would freeze the standings row on a blank.
        // What the gated tab has to say in the meantime is deferred, not dropped —
        // see `report`.
        //
        // The last clause makes the order TOTAL. `joinedAt` is `Date.now()` inside
        // a user-initiated `connect()`, so two sessions can share a millisecond —
        // and a `>` that stops there keeps whichever row this client happened to
        // iterate first, which is per-client object order in the Supabase
        // transport (`presenceState()` keys). Half the room would then seat one
        // session and half the other, which is precisely the split this whole
        // mechanism exists to remove. Comparing the tokens breaks the tie the same
        // way everywhere, exactly as the two roster sorts already fall back to
        // `playerId`.
        const prev = rows.get(p.playerId);
        if (!prev || (!prev.status && p.status) || (!!prev.status === !!p.status && newerSession(p, prev))) {
          rows.set(p.playerId, p);
        }
      }
      // Which session speaks for each player right now. `handleMessage` drops a
      // `status` from any other session of the same player, so two tabs sharing one
      // player id stop overwriting one standings row with two different lives — and
      // the first of them to finish stops closing the seat under the other.
      const owners = sessionOwnersRef.current;
      owners.clear();
      for (const [id, row] of rows) if (row.sessionId) owners.set(id, row.sessionId);
      /**
       * "Another tab holds the seat" — read off the row that actually WON above,
       * never recomputed from a weaker rule.
       *
       * It used to be decided by `joinedAt` alone while the seat was decided
       * status-first and only then by `joinedAt`, so the two could disagree: a
       * second tab part-way through the rejoin handshake publishes presence
       * before it has a status (`connect()` runs with `myStatusRef` null), and
       * for that whole window the tab the player is really using was told it was
       * the dead one — advice which, taken, closes the live run. One expression,
       * one decision, and the notice can no longer contradict the room.
       */
      const mine = me ? rows.get(me) : undefined;
      setOpenElsewhere(!!mine?.sessionId && mine.sessionId !== sessionRef.current);
      openElsewhereRef.current = !!mine?.sessionId && mine.sessionId !== sessionRef.current;

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
            row.reported = true;
            row.pending = false;
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
            reported: mine !== null || (was?.reported ?? false),
          };
        }
        // A seat on the frozen roster whose player is not here. This client is
        // inventing the row rather than hearing it, so it says so: `pending` is the
        // difference between "never played" and "I only just got here".
        for (const r of configRef.current?.roster ?? []) if (!next[r.playerId]) next[r.playerId] = blankPeer(r, false, true);
        return next;
      });

      for (const p of rows.values()) if (p.config) adoptConfig(p.config, p.playerId);
      // The seat may have just come to us — the other tab closed, or its row finally
      // expired. Anything this tab held back while it was gated goes now.
      flushDeferred();
    },
    [adoptConfig, flushDeferred, updatePeers],
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
    snapshotAskedRef.current.clear();
    sessionOwnersRef.current.clear();
    openElsewhereRef.current = false;
    deferredRef.current = null;
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
      // The name this device is now playing under, kept for the next Setup. A
      // player who reloads out of a LOBBY has no frozen roster to take their name
      // back from and returns as "PLAYER" — see `rememberPlayerName`.
      rememberPlayerName(info.name);
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
    setResumeCatchup(null);
    setOpenElsewhere(false);
    openElsewhereRef.current = false;
    deferredRef.current = null;
    updatePeers(() => ({}));
    myStatusRef.current = null;
    myStateRef.current = null;
    selfInfoRef.current = null;
  }, [setConfig, setPhase, setRoomYear, updatePeers]);

  const leaveMatch = useCallback(() => {
    // Walking out withdraws this room's claim to be the FIRST one offered back: all
    // `forgetRoom` drops is the "last room entered" marker. The stored life stays,
    // deliberately — it is the player's own ledger — so a room a year has turned in
    // is still offered for the rejoin window and still makes Setup's solo CTA ask
    // twice. Only a room walked out of before its first year vanishes from the
    // offer, because there was never a record of it to keep. See `forgetRoom`.
    const left = configRef.current?.roomCode;
    if (left) forgetRoom(left);
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
        // Offer it back before the first year turns: the record that normally
        // carries a room across a closed tab is only written once a year advances,
        // so a lobby used to be the one place a fumbled tab was unrecoverable.
        rememberRoom(code);
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
          // Three meanings, told apart. A running room whose roster excludes us
          // never hands us a config at all; and a room this device was PLAYING can
          // only go quiet by emptying out, so "check the letters" would blame the
          // player for a code they were handed by a button.
          //
          // Only the first is a REFUSAL, and it is one because a member's presence
          // carried a frozen roster without us on it — the room answered. The other
          // two are a single silence read two ways: a room whose members are all in
          // a backgrounded tab sounds exactly like a room that has emptied, so
          // neither is proof of anything (see `RoomRefusedError`).
          if (startedWithoutMeRef.current) {
            // Same rule as the roster gate below, and this is the branch the player
            // it applies to actually reaches: a room that started without them never
            // hands them a config to check a seat against.
            throw new RoomRefusedError(
              "That match has already started — only the players who were in the room when it started can rejoin.",
            );
          }
          throw new Error(
            loadMatch(code, selfIdRef.current)
              ? "That room isn't running any more — everyone in it has left."
              : "No room with that code — check the letters and try again.",
          );
        }
        if (cfg.startedAt === 0) {
          // Eight seats, checked at the door. Slicing the surplus off at start time
          // instead means a player sits in a lobby they were never really in.
          if (othersRef.current >= MAX_PLAYERS) {
            throw new Error(`That room is full (${MAX_PLAYERS} players).`);
          }
          rememberRoom(code);
          return "joined";
        }

        // Running match: the roster is the gate. A stranger can't walk in mid-run,
        // but the player who dropped out of it can. Say which rule turned them
        // away — a player who was in the lobby and reloaded while the host started
        // has no way to tell this from a mistyped code.
        const seat = cfg.roster.find((r) => r.playerId === selfIdRef.current);
        if (!seat) {
          throw new RoomRefusedError(
            "That match has already started — only the players who were in the room when it started can rejoin.",
          );
        }
        /**
         * The room already knows this seat, by the name it was frozen into the
         * roster under — so a rejoin ADOPTS that name rather than carrying one in.
         *
         * This used to defer to any name that wasn't the anonymous default, on the
         * premise that "a returning player lands on a fresh Setup whose name field
         * is empty". Setup now prefills that field from `lifepatch.playerName`,
         * which is per DEVICE and not per room, so the premise is false: a player
         * who opened any other room in between comes back through an untouched
         * field carrying somebody else's name, and it lands in every rail and on
         * the podium — twice, next to the player it was borrowed from. Renaming a
         * seat mid-match has no upside worth that: the standings have been showing
         * this name for the whole run, and the life underneath is unchanged either
         * way (`seat.name` is also what a seed rebuild below is initialised with).
         */
        if (selfInfoRef.current && selfInfoRef.current.name !== seat.name) {
          selfInfoRef.current = { ...selfInfoRef.current, name: seat.name };
          updatePeers((prev) => {
            const row = prev[selfIdRef.current];
            return row ? { ...prev, [selfIdRef.current]: { ...row, name: seat.name } } : prev;
          });
          // And say so NOW. `connect` published this device's remembered name to get
          // in the door, and the only republish used to be at the end of the rejoin
          // — after a snapshot wait that can run to four seconds — so the borrowed
          // name sat in every peer's rail for the whole handshake plus the whole
          // wait. The handshake is unavoidable (there is no roster to read a name
          // off until it lands); the rest of it was not.
          publish();
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
        // `sharedEvents` is not optional. A match run takes its cards from the
        // room's one running order; rebuilt without the flag, this life quietly
        // starts drawing from a private pool — the exact desync the shared deck
        // exists to prevent, and it is silent (see lib/mp/protocol.ts).
        const base = local ?? remote ?? initRun("story", cfg.backgroundId, seat.name, cfg.seed, true);
        const from = yearIndex(base);
        const caught = fastForward(base, target);
        myStateRef.current = caught;
        myStatusRef.current = statusOf(caught, selfIdRef.current, false, sessionRef.current);
        setResumeState(caught);
        // Years the room played for them. Coming back to a later year and a net
        // worth you never chose, with nothing said about it, reads as lost work.
        setResumeCatchup(yearIndex(caught) > from ? { from, to: yearIndex(caught) } : null);
        saveMatch(cfg.roomCode, selfIdRef.current, cfg, caught);
        rememberRoom(cfg.roomCode);
        applyPeerStatus(myStatusRef.current);
        send({ t: "status", v: MP_PROTOCOL, status: myStatusRef.current });
        send({ t: "snapshot", v: MP_PROTOCOL, playerId: selfIdRef.current, state: caught, sessionId: sessionRef.current });
        publish();
        return "rejoined";
      } catch (e) {
        await teardown();
        resetState();
        const msg = messageOf(e, "Couldn't join that room.");
        setError(msg);
        // Rewrapped so the caller sees one error shape — except for a refusal,
        // which is rethrown as itself: the panel decides whether to withdraw the
        // rejoin offer on the strength of that type alone.
        throw e instanceof RoomRefusedError ? e : new Error(msg);
      }
    },
    [applyPeerStatus, connect, peerYearIndex, publish, requestSnapshot, resetState, send, setError, setPhase, teardown, updatePeers, waitFor],
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
    beginRunning(final, 1, true);
  }, [beginRunning, send, setError]);

  // ── in-run reporting ──────────────────────────────────────────────────────
  const markReady = useCallback(() => {
    if (phaseRef.current !== "running") return;
    const base = myStatusRef.current ?? {
      playerId: selfIdRef.current,
      sessionId: sessionRef.current,
      yearIndex: roomYearRef.current,
      netWorth: 0,
      status: "playing" as const,
      ready: false,
    };
    if (base.status === "ended" || base.ready) return;
    const st: PeerStatus = { ...base, ready: true };
    myStatusRef.current = st;
    applyPeerStatus(st);
    // The same fence, and the same deferral, as `report` below: a lock-in from a
    // tab the room is not listening to is dropped by every peer's session check on
    // arrival, so sending it only made the drop silent — the room then ran the full
    // clock every year while the player sat there having answered. Held instead, it
    // goes out the moment presence seats this tab. If the year has turned by then it
    // is a lock-in for a year the room has left, which every peer already ignores.
    if (openElsewhereRef.current) deferredRef.current = { status: st, state: myStateRef.current };
    else send({ t: "status", v: MP_PROTOCOL, status: st });
    publish();
  }, [applyPeerStatus, publish, send]);

  /** One local advance: the standings row, the ghost-play snapshot, and the save. */
  const report = useCallback(
    (state: RunState) => {
      if (phaseRef.current === null) return;
      const id = selfIdRef.current;
      myStateRef.current = state;
      const st = statusOf(state, id, false, sessionRef.current);
      myStatusRef.current = st;
      applyPeerStatus(st);
      snapshotsRef.current.set(id, state);
      /**
       * Everything above is LOCAL: this tab keeps playing, keeps its own cache and
       * keeps showing the player their own figures. The writes below are the ones
       * the SEAT owns, and a tab presence has not seated must not make them.
       *
       * `saveMatch` keys on (room, playerId), which two tabs of one device both
       * satisfy, and every peer's snapshot cache is keyed the same way. Left open,
       * the room's standings would follow the seated session while the life stored
       * under that seat — the one a rejoin resumes and ghost-play fast-forwards —
       * was whichever tab wrote last. The seat and the life behind it are fenced
       * by the same fact now.
       *
       * But the fence DEFERS; it does not discard. A player who opens a second tab
       * and closes it again leaves a presence row that holds the seat for seconds,
       * and a run that ended inside that window used to go unsaid for good — the
       * room went on ghost-playing a life that was already over and put a figure on
       * the podium its player never reached. The alternative fixes are both traps:
       * letting an un-seated tab broadcast is the two-lives-one-row bug this fence
       * exists for, and handing the seat to whoever spoke most recently hands it to
       * an ignored tab, because a player thinking about a choice is silent for
       * three quarters of a minute. So the news waits for the seat instead.
       *
       * `publish()` still runs either way. A presence row is this tab saying it is
       * here, which is true; every peer's dedupe drops it in favour of the seated
       * row, and the moment the seated tab goes the row is already fresh and this
       * tab takes over with nothing lost.
       */
      const cfg = configRef.current;
      if (openElsewhereRef.current) {
        deferredRef.current = { status: st, state };
      } else {
        deferredRef.current = null; // superseded by the live write below
        if (cfg) saveMatch(cfg.roomCode, id, cfg, state);
        send({ t: "status", v: MP_PROTOCOL, status: st });
        send({ t: "snapshot", v: MP_PROTOCOL, playerId: id, state, sessionId: sessionRef.current });
      }
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
    const rows = Object.values(peers);
    const here = rows.filter((p) => p.connected);
    const live = here.filter((p) => p.status === "playing");
    // Nobody still in the room is playing, so there is nobody left to wait for and
    // nothing to skip: what remains are absent rows being ghost-played, and the
    // catch-up effect below owns the clock for those.
    if (live.length === 0) return;
    // Readiness is bound to the year it was sent for: a lock-in from the year the
    // room has already left is not consent to skip the year that replaced it.
    if (!live.every((p) => p.ready && p.yearIndex >= roomYearIndex)) return;
    emitTick();
  }, [phase, isHost, peers, roomYearIndex, emitTick]);

  // The ghost catch-up, on EVERY client — not just the one holding the clock.
  //
  // Once nobody still in the room is playing, all that is left to run out is
  // auto-play, and at a real year length the players who finished sit and watch a
  // life nobody is living take up to twenty minutes. Shortened, not skipped: a
  // player on their way back can still land in the room before it closes.
  //
  // It used to be shortened on the acting host alone, which nobody else could see:
  // the tick that host emits re-anchors every other clock on a FULL year
  // (`applyTick` reads `config.yearSeconds`), so the rest of the room watched the
  // countdown reset to 0:45 and then jump again a second and a half later, over and
  // over. The condition is read off the standings, which every client has, so they
  // all shorten the same year at the same moment and the clock says what is
  // happening. A non-host's own fallback tick sits `TICK_GRACE_MS` past this, so it
  // still only fires if the host really has gone.
  useEffect(() => {
    if (phase !== "running" || deadlineAt === null) return;
    const rows = Object.values(peers);
    const here = rows.filter((p) => p.connected);
    if (here.length === 0) return; // presence hasn't landed yet — never hurry the start
    if (here.some((p) => p.status === "playing")) return;
    if (rows.every((p) => p.status === "ended")) return; // the finish effect owns this
    if (deadlineAt - Date.now() > GHOST_CATCHUP_MS) setDeadlineState(Date.now() + GHOST_CATCHUP_MS);
  }, [phase, peers, deadlineAt]);

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
      resumeCatchup,
      openElsewhere,
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
      phase, config, peers, selfId, isHost, deadlineAt, roomYearIndex, error, resumeState, resumeCatchup,
      openElsewhere, createRoom, joinRoom, setYearSeconds, setBackground, startMatch, markReady,
      reportAdvance, reportEnded, leaveMatch,
    ],
  );

  return <MatchCtx.Provider value={api}>{children}</MatchCtx.Provider>;
}
