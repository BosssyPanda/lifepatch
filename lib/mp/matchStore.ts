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
  config: MatchConfig;
  state: RunState;
  updatedAt: number;
};

const PREFIX = "lifepatch.mp.";
/** Three rooms is more history than anyone rejoins; the oldest is evicted. */
const MAX_ROOMS = 3;

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

export function loadMatch(roomCode: string): MatchRecord | null {
  const store = storage();
  if (!store || !isRoomCode(roomCode)) return null;
  try {
    const raw = store.getItem(keyFor(roomCode));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const rec = parsed as Record<string, unknown>;
    // Run it through the same parsers the wire uses: a stale or half-written
    // record is refused rather than resumed as a corrupt half-state.
    const config = parseMatchConfig(rec.config);
    const state = parseRunState(rec.state);
    if (!config || !state || config.roomCode !== roomCode) return null;
    const updatedAt = typeof rec.updatedAt === "number" && Number.isFinite(rec.updatedAt) ? rec.updatedAt : 0;
    return { config, state, updatedAt };
  } catch {
    return null;
  }
}

export function saveMatch(roomCode: string, config: MatchConfig, state: RunState): void {
  const store = storage();
  if (!store || !isRoomCode(roomCode)) return;
  let body: string;
  try {
    const rec: MatchRecord = { config, state, updatedAt: Date.now() };
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
export function listMatches(): { roomCode: string; updatedAt: number }[] {
  const store = storage();
  if (!store) return [];
  const out: { roomCode: string; updatedAt: number }[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key || !key.startsWith(PREFIX)) continue;
      const roomCode = key.slice(PREFIX.length);
      let updatedAt = 0;
      try {
        const rec = JSON.parse(store.getItem(key) ?? "null") as { updatedAt?: unknown } | null;
        if (rec && typeof rec.updatedAt === "number" && Number.isFinite(rec.updatedAt)) updatedAt = rec.updatedAt;
      } catch {}
      out.push({ roomCode, updatedAt });
    }
  } catch {
    return [];
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
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
