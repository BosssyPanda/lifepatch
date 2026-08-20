# LifePatch — "With Friends" multiplayer for Story mode

How the live-room feature works, what it requires, and how to test it. Every
claim here was checked against the shipped code (`lib/mp/`, `hooks/useMatch.tsx`,
`components/mp/`), not the design spec.

---

## 1. Architecture

**Deterministic shared world, thin realtime layer.** There is no game server and
no game-state authority. The run engine is pure and seeded — markets depend only
on `(year, seed)` (`lib/markets.ts`), event draws and outcome rolls on the run
seed plus the year (`lib/runEngine.ts`) — so every client simulates its own run
locally from `initRun("story", backgroundId, name, config.seed)`. Players
sharing a seed see identical markets; that, and nothing else, is the fairness
story. Event streams may diverge as lives diverge, which is expected.

The room shares only four things:

1. **Config + seed** (`MatchConfig`) — the world every player builds locally.
2. **A year clock** — `tick` broadcasts from the acting host.
3. **Lightweight status rows** (`PeerStatus`) — what the live standings read.
4. **Full `RunState` snapshots** — the ghost-play cache and the rejoin source.

### The clock

The **acting host** owns the clock. It broadcasts
`tick { yearIndex, yearSeconds }` at each year boundary; every client re-anchors
its deadline on its **own** clock on arrival
(`deadlineAt = Date.now() + yearSeconds * 1000`) — a peer's wall-clock is never
trusted. When the timer expires, unresolved life events are auto-resolved with a
deterministic neutral choice (`lib/mp/autoResolve.ts`) and the year advances for
everyone. Three resilience mechanisms:

- **Fallback self-advance**: a non-host that hears no tick within 3s past its
  own deadline advances alone. The world is deterministic, so a client that
  advances alone is still playing the same match.
- **Host migration**: acting host = `config.hostId` while connected, else the
  connected player with the lexicographically smallest id. Every client computes
  it from the same presence data — no election message.
- **Host resync**: a backgrounded host tab keeps its socket but loses its timers
  (browsers defer them), so it can fall behind without being migrated away from.
  If connected peers report a higher `yearIndex` than the host's own room year,
  the host adopts it and re-arms.

**All-ready skip**: "Lock in the year" marks a player ready. When every
connected, still-playing peer is ready, the acting host emits the next tick
immediately. Readiness is bound to the year it was sent for — a lock-in from a
year the room has left never pulls the next one forward.

### Ghost-play

Every client broadcasts a full `snapshot` after each advance, and every client
caches the latest snapshot per peer (so a host migration keeps the absent
players' lives). At each tick, the acting host runs `fastForward` — the same
deterministic auto-play — on each disconnected player's cached snapshot and
broadcasts their updated row flagged `ghost: true`. Their leaderboard row stays
live while they are gone.

### Rejoin

A player who lost the tab types the room code again. Join-after-start is allowed
only for players in the frozen `config.roster`. Recovery sources, best first:

1. this device's own `matchStore` copy,
2. the acting host's snapshot cache (`snapshotRequest` / `snapshotReply`),
3. failing both, a rebuild from the shared seed via `initRun` + auto-play.

Whichever source, the client runs the identical `fastForward` to the room's
year. Determinism guarantees the rejoiner lands on the exact state the host has
been ghost-playing — the row the room watched belongs to the life the player
comes back to. `joinRoom` returns `"rejoined"` and hands the caught-up state to
the app via `MatchApi.resumeState`.

### Match lifecycle

`lobby` → host taps Start (`start {config}` with the frozen roster) → `running`
→ `finished` when every run has `status === "ended"` or the room clock passes
the story's last year. A player whose run ends early goes to the podium
immediately and spectates the live standings there.

### Persistence

Match runs are localStorage-only (`lib/mp/matchStore.ts`, key
`lifepatch.mp.<ROOMCODE>`, newest 3 rooms kept). They **never** write through
`lib/saves.ts` — that store is keyed `(user_id, mode)` and would clobber the
player's solo story save. Finished match runs submit to the existing global
leaderboard as ordinary `mode: "story"` results through the existing plumbing.

Never show calendar years mid-run (`lib/modes.ts`): match UI says
"Year 3 · Age 25", never "1992".

---

## 2. Protocol

`MP_PROTOCOL = 1` (`lib/mp/protocol.ts`). Channel topic `lp-match-v1-<CODE>`;
one broadcast event (`mp`) carries every message, discriminated by `t`. Room
codes are 6 characters from a 31-glyph alphabet with no 0/O/1/I/L
(`lib/mp/roomCodes.ts`).

### Presence

Each member tracks `{ v, playerId, name, avatarSeed, joinedAt, status?, config? }`.
The presence key is `${playerId}#${tabNonce}` so two tabs on one device are two
connections but one player (the UI dedupes by `playerId`). Every member
republishes the config in presence once running, so a rejoiner can read the
whole room off **any** member — there is no table to ask.

### Broadcast messages

All carry `v: MP_PROTOCOL`; a mismatched version is dropped, never coerced.

| Message | Sender | Payload |
|---|---|---|
| `config` | host, lobby only | `{ config }` — timer/background updates |
| `start` | host | `{ config }` incl. the frozen roster |
| `tick` | acting host | `{ yearIndex, yearSeconds }` |
| `status` | each client | `PeerStatus` on ready / advance / end; ghost rows from the acting host |
| `snapshot` | each client | `{ playerId, state: RunState }` after each advance |
| `snapshotRequest` / `snapshotReply` | rejoiner ⇄ acting host | own last snapshot |

### Validation posture

Every inbound byte — broadcast and presence alike — is a stranger's input.
`lib/mp/protocol.ts` is the single door: shapes are checked field by field,
numbers clamped (money to ±1e12, year index to 400, history/flags/event lists
capped at 400 entries), names go through the same `playerName()` as Setup, and
parsers **rebuild** their result rather than pass wire objects by reference, so
a peer can never smuggle an extra key into persisted state. `parseRunState`
refuses any snapshot whose `version !== RUN_VERSION`. On top of the parsers,
`hooks/useMatch.tsx` enforces authorship:

- nobody may speak for us — a status, snapshot or presence row claiming our own
  `playerId` is ignored;
- only the frozen roster may write game state once running (statuses and
  snapshots from strangers holding the code are dropped);
- only the lobby host may define the config, and mid-match only roster members
  may republish it — no one can hand the room a new seed;
- a presence row may only carry its author's own status;
- the room seats 8: a ninth is turned away at `joinRoom`, at the presence
  merge, and at the status merge; rosters are capped and de-duplicated in the
  parser because the roster is also the rejoin gate;
- the room clock is capped to the story's last year + 1, whatever the wire says.

### Transport

`lib/mp/transport.ts` defines `MatchTransport` — `join / leave / send /
updatePresence / onMessage / onPresence` with `unknown` payloads (validation
happens once, at the receiving end). Two implementations behind
`createTransport()`:

- **Supabase Realtime** — `supabase.channel(name, { broadcast: { self: false },
  presence })`, re-tracking presence on every `SUBSCRIBED` so a wifi blip does
  not leave a seated player looking disconnected.
- **Local `BroadcastChannel`** — see §4.

`createTransport()` returns `null` when neither is available; the entry panel
renders a disabled state instead of a broken Create button.

---

## 3. Supabase requirements

- **Realtime must be enabled** on the Supabase project (channels with broadcast
  + presence). No auth is required — rooms are guest-first on the anon key.
- Env vars: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  (the same pair `lib/supabase.ts` already reads). Take both from
  **Settings → API Keys**: the Project URL, and the **publishable key**
  (`sb_publishable_…`) that replaced the legacy `anon` key — projects created
  since Nov 2025 have no `anon` key at all. It is a drop-in replacement; only the
  env var's historical *name* still says "anon".
- **Hosted deploys inline `NEXT_PUBLIC_*` at BUILD time.** Setting these in
  Vercel's dashboard changes nothing until the next deploy — a redeploy is
  required, not just a save.
- **Rooms work for guests; the global leaderboard does not.** Realtime needs no
  auth, so anyone can create and join a room. But once Supabase is configured,
  `resolvePlayerId` (`lib/cloud/identity.ts`) returns `null` for a `device-*`
  guest, because the `results` table's RLS requires a real auth user — so a
  guest's finished match posts nowhere. Players who want a global row must sign
  in with the magic link. The match podium is unaffected either way.
- **Channels are public (`private` is unset, i.e. `false`).** Anyone who learns a
  room code can join that channel; Realtime's private-channel mode would require
  authenticated users and RLS policies on `realtime.messages`, which would break
  guest-first play. The room layer defends itself instead — roster gating on
  `status`/`snapshot`, a bounded `tick`, and self-row protection (see §2) — but
  the trust model is "the room code is the secret".
- **No schema changes.** `supabase/schema.sql` is untouched. Match persistence
  is localStorage-only; result submission reuses the existing `results` table as
  `mode: "story"`, which its CHECK already allows. There is no rooms table, no
  new API route, no new dependency — Realtime ships inside the existing
  `@supabase/supabase-js`.

Without the env vars, online play degrades gracefully: the "Play with friends"
panel shows *"Online play needs the cloud connection — this build doesn't have
one configured."* and solo play is untouched.

---

## 4. Local transport (`NEXT_PUBLIC_MP_LOCAL=1`)

For same-device testing with no cloud project at all. Selection order in
`createTransport()`:

1. `NEXT_PUBLIC_MP_LOCAL=1` → always the local transport;
2. Supabase, when configured;
3. `NODE_ENV=development` → local transport as a fallback;
4. otherwise `null` (disabled state).

The local transport is a `BroadcastChannel` per room with hand-rolled presence:
each tab announces itself on a 1.2s heartbeat and is pruned after 4.5s of
silence — which is what makes disconnect/ghost-play testable locally (close a
tab, watch the row grey out and ghost forward).

One wrinkle the flag also solves: two tabs share one device id, i.e. one
player. Under `NEXT_PUBLIC_MP_LOCAL=1` **only**, each tab gets a
sessionStorage-scoped id suffix so tabs are distinct players. Cloud rooms are
untouched — there, one device is one seat.

---

## 5. Manual test plan (two tabs, one machine)

```
NEXT_PUBLIC_MP_LOCAL=1 npm run dev
```

Open two tabs on the app. In both: Story → Setup → enter distinct names.

1. **Create** — Tab A: "Play with friends" → Create room. Lobby shows the
   6-char code, A's row with the host badge, Start disabled (needs 2+).
2. **Join** — Tab B: Join with code (input auto-uppercases, drops junk). Both
   lobbies show both players.
3. **Host controls** — Tab A changes year timer (30/45/60/90) and background;
   Tab B sees the picks land read-only. B has no controls.
4. **Start** — Tab A: Start. Both tabs enter the run simultaneously, same
   background, and the year timer counts down in both. The UI shows
   "Year N · Age NN" — never a calendar year.
5. **Play** — make different choices in each tab. The match rail shows both
   rows, net worths moving independently, markets identical.
6. **Lock-in** — resolve all events in both tabs, press "Lock in the year" in
   both. The year advances immediately (all-ready skip), not at the deadline.
7. **Timer expiry** — in one tab, leave an event unresolved and let the clock
   run out. The event auto-resolves and both tabs advance together.
8. **Drop** — close Tab B mid-run. Within a few seconds A's rail dims B's row;
   on subsequent years B's row keeps advancing, flagged as a ghost.
9. **Rejoin** — reopen a tab, same Setup name, Join with the same code. It
   lands directly in the run, fast-forwarded to the room's year, with figures
   matching what A's rail showed for the ghost. (sessionStorage is per-tab: to
   rejoin as the *same* local player, restore the closed tab —
   Cmd/Ctrl-Shift-T — rather than opening a fresh one.)
10. **Drop out** — "Drop out" keeps the two-tap arming; the dropped player goes
    to the podium and spectates live standings ("N of M still living their
    lives…").
11. **Podium** — finish both runs (or let the final year pass). Both tabs show
    the final podium; "See your life report" opens the existing recap, "Back to
    title" leaves. Finished runs appear on the global story leaderboard when
    Supabase is configured.
12. **Solo regression** — with the panel present, start a plain solo story run;
    nothing multiplayer renders and the solo save is intact.

---

## 6. Known limitations

- **Client-clock trust model.** Deadlines are anchored on each device's local
  clock from the moment a tick arrives; heavy clock skew or long network delays
  shift when a given client's year ends. Latency is negligible next to a 30–90s
  year, but the model is trust-by-anchoring, not synchronization.
- **No anti-cheat.** There is no server and no authority: a modified client can
  broadcast any status or snapshot for *itself*. The protocol stops peers from
  impersonating each other, corrupting each other's state, or crashing each
  other with malformed input — it cannot stop a player from lying about their
  own net worth. This is a game between friends.
- **8-player cap**, 2 to start. Enforced at the door, in presence, and in every
  status merge.
- **Ghost-play needs a snapshot.** A player who disconnects before their first
  advance has no cached snapshot; their row simply stops moving until they
  rejoin (which then rebuilds from the seed).
- **Auto-play is deliberately myopic.** The neutral choice minimizes worst-case
  immediate cash damage only; it does not weigh salary, health or happiness,
  and it never trades or pays debt. Absent players drift, they don't compete.
- **The `start` broadcast is at-most-once.** A guest mid-handshake when it goes
  out learns of the start from presence and is told "The host started the match
  without you" if the roster excludes them.
- **Identity is frozen for the match.** Signing in mid-room would change the
  player id and orphan the row the room is watching, so it is deferred.

---

## 7. Out of scope (not built, on purpose)

Chat; spectator links for non-players; async challenge links; server-side
anti-cheat or authoritative simulation; new API routes; database schema
changes; new music cues (lobby/podium reuse the menu bed, the run keeps the
gameplay bed, and every sound in the match UI is an existing sfx/accent/sting);
multiplayer for Infinite or Rat Race.
