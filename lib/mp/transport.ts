import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
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
  /**
   * Is the room actually reachable right now?
   *
   * The one thing this layer knows and nothing above it could work out. Without
   * it a client whose socket died went on simulating years in perfect silence:
   * every broadcast it sent fell on the floor, every tick it never received left
   * its own fallback clock to invent one, and the room — hearing nothing — wrote
   * it off as away and auto-played its life. The player saw a game running
   * normally right up until the standings snapped to a run they had not played.
   *
   * Emitted on change only, and `"online"` is re-emitted after every recovery so
   * the hook can re-announce itself into a room that has moved on without it.
   */
  onConnection(cb: (state: ConnectionState) => void): () => void;
};

/** Reachable, or not. There is no third state the game does anything different for. */
export type ConnectionState = "online" | "offline";

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Supabase Realtime ───────────────────────────────────────────────────────

/** Reconnect backoff, and the ceiling it climbs to. Jittered so a Realtime
 *  restart doesn't bring every client in a room back in the same millisecond. */
function backoff(attempt: number): number {
  const base = Math.min(500 * 2 ** Math.min(attempt, 4), 8000);
  return base + Math.floor(Math.random() * 250);
}

/**
 * How long `join` keeps retrying before it gives up and tells the player.
 *
 * A phone switching cell towers, or a laptop waking onto wifi, fails the first
 * websocket handshake and succeeds on the next — so rejecting on the first error
 * turned "join a room" into a button you press two or three times. Long enough to
 * ride that out, short enough that a genuinely dead project still says so.
 */
const JOIN_DEADLINE_MS = 12000;

/**
 * How long we let supabase-js retry a broken channel on its own before forcing a
 * fresh one. A `CHANNEL_ERROR` or `TIMED_OUT` leaves the channel in phoenix's
 * `errored` state with its own rejoin timer, and that usually recovers; when it
 * doesn't, nothing else ever will, so the channel is rebuilt from scratch.
 */
const RECOVER_MS = 10000;

/**
 * Real rooms. `broadcast.self: false` because a client already knows what it
 * sent, and the presence key carries a per-tab nonce so two tabs on one device
 * are two connections rather than one flickering row (the UI dedupes by
 * `playerId`).
 */
export function createSupabaseTransport(injected?: SupabaseClient | null): MatchTransport | null {
  /**
   * `injected` exists so this file can be tested, and it is worth saying why that
   * needed a parameter at all. Everything here reacts to supabase-js CALLING BACK —
   * a status arriving after a teardown is the whole subject of the guard in
   * `open` — and none of that is reachable through the public surface without a
   * live websocket. `npm run qa:mp` needs one, which means the reconnect path was
   * only ever exercised where `wss://` works, and a re-entrancy bug lived in it for
   * as long as it did precisely because nothing could reach it.
   *
   * `scripts/qa/mp-transport.mjs` passes a stub that answers `channel` and
   * `removeChannel` with the real library's ordering and no socket. The app never
   * passes anything, so production takes the same `supabase` it always did.
   */
  const resolved = injected ?? supabase;
  if (!resolved) return null;
  // Annotated rather than inferred: the guard above narrows `resolved`, but the
  // callbacks below are closures and TypeScript will not carry a narrowing into
  // one. Same shape the `isCloud` check used to have, for the same reason.
  const client: SupabaseClient = resolved;
  const tabNonce = nonce();
  const messages = emitter<unknown>();
  const presences = emitter<unknown[]>();
  const connections = emitter<ConnectionState>();
  let channel: Channel | null = null;
  let mine: unknown = null;
  let room: string | null = null;
  /**
   * Which join attempt is the live one.
   *
   * Every timer, promise and channel callback below captures the generation it
   * was made in and bails when it no longer matches. `leave()` bumps it, so a
   * reconnect already in flight when the player walks out cannot resurrect the
   * room a second later — which is exactly the kind of bug a retry loop adds if
   * it has no way to be cancelled.
   */
  let gen = 0;
  let state: ConnectionState = "offline";
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;

  function setState(next: ConnectionState) {
    if (state === next) return;
    state = next;
    connections.emit(next);
  }

  function clearTimers() {
    if (retryTimer !== null) clearTimeout(retryTimer);
    if (watchdog !== null) clearTimeout(watchdog);
    retryTimer = null;
    watchdog = null;
  }

  function members(ch: Channel): unknown[] {
    const state = ch.presenceState<Record<string, unknown>>();
    return Object.values(state).flat();
  }

  /** Drop a channel we are done with, whatever state it is in. */
  async function discard(ch: Channel | null): Promise<void> {
    if (!ch) return;
    try {
      await client.removeChannel(ch);
    } catch {}
  }

  /**
   * One attempt at a live channel. Resolves on the first `SUBSCRIBED`; rejects if
   * that never comes. The callback stays installed afterwards and becomes the
   * room's connection monitor — supabase-js re-invokes it for the whole life of
   * the channel, which is what lets a drop be noticed at all.
   */
  function open(myGen: number, topic: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const ch = client.channel(channelName(topic), {
        config: {
          broadcast: { self: false },
          presence: { key: presenceKey(playerIdOf(mine), tabNonce), enabled: true },
        },
      });
      ch.on("broadcast", { event: MP_EVENT }, (payload) => {
        if (myGen === gen) messages.emit(payload.payload);
      });
      ch.on("presence", { event: "sync" }, () => {
        if (myGen === gen) presences.emit(members(ch));
      });
      channel = ch;
      ch.subscribe((status, err) => {
        /**
         * A channel we have already thrown away does not get to steer the room.
         *
         * `removeChannel` calls `unsubscribe`, and supabase-js answers a close by
         * invoking THIS callback with `CLOSED` — see `RealtimeChannel`'s
         * `_onClose(() => callback?.("CLOSED"))`. So every `discard` below arrives
         * back here looking exactly like a live socket dropping, and the generation
         * counter cannot tell them apart: `leave` bumps it, but `reopen` does not,
         * because a reconnect is the SAME join still in progress.
         *
         * Identity is what separates them, and every discard site nulls `channel`
         * before awaiting the removal, so `channel !== ch` means "we let this one
         * go" and nothing else.
         *
         * WITHOUT THIS GUARD ONE TRANSIENT ERROR NEVER STOPPED. `reopen`'s own
         * `discard` re-entered here as `CLOSED`, which called `reopen` again and
         * armed a second retry; the first retry then built a healthy channel and
         * cleared `attempts`, and the second woke up and discarded that healthy
         * channel — which re-entered here again. The room dropped and recovered
         * about once a second for as long as the tab was open: peers flickering to
         * "away", broadcasts landing on a channel already being torn down, and
         * `attempts` reset on every cycle so the backoff never got a chance to grow
         * out of it.
         */
        if (myGen !== gen || channel !== ch) {
          // Nothing is going to settle this one — `join` and `reopen` both await
          // `open`, and an awaiter of a channel nobody owns any more would wait for
          // the life of the tab. Their `myGen` checks turn this into the no-op it
          // should be; a stale channel losing a race to a newer one retries.
          if (!settled) {
            settled = true;
            reject(err ?? new Error("Realtime channel discarded before it went live"));
          }
          return;
        }
        if (status === "SUBSCRIBED") {
          attempts = 0;
          if (watchdog !== null) clearTimeout(watchdog);
          watchdog = null;
          // Re-tracked on every SUBSCRIBED, not just the first: a reconnect
          // drops presence, and a player who silently vanished from the room's
          // roster after a wifi blip would be ghost-played while sitting there.
          void ch.track(mine as Record<string, unknown>).catch(() => {});
          setState("online");
          if (!settled) {
            settled = true;
            resolve();
          }
          return;
        }
        if (status !== "CHANNEL_ERROR" && status !== "TIMED_OUT" && status !== "CLOSED") return;
        setState("offline");
        if (!settled) {
          settled = true;
          reject(err ?? new Error(`Realtime channel ${status.toLowerCase()}`));
          return;
        }
        // Past the first join, so this is a live room dropping out from under a
        // player. `CLOSED` is the one that cannot heal itself: phoenix removes a
        // closed channel from the socket, so its rejoin timer will never fire
        // again and the room is gone for good unless we build a new one. The
        // other two leave the channel `errored` with a rejoin timer still
        // running, so they get a chance to recover before we intervene.
        if (status === "CLOSED") reopen();
        else armWatchdog();
      });
    });
  }

  /** Give supabase-js its own retry a fair run, then rebuild if it didn't work. */
  function armWatchdog() {
    if (watchdog !== null) return;
    const myGen = gen;
    watchdog = setTimeout(() => {
      watchdog = null;
      if (myGen !== gen || state === "online") return;
      reopen();
    }, RECOVER_MS);
  }

  /** Throw the channel away and build a fresh one, backing off between tries. */
  function reopen() {
    if (retryTimer !== null) return;
    const myGen = gen;
    if (!room) return;
    const here = room;
    retryTimer = setTimeout(async () => {
      retryTimer = null;
      if (myGen !== gen || room !== here) return;
      const dead = channel;
      channel = null;
      await discard(dead);
      if (myGen !== gen || room !== here) return;
      try {
        await open(myGen, here);
      } catch {
        if (myGen === gen) reopen();
      }
    }, backoff(attempts++));
  }

  async function leave(): Promise<void> {
    gen++;
    clearTimers();
    attempts = 0;
    const ch = channel;
    channel = null;
    room = null;
    mine = null;
    setState("offline");
    await discard(ch);
  }

  return {
    async join(r, presence) {
      await leave();
      const myGen = gen;
      room = r;
      mine = presence;
      const deadline = Date.now() + JOIN_DEADLINE_MS;
      let last: unknown = null;
      for (;;) {
        try {
          await open(myGen, r);
          return;
        } catch (e) {
          last = e;
          if (myGen !== gen) return; // the player left while we were trying
          const dead = channel;
          channel = null;
          await discard(dead);
          if (myGen !== gen) return;
          if (Date.now() >= deadline) break;
          await sleep(backoff(attempts++));
          if (myGen !== gen) return;
        }
      }
      // The player is looking at this string, so it says what to do rather than
      // what the socket called it. The underlying reason is kept as the cause.
      throw new Error("Couldn't reach the room — check your connection and try again.", { cause: last });
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
    onConnection: connections.add,
  };
}

// ── Same-device BroadcastChannel ────────────────────────────────────────────

/** How often we announce ourselves. */
const HEARTBEAT_MS = 1200;
/**
 * How long a silent tab stays in the room.
 *
 * Far longer than the heartbeat, and deliberately so. A background tab's
 * `setInterval` is throttled by the browser to roughly once a minute, and the
 * background tab is precisely the one this transport exists to test with — so a
 * window measured in seconds pruned the tab you were not looking at, handed it to
 * the host to ghost-play, and made every local two-tab test look like a
 * connection bug. A tab that closes politely says `bye` (including on
 * `pagehide`), so this timeout is only ever the fallback for a hard kill.
 */
const PRESENCE_STALE_MS = 90000;

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
  const connections = emitter<ConnectionState>();
  const seen = new Map<string, { body: unknown; at: number }>();
  let bc: BroadcastChannel | null = null;
  let beat: ReturnType<typeof setInterval> | null = null;
  let mine: unknown = null;
  let detach: (() => void) | null = null;

  function post(env: LocalEnvelope) {
    try {
      bc?.postMessage(env);
    } catch {}
  }

  function emitMembers() {
    presences.emit([...seen.values()].map((m) => m.body));
  }

  function announce() {
    if (!bc) return;
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
    detach?.();
    detach = null;
    const was = bc !== null;
    if (bc) {
      post({ kind: "bye", from: self });
      try {
        bc.close();
      } catch {}
    }
    bc = null;
    seen.clear();
    if (was) connections.emit("offline");
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
      // A tab coming back to the foreground has been throttled to roughly one
      // heartbeat a minute, so it re-announces at once rather than letting the
      // other tab wonder about it for another interval. `pagehide` is the polite
      // goodbye a hard close never sends — without it the only way out of the
      // room is the stale timeout above.
      if (typeof document !== "undefined") {
        const onVisible = () => {
          if (document.visibilityState === "visible") announce();
        };
        const onHide = () => post({ kind: "bye", from: self });
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("pagehide", onHide);
        detach = () => {
          document.removeEventListener("visibilitychange", onVisible);
          window.removeEventListener("pagehide", onHide);
        };
      }
      emitMembers();
      connections.emit("online");
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
    onConnection: connections.add,
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
