// The room's pipe, driven without a room.
//
//   node scripts/qa/mp-transport.mjs
//
// WHY THIS EXISTS, given `mp-room.mjs` already plays whole matches.
//
// That gate needs a websocket. Everything interesting in `lib/mp/transport.ts`
// happens when supabase-js CALLS BACK — a status arriving after we tore a channel
// down, a drop landing while a retry is already in flight — and none of it is
// reachable from above without a live `wss://`. So the reconnect path was only ever
// exercised where one could be opened, and a re-entrancy bug lived in it for as long
// as it did precisely because nothing here could reach it: on a runner behind a
// proxy that blocks websockets, `qa:mp` fails identically on a clean tree, which
// means it reports on the environment rather than on the code.
//
// This gate takes the other half. `createSupabaseTransport` accepts a client, and
// the stub below answers `channel` and `removeChannel` with the real library's
// ordering and no socket at all — so the callbacks arrive in the same sequence and
// nothing has to be reachable over the network. It runs anywhere Node runs.
//
// THE STUB SERVER IS ALWAYS HEALTHY. Every channel it hands out subscribes
// successfully on the next tick. That is the whole point: after one deliberate
// blip, any further channel churn is the CLIENT's own doing, and counting channels
// is enough to tell a recovery from a loop.
import { readFileSync } from "fs";
import { createRequire } from "module";
import { engineDir } from "./build-engine.mjs";

const OUT = engineDir();
const require = createRequire(`${OUT}/`);
const { createSupabaseTransport } = require(`${OUT}/lib/mp/transport.js`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let checks = 0;
let failures = 0;

async function check(name, fn) {
  checks++;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
}

function eq(a, b, what) {
  if (!Object.is(a, b)) throw new Error(`${what}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

function ok(cond, what) {
  if (!cond) throw new Error(what);
}

/**
 * A Supabase client with no socket.
 *
 * The one behaviour worth getting exactly right is the teardown, because it is the
 * subject of the bug this gate was written for: `removeChannel` awaits
 * `channel.unsubscribe()`, and supabase-js answers a close by invoking the
 * SUBSCRIBE CALLBACK with `CLOSED` — `RealtimeChannel` binds
 * `_onClose(() => callback?.("CLOSED"))`. Tearing a channel down therefore looks,
 * from inside the transport, exactly like a live socket dropping. Reproduced here
 * verbatim; a stub that quietly skipped it would pass either version of the code.
 */
function stubClient({ autoSubscribe = true } = {}) {
  const created = [];
  const client = {
    channel(name, opts) {
      const ch = {
        name,
        opts,
        removed: false,
        cb: null,
        sent: [],
        tracked: [],
        listeners: [],
        presence: {},
        on(type, filter, handler) {
          this.listeners.push({ type, filter, handler });
          return this;
        },
        subscribe(cb) {
          this.cb = cb;
          return this;
        },
        async track(p) {
          this.tracked.push(p);
          return "ok";
        },
        async send(msg) {
          this.sent.push(msg);
          return "ok";
        },
        presenceState() {
          return this.presence;
        },
        /** Test driver: what the server would say. */
        emit(status, err) {
          this.cb?.(status, err);
        },
        /** Test driver: deliver a broadcast / presence sync to whoever registered. */
        deliver(type, payload) {
          for (const l of this.listeners) if (l.type === type) l.handler(payload);
        },
      };
      created.push(ch);
      // A healthy server accepts on the next tick.
      if (autoSubscribe) setTimeout(() => { if (!ch.removed) ch.emit("SUBSCRIBED"); }, 0);
      return ch;
    },
    async removeChannel(ch) {
      if (!ch.removed) {
        ch.removed = true;
        ch.emit("CLOSED"); // ← the re-entry the transport has to survive
      }
      return "ok";
    },
  };
  return { client, created };
}

/** Join a room and wait until the stub has accepted it. */
async function joined(opts) {
  const { client, created } = stubClient(opts);
  const t = createSupabaseTransport(client);
  ok(t !== null, "createSupabaseTransport returned null for a supplied client");
  const states = [];
  t.onConnection((s) => states.push(s));
  await t.join("ROOM", { playerId: "p1", name: "Ada" });
  return { t, client, created, states };
}

console.log("TRANSPORT — the reconnect path, with no websocket in sight\n");

await check("no client, no transport (the isCloud contract, unchanged)", () => {
  eq(createSupabaseTransport(null), null, "null client");
});

await check("a join reaches online and tracks presence", async () => {
  const { created, states } = await joined();
  eq(created.length, 1, "channels built");
  eq(states.at(-1), "online", "connection state");
  eq(created[0].tracked.length, 1, "presence tracked on SUBSCRIBED");
});

// ─────────────────────────────────────────────────────────────────────────────
// The bug this file was written for.
//
// A live channel closes. `reopen` waits out its backoff, nulls `channel`, and
// discards the dead one — which re-enters the dead channel's own subscribe callback
// with `CLOSED`. Without an identity guard that second `CLOSED` looked like another
// live drop (the generation counter cannot tell them apart, because a reconnect is
// the same join still in progress), so it armed a SECOND retry. The first retry then
// built a healthy channel and reset `attempts`; the second woke up and discarded
// that healthy channel, which re-entered again. The room dropped and recovered about
// once a second for as long as the tab stayed open.
//
// Counting channels is the assertion, because the count is what a player feels: two
// is "it blipped and came back", and anything that keeps climbing is the loop.
// ─────────────────────────────────────────────────────────────────────────────
await check("one drop costs exactly one rebuild, and the room stays up", async () => {
  const { created, states } = await joined();
  created[0].emit("CLOSED"); // the socket really did go
  await sleep(4000); // several cycles of the old ~500ms–1s loop
  eq(created.length, 2, "channels built after one drop (>2 is the reconnect loop)");
  eq(states.at(-1), "online", "connection state after recovery");
  eq(created[1].removed, false, "the recovered channel was left alone");
  ok(created[1].tracked.length >= 1, "re-tracked into the room it rejoined");
});

await check("the loop does not start from a mid-flight drop either", async () => {
  const { created } = await joined();
  created[0].emit("CLOSED");
  await sleep(900); // land inside the first retry
  created.at(-1)?.emit("CLOSED"); // and drop again while it settles
  await sleep(4000);
  ok(created.length <= 3, `two drops built ${created.length} channels, expected at most 3`);
});

await check("CHANNEL_ERROR waits for supabase-js's own retry before rebuilding", async () => {
  const { created, states } = await joined();
  created[0].emit("CHANNEL_ERROR", new Error("transient"));
  eq(states.at(-1), "offline", "reports the drop immediately");
  await sleep(600);
  eq(created.length, 1, "did not rebuild inside the recovery window");
});

await check("a recovery re-announces the player (the ghost-play guard)", async () => {
  const { created } = await joined();
  created[0].emit("CLOSED");
  await sleep(1500);
  eq(created.length, 2, "rebuilt once");
  ok(created[1].tracked.length >= 1, "tracked presence on the new channel");
});

// ─────────────────────────────────────────────────────────────────────────────
// Leaving while a join is still in the air.
//
// `leave` bumps the generation, so the in-flight channel's callback correctly stops
// steering the room — but it also stopped SETTLING the promise `join` was awaiting,
// and a caller that awaits `joinRoom` would have waited for the life of the tab.
// ─────────────────────────────────────────────────────────────────────────────
await check("leaving mid-join settles the join rather than hanging it", async () => {
  const { client } = stubClient({ autoSubscribe: false });
  const t = createSupabaseTransport(client);
  let settled = false;
  const join = t.join("ROOM", { playerId: "p1" }).then(() => { settled = true; }, () => { settled = true; });
  await sleep(20);
  await t.leave();
  await Promise.race([join, sleep(2000)]);
  ok(settled, "join never settled after leave()");
});

await check("leave tears the channel down and goes offline", async () => {
  const { t, created, states } = await joined();
  await t.leave();
  eq(created[0].removed, true, "channel removed");
  eq(states.at(-1), "offline", "connection state");
});

// ── The ordinary traffic still flows ─────────────────────────────────────────

await check("send, presence and inbound messages still work", async () => {
  const { t, created } = await joined();
  const got = [];
  t.onMessage((m) => got.push(m));
  t.send({ t: "status", hello: 1 });
  eq(created[0].sent.length, 1, "broadcast reached the channel");
  eq(created[0].sent[0].payload.hello, 1, "payload");

  t.updatePresence({ playerId: "p1", name: "Ada", year: 4 });
  eq(created[0].tracked.at(-1).year, 4, "presence updated");

  created[0].deliver("broadcast", { payload: { t: "snapshot", n: 7 } });
  eq(got.length, 1, "inbound message delivered");
  eq(got[0].n, 7, "inbound payload");
});

await check("a discarded channel's traffic is ignored", async () => {
  const { t, created } = await joined();
  const got = [];
  t.onMessage((m) => got.push(m));
  const stale = created[0];
  await t.leave();
  stale.deliver("broadcast", { payload: { t: "status", n: 1 } });
  eq(got.length, 0, "a channel we left still reached the room");
});

// ─────────────────────────────────────────────────────────────────────────────
// One invariant about the wire itself, checked against the source.
//
// `selfYear` is how a life's OWNER-played year travels separately from the year it
// has been ghosted to, and a receiver falls back to `yearIndex(msg.state)` when the
// field is absent. That fallback is right for an older build and wrong for a sender
// on this one, so "every snapshot carries it" is a property of the whole file rather
// than of any single call — which is exactly why one send could quietly lose it and
// nothing noticed. `resync` did, for as long as reconnects have existed.
//
// Source-level because there is no runtime seam here: these sends live inside a
// React hook that needs a rendered room. Crude, and it still would have caught it.
// ─────────────────────────────────────────────────────────────────────────────
await check("every snapshot send carries selfYear", () => {
  const src = readFileSync(new URL("../../hooks/useMatch.tsx", import.meta.url), "utf8");
  const missing = [];
  let found = 0;
  for (const m of src.matchAll(/t:\s*"snapshot"/g)) {
    const start = src.lastIndexOf("send(", m.index);
    ok(start !== -1, `a snapshot literal at offset ${m.index} is not inside a send()`);
    let depth = 0;
    let end = start;
    for (let j = src.indexOf("(", start); j < src.length; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")" && --depth === 0) { end = j; break; }
    }
    found++;
    if (!src.slice(start, end + 1).includes("selfYear")) {
      missing.push(src.slice(0, start).split("\n").length);
    }
  }
  ok(found >= 7, `only found ${found} snapshot sends — did the shape change?`);
  eq(missing.length, 0, `snapshot sends with no selfYear, at useMatch.tsx line(s) ${missing}`);
});

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
