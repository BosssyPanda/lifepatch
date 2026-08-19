import type { SupabaseClient } from "@supabase/supabase-js";
import { isCloud, supabase } from "@/lib/supabase";
import { channelName, MP_EVENT, presenceKey } from "./protocol";

/**
 * The room's pipe, and the only place multiplayer touches the network.
 *
 * Two implementations, one shape: Supabase Realtime for real rooms, and a
 * `BroadcastChannel` stand-in so a developer can open two tabs on one machine and
 * play a whole match with no cloud project at all. Everything above this file
 * (the hook, the UI) is written against `MatchTransport` and cannot tell which
 * one it got — which is also what makes the protocol testable.
 *
 * Payloads are `unknown` on purpose: nothing here trusts, parses or reshapes a
 * message. Validation is `lib/mp/protocol.ts`'s job, once, at the other end.
 */
export type MatchTransport = {
  join(room: string, presence: unknown): Promise<void>;
  leave(): Promise<void>;
  /** Broadcast to the room. Fire-and-forget — the game never blocks on the wire. */
  send(msg: unknown): void;
  updatePresence(p: unknown): void;
  onMessage(cb: (msg: unknown) => void): () => void;
  onPresence(cb: (members: unknown[]) => void): () => void;
};

/** Derived rather than imported: supabase-js doesn't re-export the channel type. */
type Channel = ReturnType<SupabaseClient["channel"]>;

type Emitter<T> = { add(cb: (v: T) => void): () => void; emit(v: T): void; clear(): void };

function emitter<T>(): Emitter<T> {
  const subs = new Set<(v: T) => void>();
  return {
    add(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    emit(v) {
      for (const cb of [...subs]) {
        try {
          cb(v);
        } catch {}
      }
    },
    clear() {
      subs.clear();
    },
  };
}

function nonce(): string {
  return Math.random().toString(36).slice(2, 10);
}

function playerIdOf(presence: unknown): string {
  if (typeof presence === "object" && presence !== null) {
    const id = (presence as { playerId?: unknown }).playerId;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return "anon";
}

// ── Supabase Realtime ───────────────────────────────────────────────────────

/**
 * Real rooms. `broadcast.self: false` because a client already knows what it
 * sent, and the presence key carries a per-tab nonce so two tabs on one device
 * are two connections rather than one flickering row (the UI dedupes by
 * `playerId`).
 */
export function createSupabaseTransport(): MatchTransport | null {
  if (!isCloud || !supabase) return null;
  const client = supabase;
  const tabNonce = nonce();
  const messages = emitter<unknown>();
  const presences = emitter<unknown[]>();
  let channel: Channel | null = null;
  let mine: unknown = null;

  function members(ch: Channel): unknown[] {
    const state = ch.presenceState<Record<string, unknown>>();
    return Object.values(state).flat();
  }

  async function leave(): Promise<void> {
    const ch = channel;
    channel = null;
    if (!ch) return;
    try {
      await client.removeChannel(ch);
    } catch {}
  }

  return {
    async join(room, presence) {
      await leave();
      mine = presence;
      const ch = client.channel(channelName(room), {
        config: {
          broadcast: { self: false },
          presence: { key: presenceKey(playerIdOf(presence), tabNonce), enabled: true },
        },
      });
      ch.on("broadcast", { event: MP_EVENT }, (payload) => messages.emit(payload.payload));
      ch.on("presence", { event: "sync" }, () => presences.emit(members(ch)));
      channel = ch;
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        ch.subscribe((status, err) => {
          if (status === "SUBSCRIBED") {
            // Re-tracked on every SUBSCRIBED, not just the first: a reconnect
            // drops presence, and a player who silently vanished from the room's
            // roster after a wifi blip would be ghost-played while sitting there.
            void ch.track(mine as Record<string, unknown>).catch(() => {});
            if (!settled) {
              settled = true;
              resolve();
            }
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            if (!settled) {
              settled = true;
              reject(err ?? new Error(`Realtime channel ${status.toLowerCase()}`));
            }
          }
        });
      });
    },
    leave,
    send(msg) {
      void channel?.send({ type: "broadcast", event: MP_EVENT, payload: msg })?.catch?.(() => {});
    },
    updatePresence(p) {
      mine = p;
      void channel?.track(p as Record<string, unknown>).catch(() => {});
    },
    onMessage: messages.add,
    onPresence: presences.add,
  };
}

// ── Same-device BroadcastChannel ────────────────────────────────────────────

/** How often we announce ourselves, and how long a silent tab stays in the room. */
const HEARTBEAT_MS = 1200;
const PRESENCE_STALE_MS = 4500;

type LocalEnvelope =
  | { kind: "msg"; from: string; body: unknown }
  | { kind: "presence"; from: string; body: unknown }
  | { kind: "hello"; from: string }
  | { kind: "bye"; from: string };

/**
 * The dev room: two tabs, one machine, no cloud project.
 *
 * `BroadcastChannel` already declines to echo a message back to the sender, so it
 * matches `broadcast.self: false` for free. Presence is hand-rolled — every tab
 * re-announces itself on a heartbeat and is pruned when it goes quiet, which is
 * also what makes disconnect/ghost-play testable locally: close the tab and watch
 * the row go grey.
 */
export function createLocalTransport(): MatchTransport | null {
  if (typeof BroadcastChannel === "undefined") return null;
  const self = nonce();
  const messages = emitter<unknown>();
  const presences = emitter<unknown[]>();
  const seen = new Map<string, { body: unknown; at: number }>();
  let bc: BroadcastChannel | null = null;
  let beat: ReturnType<typeof setInterval> | null = null;
  let mine: unknown = null;

  function post(env: LocalEnvelope) {
    try {
      bc?.postMessage(env);
    } catch {}
  }

  function emitMembers() {
    presences.emit([...seen.values()].map((m) => m.body));
  }

  function announce() {
    seen.set(self, { body: mine, at: Date.now() });
    post({ kind: "presence", from: self, body: mine });
    const cutoff = Date.now() - PRESENCE_STALE_MS;
    let dropped = false;
    for (const [key, m] of seen) {
      if (key !== self && m.at < cutoff) {
        seen.delete(key);
        dropped = true;
      }
    }
    if (dropped) emitMembers();
  }

  async function leave(): Promise<void> {
    if (beat !== null) clearInterval(beat);
    beat = null;
    if (bc) {
      post({ kind: "bye", from: self });
      try {
        bc.close();
      } catch {}
    }
    bc = null;
    seen.clear();
  }

  return {
    async join(room, presence) {
      await leave();
      mine = presence;
      const ch = new BroadcastChannel(channelName(room));
      ch.onmessage = (e: MessageEvent<LocalEnvelope>) => {
        const env = e.data;
        if (!env || typeof env !== "object" || env.from === self) return;
        if (env.kind === "msg") {
          messages.emit(env.body);
          return;
        }
        if (env.kind === "hello") {
          // Someone just arrived: answer immediately instead of making them wait
          // out a heartbeat to see the room.
          post({ kind: "presence", from: self, body: mine });
          return;
        }
        if (env.kind === "presence") {
          seen.set(env.from, { body: env.body, at: Date.now() });
          emitMembers();
          return;
        }
        if (env.kind === "bye") {
          if (seen.delete(env.from)) emitMembers();
        }
      };
      bc = ch;
      seen.set(self, { body: mine, at: Date.now() });
      post({ kind: "hello", from: self });
      post({ kind: "presence", from: self, body: mine });
      beat = setInterval(announce, HEARTBEAT_MS);
      emitMembers();
    },
    leave,
    send(msg) {
      post({ kind: "msg", from: self, body: msg });
    },
    updatePresence(p) {
      mine = p;
      seen.set(self, { body: p, at: Date.now() });
      post({ kind: "presence", from: self, body: p });
      emitMembers();
    },
    onMessage: messages.add,
    onPresence: presences.add,
  };
}

/**
 * Is the same-device transport switched on? `NEXT_PUBLIC_MP_LOCAL=1` forces it
 * (that is the whole point of the flag — testing two tabs without a cloud
 * project), and `next dev` gets it as a fallback when no Supabase keys are set.
 */
export function isLocalTransportEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MP_LOCAL === "1" || process.env.NODE_ENV === "development";
}

/**
 * The one the app calls. `null` means "this build has no way to reach other
 * players" — the entry panel renders its disabled state instead of a broken
 * Create-room button.
 */
export function createTransport(): MatchTransport | null {
  if (process.env.NEXT_PUBLIC_MP_LOCAL === "1") return createLocalTransport();
  const cloud = createSupabaseTransport();
  if (cloud) return cloud;
  return isLocalTransportEnabled() ? createLocalTransport() : null;
}
