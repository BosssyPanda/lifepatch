import { playerName } from "@/components/ui/NameField";
import { ASSET_IDS, type AssetId } from "@/lib/markets";
import type { ModeId } from "@/lib/modes";
import { RUN_VERSION, type EndReason, type Life, type MarketYear, type RunState, type YearRecord } from "@/lib/runEngine";
import { isRoomCode } from "./roomCodes";
import type { MatchConfig, PeerInfo, PeerStatus, YearSeconds } from "./types";

/**
 * The wire format for a match room, and the gate every inbound byte passes.
 *
 * EVERYTHING that arrives from the channel is a stranger's input. There is no
 * server and no authority, so this file is the only thing standing between a
 * hand-crafted broadcast and the engine: shapes are checked field by field,
 * numbers are clamped to ranges the game can survive, names go through the same
 * `playerName()` every other screen uses, and anything speaking a different
 * protocol version is dropped rather than guessed at. Parsers REBUILD their
 * result — nothing from the wire is passed through by reference, so a peer can
 * never smuggle an extra key into state we then persist.
 */
export const MP_PROTOCOL = 1;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

/** The host-tunable countdown, in the order the lobby picker shows them. */
export const YEAR_SECONDS_OPTIONS: YearSeconds[] = [30, 45, 60, 90];

/** One broadcast event carries every message; `t` discriminates. */
export const MP_EVENT = "mp";

/**
 * Channel topic. Versioned so a protocol bump can never land in a live room.
 *
 * The version is `MP_PROTOCOL` itself, not a literal. Hardcoded, the guarantee in
 * that first sentence was never actually implemented: two builds speaking
 * different protocols still met on the same topic, where every one of each
 * other's messages failed the `v !== MP_PROTOCOL` check in the parsers below. The
 * room did not refuse them — it could not see them. Each side watched the other
 * go silent, ghost-played them, and told a player who had typed the code
 * correctly that no room with it existed. Splitting the topic makes a bump behave
 * like what it is: two separate rooms, each internally coherent.
 */
export function channelName(roomCode: string): string {
  return `lp-match-v${MP_PROTOCOL}-${roomCode}`;
}

/**
 * Presence key. Two tabs on one device are two connections but ONE player, so the
 * key carries a per-tab nonce and the UI dedupes rows by `playerId`.
 */
export function presenceKey(playerId: string, tabNonce: string): string {
  return `${playerId}#${tabNonce}`;
}

export function playerIdOfPresenceKey(key: string): string {
  return key.split("#")[0] ?? "";
}

// ── Wire shapes ─────────────────────────────────────────────────────────────

/**
 * What every member publishes about itself. `status` and `config` ride along so a
 * rejoiner can read the whole room off ANY member's presence — there is no table
 * to ask.
 */
export type PresencePayload = {
  v: number;
  playerId: string;
  /**
   * This tab's session — see `PeerStatus.sessionId`. Among the rows sharing a
   * player id the NEWEST session owns the seat, which is also what stops a row
   * left behind by a hard tab close being preferred for the seconds before
   * presence prunes it. Additive and optional, so a peer that doesn't send one
   * is treated exactly as it was before the field existed.
   */
  sessionId?: string;
  name: string;
  avatarSeed: string;
  joinedAt: number;
  /**
   * The engine build this member is running (`RUN_VERSION`).
   *
   * Two builds in one room cannot share a life: `parseRunState` refuses a
   * snapshot whose version isn't ours, so a deploy landing mid-match leaves every
   * client silently unable to hear anyone else's run while the standings, the
   * ghost-play and the podium all carry on as if nothing were wrong. Advertising
   * it is what lets the room SAY so instead. Additive and optional, so a client
   * from before this field is treated exactly as it was.
   */
  runVersion?: number;
  status?: PeerStatus;
  config?: MatchConfig;
};

export type ConfigMsg = { t: "config"; v: number; config: MatchConfig };
export type StartMsg = { t: "start"; v: number; config: MatchConfig };
export type TickMsg = { t: "tick"; v: number; yearIndex: number; yearSeconds: YearSeconds };
export type StatusMsg = { t: "status"; v: number; status: PeerStatus };
/**
 * A whole life, for the ghost-play cache and for handing back to a rejoiner.
 *
 * `sessionId` is the same additive, optional token `PeerStatus` carries, and for
 * the same reason: two tabs of one device share a player id, so without it the
 * cache behind a seat is last-writer-wins even once the standings row is fenced —
 * the room follows one tab and the returning player is handed the other tab's
 * life. Stamped ONLY on a snapshot of our own life; the acting host relaying an
 * absent player's cached life speaks for somebody else and carries none.
 *
 * `selfYear` is the last year index this life was advanced by the PLAYER rather
 * than by auto-play, and it travels with the life: a ghost fast-forward moves
 * `state` and leaves `selfYear` where it was, so the number survives every relay
 * between the player leaving and the player coming back. It exists because the
 * catch-up notice names a range, a range needs a floor, and a rejoin served by
 * the room's cache is handed a life already fast-forwarded to the room's year —
 * there is nothing left in `state` to subtract. Also optional, also additive: a
 * client on an older build sends none, and a rejoin without one says nothing
 * rather than naming years it cannot stand behind.
 */
export type SnapshotMsg = {
  t: "snapshot";
  v: number;
  playerId: string;
  state: RunState;
  sessionId?: string;
  selfYear?: number;
};
export type SnapshotRequestMsg = { t: "snapshotRequest"; v: number; playerId: string };
export type SnapshotReplyMsg = {
  t: "snapshotReply";
  v: number;
  playerId: string;
  state: RunState;
  selfYear?: number;
};

export type MpMessage =
  | ConfigMsg
  | StartMsg
  | TickMsg
  | StatusMsg
  | SnapshotMsg
  | SnapshotRequestMsg
  | SnapshotReplyMsg;

// ── Primitive guards ────────────────────────────────────────────────────────

/** Ceilings chosen to be far beyond any real run and far below anything that hurts. */
const MAX_YEAR_INDEX = 400;
const MONEY_LIMIT = 1e12;
const MAX_HISTORY = 400;
const MAX_EVENT_IDS = 400;
const MAX_FLAGS = 400;
const MAX_NAME = 24;
const MAX_ID = 64;
const PLAYER_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A finite number, clamped. Anything else (NaN, Infinity, "12", null) is rejected. */
function num(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(max, Math.max(min, v));
}

function int(v: unknown, min: number, max: number): number | null {
  const n = num(v, min, max);
  return n === null ? null : Math.round(n);
}

function money(v: unknown): number | null {
  return num(v, -MONEY_LIMIT, MONEY_LIMIT);
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  return v.slice(0, max);
}

function playerId(v: unknown): string | null {
  const s = str(v, MAX_ID);
  return s && PLAYER_ID_RE.test(s) ? s : null;
}

/**
 * A per-tab, per-mount session token. Same charset and cap as a player id — it
 * rides the same wire and ends up in the same string comparisons. Returns
 * `undefined` rather than null for the absent case, because absent is legal:
 * every reader has to keep working without one.
 */
function sessionToken(v: unknown): string | undefined {
  const s = str(v, MAX_ID);
  return s && PLAYER_ID_RE.test(s) ? s : undefined;
}

/** The room's one naming rule, shared with Setup and the leaderboard. */
function peerName(v: unknown): string {
  return playerName(typeof v === "string" ? v.slice(0, MAX_NAME) : "");
}

function avatarSeed(v: unknown): string {
  const s = typeof v === "string" ? v.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 32) : "";
  return s || "0";
}

function isYearSeconds(v: unknown): v is YearSeconds {
  return v === 30 || v === 45 || v === 60 || v === 90;
}

const MODE_IDS: ModeId[] = ["story", "infinite", "cashflow"];
const END_REASONS: EndReason[] = ["story-complete", "retired", "quit", "died", "insolvent"];

// ── Parsers ─────────────────────────────────────────────────────────────────

export function parsePeerInfo(raw: unknown): PeerInfo | null {
  if (!isObj(raw)) return null;
  const id = playerId(raw.playerId);
  if (!id) return null;
  return {
    playerId: id,
    name: peerName(raw.name),
    avatarSeed: avatarSeed(raw.avatarSeed),
    joinedAt: int(raw.joinedAt, 0, Number.MAX_SAFE_INTEGER) ?? 0,
  };
}

export function parsePeerStatus(raw: unknown): PeerStatus | null {
  if (!isObj(raw)) return null;
  const id = playerId(raw.playerId);
  const yi = int(raw.yearIndex, 0, MAX_YEAR_INDEX);
  const nw = money(raw.netWorth);
  if (!id || yi === null || nw === null) return null;
  if (raw.status !== "playing" && raw.status !== "ended") return null;
  const reason = typeof raw.endReason === "string" && (END_REASONS as string[]).includes(raw.endReason)
    ? raw.endReason
    : undefined;
  const out: PeerStatus = {
    playerId: id,
    yearIndex: yi,
    netWorth: Math.round(nw),
    status: raw.status,
    ready: raw.ready === true,
  };
  if (reason) out.endReason = reason;
  if (raw.ghost === true) out.ghost = true;
  const session = sessionToken(raw.sessionId);
  if (session) out.sessionId = session;
  return out;
}

export function parseMatchConfig(raw: unknown): MatchConfig | null {
  if (!isObj(raw)) return null;
  if (raw.v !== MP_PROTOCOL) return null;
  if (!isRoomCode(raw.roomCode)) return null;
  const seed = int(raw.seed, 0, 1e9);
  const host = playerId(raw.hostId);
  const bg = str(raw.backgroundId, 32);
  if (seed === null || !host || !bg || !isYearSeconds(raw.yearSeconds)) return null;
  if (!Array.isArray(raw.roster)) return null;

  // Cap the roster BEFORE parsing, and drop duplicate ids — a roster is also a
  // rejoin gate, so a padded one is an authorisation bug, not a display bug.
  const roster: PeerInfo[] = [];
  const seen = new Set<string>();
  for (const entry of raw.roster.slice(0, MAX_PLAYERS)) {
    const peer = parsePeerInfo(entry);
    if (!peer || seen.has(peer.playerId)) continue;
    seen.add(peer.playerId);
    roster.push(peer);
  }

  return {
    v: MP_PROTOCOL,
    roomCode: raw.roomCode,
    seed,
    yearSeconds: raw.yearSeconds,
    backgroundId: bg,
    hostId: host,
    startedAt: int(raw.startedAt, 0, Number.MAX_SAFE_INTEGER) ?? 0,
    roster,
  };
}

function parseLife(raw: unknown): Life | null {
  if (!isObj(raw)) return null;
  const health = num(raw.health, 0, 100);
  const happiness = num(raw.happiness, 0, 100);
  const kids = int(raw.kids, 0, 20);
  if (health === null || happiness === null || kids === null) return null;
  if (raw.housing !== "renting" && raw.housing !== "owned") return null;
  return { health, happiness, partner: raw.partner === true, kids, housing: raw.housing };
}

function parseReturns(raw: unknown): Record<AssetId, number> {
  const out = {} as Record<AssetId, number>;
  const src = isObj(raw) ? raw : {};
  for (const id of ASSET_IDS) out[id] = num(src[id], -100, 1e4) ?? 0;
  return out;
}

/**
 * A peer's whole run. This one matters most: ghost-play feeds it straight into
 * `advanceYear`, so every field the engine reads is rebuilt as a finite number or
 * the snapshot is refused outright. `version` is checked against RUN_VERSION for
 * the same reason `isCompatibleSave` does — a run from another engine is not a
 * run we can simulate.
 */
export function parseRunState(raw: unknown): RunState | null {
  if (!isObj(raw)) return null;
  if (raw.version !== RUN_VERSION) return null;
  if (typeof raw.mode !== "string" || !(MODE_IDS as string[]).includes(raw.mode)) return null;

  const startYear = int(raw.startYear, 0, 4000);
  const year = int(raw.year, 0, 4000);
  const age = int(raw.age, 0, 200);
  const cash = money(raw.cash);
  const debt = money(raw.debt);
  const homeValue = money(raw.homeValue);
  const mortgage = money(raw.mortgage);
  const salary = money(raw.salary);
  const seed = int(raw.seed, 0, 1e9);
  const lastDelta = money(raw.lastDelta);
  const interestPaid = money(raw.interestPaid);
  const insolventStreak = int(raw.insolventStreak, 0, 1000);
  const life = parseLife(raw.life);
  const bg = str(raw.backgroundId, 32);
  const job = str(raw.job, 64);
  if (
    startYear === null || year === null || age === null || cash === null || debt === null ||
    homeValue === null || mortgage === null || salary === null || seed === null ||
    lastDelta === null || interestPaid === null || insolventStreak === null ||
    !life || bg === null || job === null
  ) {
    return null;
  }
  // `null` is a legal value here (Infinite runs never end), so "absent/invalid"
  // and "open-ended" have to stay apart — `int()` returning null means invalid.
  let endYear: number | null = null;
  if (raw.endYear !== null && raw.endYear !== undefined) {
    const ey = int(raw.endYear, 0, 4000);
    if (ey === null) return null;
    endYear = ey;
  }
  if (raw.status !== "playing" && raw.status !== "ended") return null;
  /**
   * A life cannot predate its own start, and cannot be four thousand years long.
   *
   * `year` and `startYear` were each clamped to [0, 4000] but never against each
   * other, and the room ranks a run by `yearIndex` — `year - startYear + 1`. So
   * `{ startYear: 0, year: 4000 }` parsed cleanly and scored 4001, which beat every
   * real snapshot's freshness test and displaced the victim's cached life for good.
   * That cache is what ghost-play fast-forwards and what a rejoiner is handed, so
   * the forged run became the life they came back to.
   */
  if (year < startYear || year - startYear + 1 > MAX_YEAR_INDEX) return null;

  const holdings = {} as Record<AssetId, number>;
  const rawHoldings = isObj(raw.holdings) ? raw.holdings : {};
  for (const id of ASSET_IDS) holdings[id] = Math.max(0, num(rawHoldings[id], 0, MONEY_LIMIT) ?? 0);

  const history: YearRecord[] = [];
  if (Array.isArray(raw.history)) {
    for (const r of raw.history.slice(0, MAX_HISTORY)) {
      if (!isObj(r)) continue;
      history.push({
        yearIndex: int(r.yearIndex, 0, MAX_YEAR_INDEX) ?? 0,
        year: int(r.year, 0, 4000) ?? 0,
        age: int(r.age, 0, 200) ?? 0,
        netWorth: Math.round(money(r.netWorth) ?? 0),
        indexReturn: num(r.indexReturn, -100, 1e4) ?? 0,
        portfolioDelta: Math.round(money(r.portfolioDelta) ?? 0),
        cashFlow: Math.round(money(r.cashFlow) ?? 0),
      });
    }
  }

  const marketLog: MarketYear[] = [];
  if (Array.isArray(raw.marketLog)) {
    for (const m of raw.marketLog.slice(0, MAX_HISTORY)) {
      if (!isObj(m)) continue;
      marketLog.push({ year: int(m.year, 0, 4000) ?? 0, returns: parseReturns(m.returns) });
    }
  }

  const flags: Record<string, number> = {};
  if (isObj(raw.flags)) {
    for (const [k, v] of Object.entries(raw.flags).slice(0, MAX_FLAGS)) {
      const y = int(v, 0, 4000);
      if (k.length <= 48 && y !== null) flags[k] = y;
    }
  }

  const ids = (v: unknown): string[] => {
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const e of v.slice(0, MAX_EVENT_IDS)) if (typeof e === "string" && e.length <= 48) out.push(e);
    return out;
  };

  const yearChoices: Record<string, string> = {};
  if (isObj(raw.yearChoices)) {
    for (const [k, v] of Object.entries(raw.yearChoices).slice(0, MAX_EVENT_IDS)) {
      if (k.length <= 48 && typeof v === "string" && v.length <= 48) yearChoices[k] = v;
    }
  }

  const state: RunState = {
    version: RUN_VERSION,
    mode: raw.mode as ModeId,
    startYear,
    endYear,
    year,
    age,
    name: peerName(raw.name),
    backgroundId: bg,
    cash,
    debt: Math.max(0, debt),
    homeValue: Math.max(0, homeValue),
    mortgage: Math.max(0, mortgage),
    salary: Math.max(0, salary),
    job,
    holdings,
    life,
    history,
    marketLog,
    flags,
    usedEvents: ids(raw.usedEvents),
    pendingEvents: ids(raw.pendingEvents),
    yearChoices,
    status: raw.status,
    seed,
    lastDelta,
    interestPaid: Math.max(0, interestPaid),
    insolventStreak,
  };
  if (typeof raw.endReason === "string" && (END_REASONS as string[]).includes(raw.endReason)) {
    state.endReason = raw.endReason as EndReason;
  }
  // A snapshot only ever crosses the wire inside a match, and a match deals from
  // the shared deck. Carrying the flag keeps a ghost-played or rejoined life
  // drawing the same cards as the players who stayed — drop it and a returning
  // player quietly starts living in a different world from the room.
  if (raw.sharedEvents === true) state.sharedEvents = true;
  return state;
}

export function parsePresence(raw: unknown): PresencePayload | null {
  if (!isObj(raw)) return null;
  if (raw.v !== MP_PROTOCOL) return null;
  const info = parsePeerInfo(raw);
  if (!info) return null;
  const out: PresencePayload = { v: MP_PROTOCOL, ...info };
  const session = sessionToken(raw.sessionId);
  if (session) out.sessionId = session;
  const runVersion = int(raw.runVersion, 0, 1e6);
  if (runVersion !== null) out.runVersion = runVersion;
  const status = parsePeerStatus(raw.status);
  // A member may only speak for itself — a presence row claiming someone else's
  // status is the cheap way to fake a leaderboard, so it is dropped.
  if (status && status.playerId === info.playerId) out.status = status;
  const config = parseMatchConfig(raw.config);
  if (config) out.config = config;
  return out;
}

/**
 * The single door for broadcast traffic. Returns null for anything malformed, for
 * a different protocol version, or for a message type this build doesn't know —
 * callers just ignore null.
 */
export function parseMessage(raw: unknown): MpMessage | null {
  if (!isObj(raw)) return null;
  if (raw.v !== MP_PROTOCOL) return null;
  switch (raw.t) {
    case "config": {
      const config = parseMatchConfig(raw.config);
      return config ? { t: "config", v: MP_PROTOCOL, config } : null;
    }
    case "start": {
      const config = parseMatchConfig(raw.config);
      return config ? { t: "start", v: MP_PROTOCOL, config } : null;
    }
    case "tick": {
      const yi = int(raw.yearIndex, 0, MAX_YEAR_INDEX);
      if (yi === null || !isYearSeconds(raw.yearSeconds)) return null;
      return { t: "tick", v: MP_PROTOCOL, yearIndex: yi, yearSeconds: raw.yearSeconds };
    }
    case "status": {
      const status = parsePeerStatus(raw.status);
      return status ? { t: "status", v: MP_PROTOCOL, status } : null;
    }
    case "snapshot": {
      const id = playerId(raw.playerId);
      const state = parseRunState(raw.state);
      if (!id || !state) return null;
      const out: SnapshotMsg = { t: "snapshot", v: MP_PROTOCOL, playerId: id, state };
      const session = sessionToken(raw.sessionId);
      if (session) out.sessionId = session;
      const self = int(raw.selfYear, 1, MAX_YEAR_INDEX);
      if (self !== null) out.selfYear = self;
      return out;
    }
    case "snapshotReply": {
      const id = playerId(raw.playerId);
      const state = parseRunState(raw.state);
      if (!id || !state) return null;
      const out: SnapshotReplyMsg = { t: "snapshotReply", v: MP_PROTOCOL, playerId: id, state };
      const self = int(raw.selfYear, 1, MAX_YEAR_INDEX);
      if (self !== null) out.selfYear = self;
      return out;
    }
    case "snapshotRequest": {
      const id = playerId(raw.playerId);
      return id ? { t: "snapshotRequest", v: MP_PROTOCOL, playerId: id } : null;
    }
    default:
      return null;
  }
}
