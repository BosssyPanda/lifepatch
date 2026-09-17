# LifePatch — Codebase Review

**Date:** 2026-09-17 · **Commit:** `583b02d` · **Branch:** `claude/eager-cori-suqki9`
**Scope:** 246 source files (`app/`, `components/`, `lib/`, `src/`, `hooks/`, `scripts/`, `supabase/`), `next.config.ts`, `package.json` + lockfile, SQL schema, 11 migrations, the `profile` Edge Function.

**Verification run during this review:** `tsc --noEmit` → clean · `eslint .` → clean · `npm audit` → 2 moderate, 0 high/critical.

---

## Summary

This codebase has clearly been through several dedicated security passes, and it shows: RLS is column-locked as well as row-locked, the client-written `verdict` column is constrained *and* re-guarded at every render boundary, the multiplayer wire protocol rebuilds every inbound field rather than trusting it, and `lib/metrics.ts` centralises untrusted-JSON coercion. **I found no critical vulnerability** — no hardcoded secrets, no injection sink, no `dangerouslySetInnerHTML`, no auth bypass. Saying otherwise would be inflating the findings.

What is left is a genuine tier below that: one public route that skipped the defences its own sibling route documents, two unbounded server-side surfaces, one peer-to-peer authorization gap, a reachable dependency advisory, and a game-integrity control that the architecture defeats. Nine findings, ordered by severity.

| # | Finding | Category |
|---|---|---|
| 1 | `/r/[id]` accepts any id — unbounded ISR + double DB read | Security (availability/cost) |
| 2 | Multiplayer `start`/`config` broadcasts are unauthenticated | Security (integrity) |
| 3 | `top_results` RPC has no ceiling on `p_limit` | Security (DoS amplification) |
| 4 | `profile_by_friend_code` has no rate limit | Security (enumeration) |
| 5 | `fflate` advisory reachable in the client bundle | Dependency |
| 6 | Raw Postgres error text reaches the player | Security (info disclosure) |
| 7 | Daily-puzzle seeds are computable client-side for any future date | Functional bug |
| 8 | `isCashflowShaped` validates 6 of ~20 dereferenced fields | Functional bug |
| 9 | Dead dependencies + broken shadcn alias; `randomIndex` rejection bound | Code quality |

---

## 1. `/r/[id]` accepts any id, with no validation, a per-id ISR entry, and two DB reads per render

**Category:** Critical-tier Security (availability / unauthenticated cost amplification)
**Files:** `app/r/[id]/page.tsx:23`, `:35-37`, `:171`, `:191` · `lib/cloud/results.ts:412-424`

`app/api/og/[id]/route.tsx` treats this exact page as a hostile surface and says so at length — it gates on `UUID_RE` before touching Supabase (`route.tsx:29`, `:52`), caps the fetch at 2.5s, and answers an unknown id with a **302 to one cacheable URL** specifically so "a stream of random UUIDs" cannot each cost an origin render (`route.tsx:~160`). The page it is the OG image *for* does none of that:

```ts
export const revalidate = 3600;
export function generateStaticParams(): { id: string }[] { return []; }   // ISR for ANY id
...
const row = await getResult(id).catch(() => null);                        // no id validation
```

`getResult` passes the raw path segment straight into `.eq("id", id)` against a `uuid` column. Three consequences compound:

- **No id gate.** Every `/r/<anything>` is a Supabase round trip. A non-uuid raises `22P02` server-side, which `getResult` swallows into `null` → `notFound()`. The work is still done.
- **ISR cache fill.** `generateStaticParams: []` + `dynamicParams` opts *every* id into the prerender cache. The file's own comment confirms this was verified against `.next/prerender-manifest.json`. Unknown ids are never evicted early, so a walk of random ids fills the route's cache with 404 entries.
- **Double read.** `generateMetadata` (`:171`) and the page body (`:191`) each call `getResult(id)` independently. supabase-js is not Next's instrumented `fetch`, so there is **no request dedupe** — every uncached render is two queries, not one.

**Failure scenario:** a scraper (or anyone with `curl` and a loop) requests `/r/` + 50,000 random UUIDs. Result: 100,000 unauthenticated Supabase reads, 50,000 origin renders, and 50,000 ISR entries — on the one page in the app explicitly designed to be "hit by strangers in bulk" (`next.config.ts`). The identical traffic against `/api/og/[id]` costs one render, because that route was hardened.

**Fix** — mirror the sibling route's gate, and dedupe the read with React's `cache`:

```ts
// app/r/[id]/page.tsx
import { cache } from "react";

const RESULT_ID_RE = /^[A-Za-z0-9-]{1,64}$/;   // already defined in lib/deepLink.ts — export and reuse

const loadResult = cache(async (id: string) => {
  if (!RESULT_ID_RE.test(id)) return null;      // reject before the network, as /api/og does
  return getResult(id).catch(() => null);
});

export async function generateMetadata({ params }) {
  const { id } = await params;
  const row = isCloud ? await loadResult(id) : null;
  ...
}

export default async function RunStatementPage({ params }) {
  const { id } = await params;
  if (!isCloud) return <NoRecords />;
  const row = await loadResult(id);              // same call → cached, one query per render
  if (!row) notFound();
  ...
}
```

`cache()` alone removes half the load; the regex removes the malformed-id traffic entirely. Tightening `RESULT_ID_RE` to the `UUID_RE` the OG route uses is stricter still, but would stop dev-mode `local-…` ids resolving — the shape gate is the honest middle.

---

## 2. Multiplayer `start` and `config` broadcasts carry no sender, and nothing bounds them

**Category:** Security (match integrity) — accepted-by-design for `tick`, not for `start`
**File:** `hooks/useMatch.tsx:1012-1029`

`MpMessage` has no author field: broadcasts are anonymous by construction. The `tick` handler confronts this head-on and bounds the damage — its comment ("The one inbound message with no author… a tick may pull us to the next year, or catch us up to a year roster members are demonstrably already at, never past it") is exactly the right instinct. `start` got no equivalent treatment:

```ts
case "config":
case "start": {
  const cfg = msg.config;
  if (cfg.roomCode !== roomRef.current) return;
  const cur = configRef.current;
  if (cur && cur.hostId !== cfg.hostId) return;   // ← the only authorization check
  ...
  if (!cfg.roster.some((r) => r.playerId === selfIdRef.current)) { refuseStart(); return; }
  beginRunning(cfg, 1, true);                     // ← attacker's seed, background, yearSeconds
}
```

The `cur.hostId !== cfg.hostId` test is not an authorization check — it compares the *forged message's own* `hostId` field against the one the victim holds, and both are readable from any member's presence row. So an attacker copies the real `hostId`, copies the victim's `playerId` into `cfg.roster` (also public in presence), picks any `seed`/`backgroundId`/`yearSeconds`, and broadcasts. The victim's client calls `beginRunning` on the attacker's world.

The presence path is *stricter* than the broadcast path here: `adoptConfig` (`:966-1003`) requires `cfg.roster.some(r => r.playerId === from)` for a running config. `handleMessage` has no `from` to check at all.

**Failure scenario:** eight friends in a room; one broadcasts a forged `start` with a seed they have already played. Everyone begins on their world; the standings and the podium rank a match whose author knew the markets in advance.

**Threat model, stated fairly:** this requires the 6-character room code (31⁶ ≈ 887M, shared out-of-band), and `docs/MULTIPLAYER.md` is explicit that there is no server authority. This is not a data-exposure bug. But it *is* an inconsistency with the file's own standard — `tick`, `status` and `snapshot` all fence an unauthored message, and `start` is the one that decides the whole world.

**Fix** — bound `start` the way `tick` is bounded: refuse a config that differs from the one the room has already agreed on. The lobby has already converged on `seed`/`backgroundId` via `config`/presence before anyone presses start, so the world is knowable before the message arrives:

```ts
if (msg.t === "start") {
  if (phaseRef.current === "running" || phaseRef.current === "finished") return;
  // A start may FREEZE the lobby's world; it may never redefine one.
  if (cur && (cur.seed !== cfg.seed || cur.backgroundId !== cfg.backgroundId)) return;
  if (!cfg.roster.some((r) => r.playerId === selfIdRef.current)) { refuseStart(); return; }
  beginRunning(cfg, 1, true);
  return;
}
```

A client holding no config yet (`cur === null`) still accepts a seed — that is the deliberate lobby-seeding behaviour `adoptConfig` documents — but a client that has seen the host's lobby can no longer be redirected.

---

## 3. `top_results` lets an anonymous caller request unbounded rows through a full `distinct on`

**Category:** Security (DoS amplification)
**File:** `supabase/migrations/2026-09-02_10_top_results.sql:45-95`

```sql
create or replace function public.top_results(
  p_mode text, p_limit int default 25, ...
) ... limit p_limit;
...
grant execute on function public.top_results(...) to anon, authenticated;
```

`p_limit` is caller-supplied with no ceiling. The client only ever passes `opts.limit ?? 25` (`lib/cloud/results.ts:248`), but the RPC is reachable directly at `POST /rest/v1/rpc/top_results` with the publishable key — which ships in every browser bundle.

This is **not a new data exposure** (`results` is public-read by policy, so the rows are already fetchable), and I want to be precise about that. What it is, is *amplification*: `select distinct on (r.user_id) r.* ... order by r.user_id, r.score desc` forces a full sort of the matching rows in the database before `limit` is applied, so `p_limit` does not bound the work — it only bounds the bytes returned. One request with `p_limit: 10000000` costs the database the entire sort; a paged `GET /results` does not.

I also found **no PostgREST `db-max-rows` configuration anywhere in the repo**, so there is no platform-level ceiling behind this.

**Fix** — clamp inside the function, where a client cannot reach past it:

```sql
   order by b.score desc, b.id asc
   limit least(greatest(coalesce(p_limit, 25), 1), 100);
```

100 is 4× the board's own `DEFAULT_LIMIT` and well past anything the UI draws. Also worth setting `db-max-rows` on the project as the belt to this braces.

---

## 4. `profile_by_friend_code` has no rate limit, while `rename` has a carefully-built one

**Category:** Security (enumeration)
**Files:** `supabase/schema.sql:167-182` · `lib/cloud/profiles.ts:232-241`

The rename path has an exemplary limiter: five attempts per hour, in the database, spent atomically under a row lock (migration 09), because — as its own comment says — "two distinguishable answers plus unlimited attempts is an oracle for who exists."

The friend-code lookup is the same shape of oracle and has none of it:

```sql
create or replace function public.profile_by_friend_code(code text)
returns table (id uuid, username text, avatar_seed text)
language sql security definer stable ...
grant execute on function public.profile_by_friend_code(text) to authenticated;
```

Any authenticated account can call this at whatever rate Supabase permits. A hit returns a real player's `id` and `username`; a miss returns nothing. The function itself is well-built — point query, `limit 1`, never returns the code, so a result cannot seed the next lookup — and the keyspace is 31⁶ ≈ 887M, which is a real defence. But "added by code, never by search" is described in `schema.sql:92-95` as *the one property the friends feature rests on*, and an unmetered oracle is the gap between that claim and what the SQL enforces. Migration 03 exists precisely because these codes were once enumerable.

**Fix** — reuse the mechanism that already works. The attempt counter and window columns are on `profiles` and the atomic-spend pattern is proven in `spend_rename_attempt`; add a second pair (`lookup_window_start`, `lookup_attempts`) and have `profile_by_friend_code` spend one per call, keyed on `auth.uid()`. A generous ceiling — 30/hour, far above any honest use, since a player types a code they were given — costs nothing legitimate and turns 887M guesses into 33,000 years. The same fail-open posture `decideRenameAttempt` documents applies.

---

## 5. `fflate` advisory is reachable in the shipped client bundle

**Category:** Dependency
**Files:** `package.json:14`, `package-lock.json`

```
lifepatch@0.1.0
+-- @react-three/rapier@2.2.0
| `-- three-stdlib@2.36.1
|   `-- fflate@0.6.10          ← moderate: unzipSync infinite loop on malformed ZIP64
+-- @types/three@0.185.0
| `-- fflate@0.8.3             ← patched
`-- shadcn@4.12.0 (dev)
  `-- @modelcontextprotocol/sdk@1.29.0 -> express@5.2.1 -> qs@6.15.3   ← moderate, dev-only
```

The `qs` finding is **not exploitable**: `shadcn` is a devDependency CLI, never bundled. The `fflate` one is different — `@react-three/rapier` is a runtime dependency imported by `components/cashflow/board/DiceRollOverlay.tsx:5`, so `three-stdlib` and its pinned `fflate@0.6.10` are in the browser bundle. Reachability of the *sink* is low (nothing in this app feeds attacker-controlled ZIP data to a loader), but it is a hang rather than a crash, and it is in the dice-roll path every Rat Race turn touches.

**Fix** — pin the patched line through the `overrides` block already present in `package.json`:

```json
"overrides": {
  "postcss": "$postcss",
  "fflate": "^0.8.2"
}
```

Then `npm install && npm run build` and confirm the dice overlay still renders — `three-stdlib`'s loaders are the only consumer, and 0.6 → 0.8 is API-compatible for the `unzipSync`/`inflate` surface they use.

---

## 6. Raw Postgres error text reaches the player from `saveRun` / `loadRun`

**Category:** Security (information disclosure) — low
**File:** `lib/saves.ts:65`, `:99`

The codebase has an explicit, well-argued rule about this. `submitResult` (`results.ts:228`): *"Ours, not Postgres's."* `updateUsername` (`profiles.ts:200`): *"The message is ours, not Postgres's — `error.message` here is raw PostgREST text and this value is thrown as what a caller shows."* The `profile` Edge Function fixed the same thing at `index.ts:179-191` and called `ensure` "the worst possible place for it."

`lib/saves.ts` is the one path that still does it:

```ts
if (error) throw new Error(error.message);          // :65  saveRun
...
if (error) throw new Error(error.message);          // :99  loadRun
```

`persist` catches this and raises the "Not saved" flag, and `YearHud` prints it. So an RLS refusal, a constraint violation or a schema fault publishes PostgREST's verbatim string — column names, relation names, constraint text, policy names — into the game UI. Not a breach on its own; it is exactly the reconnaissance detail the rest of the codebase decided not to hand out.

**Fix** — same shape as the three precedents:

```ts
if (error) {
  console.error("saveRun: upsert failed", error);
  throw new Error("Could not save your run. Try again in a moment.");
}
```

The contract (`saveRun` throws on a failed write) is unchanged; only the text stops being the database's.

---

## 7. The daily puzzle's "no private rehearsal" rule is defeated by the shipped bundle

**Category:** Functional bug (game integrity)
**Files:** `lib/daily.ts:80-97` · `lib/challenge.ts:74-84`

`challengeableWorld` refuses to offer a daily row as a challengeable world, and states the reason precisely:

> • A DAILY is not a practice range. Offering today's puzzle here would hand anyone a private rehearsal of it — same seed, same background, and the daily is dealt unbiased too — before they file the real attempt.

The control is correct in itself. But the thing it is protecting is derived, not stored, by two pure exported functions in a module that ships to the browser (`lib/daily.ts` is imported by `components/social/Leaderboard.tsx:16` and `DailyStrip`, both `"use client"`):

```ts
export function dailySeed(date: string): number {
  return Math.floor(mulberry32(strHash(`lifepatch.daily.${date}`))() * SEED_SPACE);
}
export function dailyBackgroundId(date: string): string { ... }   // pure function of the date
```

Anyone who opens devtools can compute the seed and background for **any** date — including tomorrow's and next month's — and pre-play them with `initRun("story", bg, name, seed)`. The `?vs=` gate closes the convenient door on a house that has no walls.

This is a design tension, not an oversight, and the honest options are both real:

1. **Accept it and say so.** The module header already documents why the derivation is pure ("a day's puzzle can be recomputed years later from nothing but its date") — that property is genuinely valuable. If rehearsal is tolerable, then the `challengeableWorld` comment is overstating what it buys and should be softened to match, the same way `verifyResult`'s comment carefully declines to overclaim ("A self-check, not an attestation").
2. **Actually close it.** Salt the seed with a value only the server holds and publish it per-day: `dailySeed(date, salt)` where the salt arrives from a tiny Edge Function or a `daily_salts` row released at 00:00 UTC. This costs the offline/recompute property and adds a network dependency to the one mode that currently has none.

**Recommendation:** (1), explicitly. The daily's board is already honest about its limits (`dailySave.ts:15-18` says the one-attempt rule "is a courtesy… not a lock"), and (2) trades a real architectural virtue for a defence that only stops the casual. But the two comments should not be left disagreeing with each other.

---

## 8. `isCashflowShaped` validates 6 fields; the state has ~20 that readers dereference

**Category:** Functional bug (hardening gap)
**File:** `lib/cashflow/persist.ts:~46-75`

The guard exists for a good, documented reason — a `{"version":2}` record used to reach the selectors and throw a `TypeError` on the **mode select screen**, with no in-app way back short of clearing site data. The fix is right in principle and incomplete in practice:

```ts
function isCashflowShaped(s: unknown): s is CashflowState {
  if (!s || typeof s !== "object") return false;
  const c = s as Partial<CashflowState>;
  return (
    typeof c.cash === "number" && Number.isFinite(c.cash) &&
    !!c.liabilities && !!c.expenses &&
    Array.isArray(c.stocks) && Array.isArray(c.realEstate) && Array.isArray(c.businesses)
  );
}
```

`CashflowState` (`types.ts:250-265`) additionally requires `track`, `position`, `turn`, `status`, `professionId`, `dreamId`, `perChild`, `children`, `startingNetWorth`, `fastTrackCashflow`, `seed`, `rngCursor`. None are checked, and `!!c.liabilities` accepts `{}`.

**Failure scenario:** a record of `{"version":2,"cash":0,"liabilities":{},"expenses":{},"stocks":[],"realEstate":[],"businesses":[]}` passes. `hasCashflowSave()` returns true, the mode select offers "Continue", and the loaded run yields `s.perChild * s.children` → `NaN` (`selectors.ts:27`), every expense total `NaN`, and `s.position` `undefined` indexing the board. **To be accurate: this produces silent NaN money and an undefined board position, not the crash the original bug caused** — which is arguably worse, because nothing surfaces it. The store is device-local, so the blast radius is one player's own save, reachable by hand-editing or a partial write.

**Fix** — extend the floor to what is actually dereferenced, keeping the v1/v2 common-subset property the comment relies on:

```ts
const NUM = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const OBJ = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);

function isCashflowShaped(s: unknown): s is CashflowState {
  if (!OBJ(s)) return false;
  const c = s as Partial<CashflowState>;
  return (
    NUM(c.cash) && NUM(c.position) && NUM(c.turn) &&
    NUM(c.children) && NUM(c.perChild) && NUM(c.salary) &&
    typeof c.professionId === "string" && typeof c.dreamId === "string" &&
    (c.track === "rat" || c.track === "fast") && typeof c.status === "string" &&
    OBJ(c.liabilities) && OBJ(c.expenses) &&
    Array.isArray(c.stocks) && Array.isArray(c.realEstate) && Array.isArray(c.businesses)
  );
}
```

`startingNetWorth`, `interestPaid`, `lostReason` and `stockPrices` stay out — `migrateV1` backfills all four, which is the property that lets v1 and v2 share this floor.

---

## 9. Code quality and performance

**a) Three declared runtime dependencies with zero importers.** `clsx`, `tailwind-merge` and `@tonejs/midi` appear in `package.json` `dependencies` and are imported nowhere in `app/`, `components/`, `lib/`, `src/`, `hooks/` or `scripts/` — only in documentation. `components.json:aliases.utils` points at `@/lib/utils`, **which does not exist**, so the next `npx shadcn add` will fail or silently scaffold a `cn()` helper nothing uses. `howler` is imported only by `src/audio/sfxBank.ts`, whose three consumers all use `import type` — so it is correctly tree-shaken out of the bundle, but it is still installed weight for a class the file itself says "Nothing constructs… today." `@types/howler` is in `dependencies` rather than `devDependencies`.

*Fix:* `npm uninstall clsx tailwind-merge @tonejs/midi`, move `@types/howler` to `devDependencies`, and either create `lib/utils.ts` or drop the `utils` alias from `components.json`. Keep `howler` — the drop-in path it exists for is documented and deliberate.

**b) `randomIndex` rejection bound is off by one.** `supabase/functions/_shared/generate.ts:44`:

```ts
const limit = Math.floor(0xffffffff / bound) * bound;
```

A `Uint32Array` draw ranges over **2³² = 4294967296** values, not `0xffffffff`. For `bound = 16` (the avatar-seed nibble) this rejects the top 16 values that a correct bound would accept. **Uniformity is unaffected** — the accepted range `[0, 4294967280)` is still exactly divisible by 16 — so this is a nit, not a weakness. Worth fixing so the next reader doesn't have to re-derive that:

```ts
const limit = Math.floor(0x100000000 / bound) * bound;
```

**c) No `Cache-Control` on `/r/[id]`'s 404 path.** When `getResult` returns null the page calls `notFound()`, which Next serves without a cache header — so unknown ids re-render on every request. `/api/og/[id]` handles the identical case with a deliberate `s-maxage=60` and explains why that number (long enough to be worth caching, short enough that a link shared before its row lands isn't pinned wrong). Worth mirroring once finding #1 is fixed.

---

## What is already right, and worth not regressing

Stated because a review that only lists problems misrepresents the codebase:

- **`next.config.ts`'s CSP.** The absence of `script-src` is a documented, costed decision with the exact conditions for reopening it written down. `connect-src` derived from the build's own env var — and falling back to `'self'` rather than being omitted when the var is missing — is the right failure direction.
- **Column-level grants.** `revoke insert on results` + `grant insert (user_id, mode, score, verdict, metrics)` is the correct shape, and the comment explaining *why a column-level REVOKE cannot carve an exception out of a table grant* will save the next person a real afternoon.
- **`lib/mp/protocol.ts`.** Every inbound field rebuilt rather than passed through; the `year < startYear` cross-check added after a forged 4001-year snapshot is exactly the class of bug parsers miss.
- **`lib/metrics.ts`.** Centralising `finiteNumber` — and documenting that `Number(null)`, `Number("")`, `Number([])` are all finite — is the single highest-leverage defensive module here.
- **`spend_rename_attempt`.** Read-and-write in one statement under the row lock, with the racy read-modify-write kept as a deploy-order-free fallback. Textbook.

---

## Recommended order of work

1. **#1** — the only finding an unauthenticated stranger can exercise at scale. `cache()` + the id gate is roughly 10 lines.
2. **#5** — a one-line `overrides` entry and a build check.
3. **#3** — a one-line `least(greatest(...))` in the migration.
4. **#6, #8, #9a** — small, local, no behaviour change.
5. **#2, #4** — real design work; both need a decision about threat model before code.
6. **#7** — decide between the two options and make the comments agree either way.
