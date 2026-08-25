import { DEFAULT_PLAYER_NAME } from "@/components/ui/NameField";
import { parseMatchConfig, parseRunState } from "./protocol";
import { isRoomCode } from "./roomCodes";
import type { MatchConfig } from "./types";
import type { RunState } from "@/lib/runEngine";

/**
 * Where a match run lives on the device.
 *
 * Deliberately NOT `lib/saves.ts`. That store is keyed `(user_id, mode)` and a
 * match run is still `mode: "story"` — routing one through it would overwrite the
 * player's solo story save with a run they were forced to start from the host's
 * background and seed. So match state gets its own localStorage namespace,
 * keyed by room, and never touches the cloud: guests play too, and there is no
 * table for it.
 *
 * This is also the rejoin path. A player who closes the tab mid-match reopens it,
 * types the room code, and their last snapshot is read from here and
 * fast-forwarded to the room's year.
 */

export type MatchRecord = {
  /**
   * Whose life this is. The key is the room, but a device can hold more than one
   * player id for the same room — two tabs under `NEXT_PUBLIC_MP_LOCAL=1` are two
   * players sharing one localStorage, and a guest who later signs in changes id.
   * Without this stamp a rejoin would happily resume whichever life wrote last,
   * i.e. somebody else's ledger. `loadMatch` refuses a record it doesn't own.
   */
  playerId: string;
  config: MatchConfig;
  state: RunState;
  updatedAt: number;
};

const PREFIX = "lifepatch.mp.";
/** Three rooms is more history than anyone rejoins; the oldest is evicted. */
const MAX_ROOMS = 3;
/**
 * The last room this device ENTERED, whether or not a year has turned in it yet.
 * A `MatchRecord` needs a life to store, so it is only written once the run
 * advances — which left the lobby, and the whole of year one, with no way back
 * after a closed tab. This marker is the room code and nothing else.
 */
const RECENT_KEY = `${PREFIX}recent`;
/** A room the player was already told is gone, so the offer isn't a repeating trap. */
const DISMISSED_KEY = `${PREFIX}rejoinDismissed`;
/**
 * What this device last called itself. Deliberately OUTSIDE the `lifepatch.mp.`
 * room namespace: a name belongs to the device, not to a room, and solo Setup
 * reads it too. It sits in this file only because this is where the localStorage
 * plumbing for the `lifepatch.` keys already lives.
 */
const NAME_KEY = "lifepatch.playerName";
/** The same cap the name input enforces (`components/ui/NameField.tsx`). */
const MAX_NAME = 24;

/** How long a room this device touched stays offered as a way back in.
 *  A 21-year match runs well under an hour; a day is generous without being a
 *  graveyard of dead codes. */
export const REJOIN_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A room worth offering as a way back: which one, how fresh, and whether the
 *  life this device holds in it is already over. */
export type RecentRoom = { roomCode: string; updatedAt: number; ended: boolean };

function keyFor(roomCode: string): string {
  return `${PREFIX}${roomCode}`;
}

/** Storage is unavailable during SSR and can throw in private modes — see lib/saves. */
function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * This device's copy of `playerId`'s run in `roomCode`, or null when there isn't
 * one — including when the record on that key belongs to a different player.
 * Refusing is the safe answer: the rejoin path falls through to the acting host's
 * snapshot, which is the same life by determinism.
 */
export function loadMatch(roomCode: string, playerId: string): MatchRecord | null {
  const store = storage();
  if (!store || !isRoomCode(roomCode) || !playerId) return null;
  try {
    const raw = store.getItem(keyFor(roomCode));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const rec = parsed as Record<string, unknown>;
    // Whose life is this? A record written by another player on this device is
    // not ours to resume, however recent it is.
    if (rec.playerId !== playerId) return null;
    // Run it through the same parsers the wire uses: a stale or half-written
    // record is refused rather than resumed as a corrupt half-state.
    const config = parseMatchConfig(rec.config);
    const state = parseRunState(rec.state);
    if (!config || !state || config.roomCode !== roomCode) return null;
    const updatedAt = typeof rec.updatedAt === "number" && Number.isFinite(rec.updatedAt) ? rec.updatedAt : 0;
    return { playerId, config, state, updatedAt };
  } catch {
    return null;
  }
}

export function saveMatch(roomCode: string, playerId: string, config: MatchConfig, state: RunState): void {
  const store = storage();
  if (!store || !isRoomCode(roomCode) || !playerId) return;
  let body: string;
  try {
    // The journal is dropped on the way in: `loadMatch` reads this record back
    // through `parseRunState`, which rebuilds `RunState` field by field and cannot
    // return it. Writing it would spend bytes — several KB on a long run — in a
    // store that already evicts rooms to make room, for something nothing can read.
    const rec: MatchRecord = { playerId, config, state: { ...state, journal: undefined }, updatedAt: Date.now() };
    body = JSON.stringify(rec);
  } catch {
    return;
  }
  // A full store is the failure that matters. Swallowing it means the write never
  // lands again for the rest of the match — and a match that never persists is a
  // rejoin that silently restarts the life from the seed. So make room and retry
  // rather than drop the write; `dropOldest` runs out of rooms, so this ends.
  for (;;) {
    try {
      store.setItem(keyFor(roomCode), body);
      evict(store, roomCode);
      return;
    } catch {
      if (!dropOldest(store, roomCode)) return;
    }
  }
}

export function clearMatch(roomCode: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(keyFor(roomCode));
  } catch {}
}

/** Every room this device still holds, newest first. */
export function listMatches(): RecentRoom[] {
  const store = storage();
  if (!store) return [];
  const out: RecentRoom[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key || !key.startsWith(PREFIX)) continue;
      const roomCode = key.slice(PREFIX.length);
      // The two bookkeeping keys share the namespace and are not rooms.
      if (!isRoomCode(roomCode)) continue;
      let updatedAt = 0;
      let ended = false;
      try {
        const rec = JSON.parse(store.getItem(key) ?? "null") as
          | { updatedAt?: unknown; state?: { status?: unknown } | null }
          | null;
        if (rec && typeof rec.updatedAt === "number" && Number.isFinite(rec.updatedAt)) updatedAt = rec.updatedAt;
        // Read straight off the stored run: a finished life is not something the
        // player can be sitting in, so it must not warn them off starting a new one.
        if (rec && rec.state && rec.state.status === "ended") ended = true;
      } catch {}
      out.push({ roomCode, updatedAt, ended });
    }
  } catch {
    return [];
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Note that this device is in a room, before there is any life to store. */
export function rememberRoom(roomCode: string): void {
  const store = storage();
  if (!store || !isRoomCode(roomCode)) return;
  try {
    store.setItem(RECENT_KEY, JSON.stringify({ roomCode, updatedAt: Date.now() }));
    // Entering a room again is the player disagreeing with an earlier dismissal.
    if (store.getItem(DISMISSED_KEY) === roomCode) store.removeItem(DISMISSED_KEY);
  } catch {
    /* full or blocked store — the code entry is still there */
  }
}

/**
 * Remember what to call this player next time.
 *
 * The running-match rejoin takes a returning player's name off the frozen roster,
 * which is wire-authoritative. A LOBBY has no frozen roster and presence is
 * self-authored, so a player who reloads out of one has nothing to take their name
 * back from: they land on an empty Setup field, rejoin as the anonymous default,
 * and the rest of the match is played as "PLAYER" in every rail and on the podium.
 * This device's own memory is the only source left.
 *
 * Written when a name is COMMITTED — a run starts, a room is opened or joined —
 * never per keystroke, so a half-typed name is never what comes back. Guests
 * included: none of this depends on being signed in.
 *
 * The anonymous fallback is not a name. Storing it would prefill the field with
 * "PLAYER" for somebody who never typed anything, which reads as a choice they
 * made rather than the placeholder it is.
 */
export function rememberPlayerName(name: string): void {
  const store = storage();
  if (!store) return;
  const clean = name.trim().slice(0, MAX_NAME);
  try {
    if (!clean || clean === DEFAULT_PLAYER_NAME) store.removeItem(NAME_KEY);
    else store.setItem(NAME_KEY, clean);
  } catch {
    /* full or blocked store — the field just starts empty, as it always did */
  }
}

/** What this device last called itself, or "" when it has never said. */
export function lastPlayerName(): string {
  const store = storage();
  if (!store) return "";
  try {
    return (store.getItem(NAME_KEY) ?? "").trim().slice(0, MAX_NAME);
  } catch {
    return "";
  }
}

/**
 * Stop offering a room as a way back. Called when the room proved to be gone.
 * Deliberately NOT `clearMatch`: a handshake can fail for a room that is still
 * alive, and the record is the player's own ledger — losing it would resume them
 * into a seed-rebuilt life instead of the one they played.
 */
export function dismissRoom(roomCode: string): void {
  const store = storage();
  if (!store || !isRoomCode(roomCode)) return;
  try {
    store.setItem(DISMISSED_KEY, roomCode);
  } catch {}
}

/**
 * Stop offering a room the player deliberately WALKED OUT of.
 *
 * `rememberRoom` marks the newest room this device entered, and that marker
 * outranks every stored life — so opening a second room and leaving it again
 * replaced the offer with the empty room just abandoned, while the match this
 * device is still seated in (and still being ghost-played in) fell off the
 * screen entirely, leaving no route back but a code somebody else has to read
 * out. Only the marker goes: the stored life is the player's own ledger and
 * `listMatches` still offers it, which is the whole point.
 */
export function forgetRoom(roomCode: string): void {
  const store = storage();
  if (!store || !isRoomCode(roomCode)) return;
  try {
    const raw = JSON.parse(store.getItem(RECENT_KEY) ?? "null") as { roomCode?: unknown } | null;
    if (raw && raw.roomCode === roomCode) store.removeItem(RECENT_KEY);
  } catch {
    /* unreadable marker — nothing to withdraw */
  }
}

/**
 * The one room worth offering as a way back in, or null. The newest of "a room we
 * hold a life in" and "a room we entered", inside the rejoin window, minus one the
 * player has already been told is gone.
 */
export function recentRoom(): RecentRoom | null {
  const store = storage();
  if (!store) return null;
  let out: RecentRoom | null = listMatches()[0] ?? null;
  try {
    const raw = JSON.parse(store.getItem(RECENT_KEY) ?? "null") as
      | { roomCode?: unknown; updatedAt?: unknown }
      | null;
    const code = typeof raw?.roomCode === "string" ? raw.roomCode : null;
    const at = typeof raw?.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0;
    if (code && isRoomCode(code) && (!out || at > out.updatedAt)) {
      // A room we only entered holds no life yet, so there is none to call over —
      // unless it is the same room the record above is about.
      out = { roomCode: code, updatedAt: at, ended: out?.roomCode === code ? out.ended : false };
    }
  } catch {
    /* unreadable marker — the record above still stands */
  }
  if (!out || Date.now() - out.updatedAt >= REJOIN_WINDOW_MS) return null;
  try {
    if (store.getItem(DISMISSED_KEY) === out.roomCode) return null;
  } catch {}
  return out;
}

/**
 * Free the least recently written OTHER room. False when there is none left to
 * give — the store is full of something that isn't ours, and the caller gives up.
 */
function dropOldest(store: Storage, keep: string): boolean {
  const others = listMatches().filter((r) => r.roomCode !== keep);
  const oldest = others[others.length - 1];
  if (!oldest) return false;
  try {
    store.removeItem(keyFor(oldest.roomCode));
  } catch {
    return false;
  }
  return true;
}

/** Keep the newest MAX_ROOMS, never dropping the room being written right now. */
function evict(store: Storage, keep: string): void {
  const rooms = listMatches();
  if (rooms.length <= MAX_ROOMS) return;
  for (const room of rooms.slice(MAX_ROOMS)) {
    if (room.roomCode === keep) continue;
    try {
      store.removeItem(keyFor(room.roomCode));
    } catch {}
  }
}
