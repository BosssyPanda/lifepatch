# LifePatch — Codebase Review

**Date:** 2026-09-04 · **Commit:** `583b02d` · **Branch:** `claude/eager-cori-9zz04k`
**Scope:** ~48,800 lines across `app/`, `components/`, `hooks/`, `lib/`, `src/`, `scripts/`, `supabase/`

---

## Executive summary

This is an unusually well-hardened codebase. The obvious findings a review normally
produces are already closed and *documented at the site of the fix*: the friend-code
leak (migration 02), the client-chosen `id`/`created_at`/`friend_code` write surface
(04, 06), the username filter's missing server half (05), the non-atomic rename
limiter (07 → 09), NaN/`Infinity` scores, unbounded `metrics`/`saves.state`, and the
wire parser for multiplayer. There is no `dangerouslySetInnerHTML`, no `eval`, no
string-built SQL, no hardcoded secret, and no service-role key anywhere a browser
can reach.

**No critical security vulnerability was found.** The findings below are two medium
security gaps, one reproduced functional bug, and a small number of quality items.
I have not inflated anything to fill a severity bucket.

### Verification performed

`node_modules` was absent on arrival; after `npm ci` the repo's own gates were run:

| Gate | Result |
|---|---|
| `npm run typecheck` | ✅ clean |
| `npx eslint .` | ✅ clean |
| `qa:engine` | ✅ 34/34 |
| `qa:cloud` | ✅ 16/16 |
| `qa:rename` | ✅ 16/16 |
| `qa:rls` | ✅ 16 probes closed, 24 behaviours intact |
| `qa:username` | ✅ 1728 generated + 22 innocent accepted, 24 abusive refused |
| `qa:challenge` | ✅ 10/10 |
| `qa:metrics` | ✅ 19/19 |
| `qa:transport` | ✅ 11/11 |
| `qa:audio` | ✅ PASS, 0 console errors |
| `qa:mp` | ❌ **fails** — see **BUG-1**, which is the cause |
| `npm audit` | 2 moderate (both transitive) |

---

## 1 · Critical Security Vulnerabilities

**None found.**

---

## 2 · Security Findings (medium → low)

### SEC-1 · `profile_by_friend_code` is an unrate-limited enumeration oracle — *Medium*

**Where:** `supabase/schema.sql:167–182`

The friend code is, in this schema's own words, *"the sole capability guarding
addByCode"*, and the whole friends design rests on **"added by code, never by
search."** The RPC is correctly shaped as a point query — one row in, at most one
row out, no code in the result, nothing to page through — but any authenticated
caller may invoke it an unlimited number of times.

The code space is 31⁶ = **887,503,681**. That sounds like enough, but the attack
isn't "guess a *specific* player's code", it's "find *anyone's*". With *P* players
enrolled, the expected number of guesses to land on some valid code is ≈ 887M / *P*:

| Players | Expected guesses to hit *someone* | At 100 req/s |
|---|---|---|
| 1,000 | ~887,000 | ~2.5 hours |
| 10,000 | ~88,750 | ~15 minutes |
| 100,000 | ~8,875 | ~90 seconds |

A hit yields `id`, `username` and `avatar_seed`, and lets the attacker push a friend
request at a stranger — which is exactly the property migration 02 and the (optional)
rotation in 03 were run to restore.

The repo already contains the right mechanism, built for the structurally identical
username oracle: `spend_rename_attempt` (migration `2026-09-02_09`), whose header
explains why the read and the write must be one statement.

**Recommendation** — apply the same pattern to lookups:

```sql
-- 11_friend_code_lookup_limit.sql
alter table public.profiles
  add column if not exists code_window_start timestamptz,
  add column if not exists code_lookups int not null default 0;

create or replace function public.spend_code_lookup(uid uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  limit_n  constant int := 20;                      -- generous for a human
  window_i constant interval := interval '1 hour';
begin
  update public.profiles p
     set code_window_start = case when p.code_window_start is null
              or now() - p.code_window_start >= window_i then now()
              else p.code_window_start end,
         code_lookups = case when p.code_window_start is null
              or now() - p.code_window_start >= window_i then 1
              else p.code_lookups + 1 end
   where p.id = uid
     and (p.code_window_start is null
          or now() - p.code_window_start >= window_i
          or p.code_lookups < limit_n);
  return found or not exists (select 1 from public.profiles where id = uid); -- fail open
end $$;
```

…then gate `profile_by_friend_code` on it (which makes it `security definer` and
`volatile`), or — preferring the shape the project already uses for privileged
writes — move the lookup into the `profile` Edge Function beside `rename`, where
the limiter, the CORS list and the `verify_jwt` gate all already live.

> **Note on the trade-off, so it is a decision rather than an oversight:** this
> limiter must fail *open*, exactly as `decideRenameAttempt` documents. The thing
> protected is an oracle, not an account, and a player who cannot add a friend
> during a database hiccup is the worse outcome.

---

### SEC-2 · `friends` is the one client-written table with no ceiling — *Medium-Low*

**Where:** `supabase/schema.sql:368–423`

Migrations 04 and 06 carried one theme through the whole schema — *"a policy answers
WHICH ROW and never WHICH COLUMN, and a column with no CHECK is a column the client
defines"* — and gave `saves`, `results`, `streaks` and `mastery` each a ceiling:
`saves_state_small`, `results_metrics_small`, `results_cap_per_player` (500 rows),
`streaks_sane`, `mastery_level_sane`.

`friends` was missed. It has:

* no per-player row cap (contrast `results_cap_per_player`),
* no rate limit on inserts,
* and an insert policy that permits `status = 'pending'` toward **any** `friend_id`.

The target ids are not secret. `results` carries `for select using (true)` by design
(`schema.sql:235–236`), so `GET /rest/v1/results?select=user_id` with the publishable
key enumerates every player who has ever finished a run. Combined:

1. one signed-in account reads every `user_id` off the public board;
2. it inserts a `pending` edge at each one;
3. every one of those players opens `FriendsSheet` to an inbox of requests from a
   stranger, and the table grows without bound.

`listIncoming` surfaces `pending` edges, so this is visible spam rather than a silent
one; and unlike `results`, nothing prunes.

**Recommendation** — mirror the trigger that already exists one table over:

```sql
create or replace function public.friends_cap_per_player()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cap constant int := 500;   -- far past any real friends list
begin
  if (select count(*) from public.friends f where f.user_id = new.user_id) >= cap then
    raise exception 'friend list is full';
  end if;
  -- Outgoing PENDING requests are the spam vector; bound them much harder.
  if new.status = 'pending' and (
       select count(*) from public.friends f
        where f.user_id = new.user_id and f.status = 'pending'
          and f.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'too many friend requests — try again later';
  end if;
  return new;
end $$;

drop trigger if exists friends_cap_per_player on public.friends;
create trigger friends_cap_per_player
  before insert on public.friends for each row
  execute function public.friends_cap_per_player();
```

`addByCode` (`lib/cloud/friends.ts`) already distinguishes error codes correctly and
will surface a refusal as `reason: "failed"`; if this lands, give the raised
exceptions their own branch so the player is told *which* limit they hit.

---

### SEC-3 · The CSP's `script-src` premise is conditional — *Low (accepted risk, re-confirm)*

**Where:** `next.config.ts:1–56, 117–127`

The 50-line header explaining why there is **no `script-src`** is a genuinely good
decision record: a nonce forces every route dynamic, which costs `/r/{id}` its ISR —
and the usual way in is closed, because the app renders no user-supplied markup and
the only player-authored string reaching another screen (`username`) is charset-locked
in three places.

The file states its own re-open condition: *"the day … a third-party script is added
to the document."* One premise is worth re-confirming rather than assuming:

`app/layout.tsx` mounts `<Analytics />` and `<SpeedInsights />`. On Vercel these are
proxied same-origin at `/_vercel/insights/script.js`, so `'self'` covers them and the
premise holds. **Off Vercel — and in `next dev`, observed directly during this
review** — they fall back to `https://va.vercel-scripts.com/v1/script.debug.js`:

```
[Vercel Web Analytics] Failed to load script from https://va.vercel-scripts.com/v1/script.debug.js
```

So the premise is a property of *where this is deployed*, not of the code. It is
currently true in production. Worth a line in the comment saying so, so a future
self-hosted deploy does not silently invalidate the reasoning.

Separately, the policy has no `default-src`, so `img-src`, `style-src`, `font-src`
and `media-src` are unrestricted. `connect-src` is the half that matters for
exfiltration and is present; the rest is defence-in-depth that costs nothing:

```ts
"default-src 'self'",
"img-src 'self' data: blob:",
"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
"font-src 'self' https://fonts.gstatic.com data:",
"media-src 'self'",
```

*(verify against `next/font` output before shipping — it inlines `@font-face` and may
want `data:` on `font-src`.)*

---

### SEC-4 · Two moderate dependency advisories — *Low*

`npm audit`: 0 critical, 0 high, **2 moderate**, both transitive, both fixable.

| Package | Advisory | Path | Severity |
|---|---|---|---|
| `fflate` 0.6.0–0.6.10 | [GHSA-px8p-9vwx-vf98](https://github.com/advisories/GHSA-px8p-9vwx-vf98) — `unzipSync` infinite loop on malformed ZIP64 | transitive (three.js / `@react-three/*`) | moderate (CVSS 7.5, DoS) |
| `qs` 2.2.5–6.15.3 | [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g), [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) | dev-only | moderate |

Neither is reachable from this app's own code paths — nothing here unzips
user-supplied archives, and `qs` is dev-only — so this is hygiene, not exposure.

**Recommendation:** `npm audit fix` (no major bumps required), and re-run
`qa:engine` / `qa:audio` afterwards since `three` is in the graph.

---

## 3 · Functional Bugs

### BUG-1 · Same-device multiplayer is broken under plain `next dev` — *High confidence, reproduced*

**Where:** `lib/mp/transport.ts:523–537` ↔ `hooks/useMatch.tsx:242–254`

Two functions gate the *same* "same-device local room" mode on two *different*
conditions:

```ts
// lib/mp/transport.ts:523
export function isLocalTransportEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MP_LOCAL === "1" || process.env.NODE_ENV === "development";
}                                                  // ^^^^^^^^^^^^^^^^^^^^^^^^^^ dev fallback

// lib/mp/transport.ts:532
export function createTransport(): MatchTransport | null {
  if (process.env.NEXT_PUBLIC_MP_LOCAL === "1") return createLocalTransport();
  const cloud = createSupabaseTransport();
  if (cloud) return cloud;
  return isLocalTransportEnabled() ? createLocalTransport() : null;   // ← dev gets the local transport
}

// hooks/useMatch.tsx:242
function tabScopedId(base: string): string {
  if (process.env.NEXT_PUBLIC_MP_LOCAL !== "1") return base;          // ← but NOT the per-tab id
  ...
}
```

On `next dev` with no Supabase keys, `createTransport()` hands back the
BroadcastChannel transport, but `tabScopedId()` declines to split tabs. Both tabs on
the device therefore resolve to **one player id**. `useMatch` filters presence rows
carrying its own id, so each tab discards the other's row, no `config` ever arrives,
and `joinRoom`'s 5-second handshake (`HANDSHAKE_MS`) times out.

**Reproduced** (Playwright, two tabs, `npx next dev`, no `.env.local`):

| | Host tab | Guest tab |
|---|---|---|
| observed | lobby open, `ROOM CODE GUUSCD`, **`AT THE TABLE 1 / 8`** | bounced back to Setup: **"That room isn't running any more — everyone in it has left."** |

Re-running the identical script against `NEXT_PUBLIC_MP_LOCAL=1 next dev` — the only
change — the host reads **`AT THE TABLE 2 / 8`** and the join succeeds. That isolates
the cause to the flag, not to timing or the harness.

This is also why `npm run qa:mp` fails on a stock dev server. The gate has a SKIP
branch for "this build has no transport at all", but it never fires here: the dev
fallback *did* hand the app a transport, just one that cannot work. So the gate
reports a red failure rather than an honest skip — the trap being that the fallback
looks like support.

**Impact:** development and CI only (`NODE_ENV === "development"` is required to
reach it). Production cloud rooms are unaffected: there, one device is one seat by
design, and `newSessionId()` is what separates two tabs.

**Recommendation** — give both call sites one predicate. In `lib/mp/transport.ts`:

```ts
/**
 * True when this build will actually run the same-device BroadcastChannel
 * transport — i.e. what `createTransport` is about to return. `tabScopedId` must
 * read THIS and not the flag: the flag is one of two ways to reach the local
 * transport, and splitting on it alone leaves the dev fallback with two tabs
 * sharing one player id, which is a room that can never reach two players.
 */
export function usingLocalTransport(): boolean {
  if (process.env.NEXT_PUBLIC_MP_LOCAL === "1") return true;
  return !isCloud && isLocalTransportEnabled();
}
```

and in `hooks/useMatch.tsx:242`:

```ts
-  if (process.env.NEXT_PUBLIC_MP_LOCAL !== "1") return base;
+  if (!usingLocalTransport()) return base;
```

(`isCloud` is already exported from `lib/supabase.ts` and is the same fact
`createSupabaseTransport()` returns null on.)

---

### BUG-2 · A live room is reported as abandoned to a first-time joiner — *Low*

**Where:** `hooks/useMatch.tsx:1663–1665`

When the handshake produces no config, the message is chosen by:

```ts
held || recentRoom()?.roomCode === code
  ? "That room isn't running any more — everyone in it has left."
  : "No room with that code — check the letters and try again."
```

`recentRoom()` reads `lifepatch.mp.recent` from **`localStorage`, which is shared by
every tab on the device.** So when the host's own tab wrote that marker via
`rememberRoom(code)`, a *different* tab joining the *same* code for the *first* time
matches the `recentRoom()` branch and is told everyone has left a room that is, in
fact, open on screen beside it. That is the exact wrong sentence — it invites the
player to give up on a live room.

The reasoning for the branch is sound (a room this device was seated in cannot be a
typo); it just needs to check that *this player* was seated, not that *this device*
touched the code:

```ts
-  held || recentRoom()?.roomCode === code
+  held || (recentRoom()?.roomCode === code && loadMatch(code, selfIdRef.current) !== null)
```

…or, more directly, gate on whether this player id has ever published into the room,
which `held` already answers — in which case the `recentRoom()` clause is only needed
for the lobby-with-no-life case and should carry the same identity check
`loadMatch` performs at `lib/mp/matchStore.ts:98`.

In practice this is masked by **BUG-1** on the dev transport and rare in production
(it needs two tabs on one device); fixing BUG-1 alone will not fix this one.

---

## 4 · Code Quality / Performance

### PERF-1 · `/r/[id]` has no id gate, and spends a render + a DB read per unknown id — *Medium-Low*

**Where:** `app/r/[id]/page.tsx:169–192` vs `app/api/og/[id]/route.tsx:28, 44–47, 172–180`

The OG route documents this exposure at length and mitigates it:

```ts
const UUID_RE = /^[0-9a-f]{8}-.../i;
if (!base || !anon || !UUID_RE.test(id)) return null;   // never reaches Supabase
...
if (!row) return new Response(null, { status: 302, headers: { location: "/opengraph-image", ... } });
```

> *"a stream of random UUIDs never hits cache, and each one cost a Supabase round trip
> plus a full 1200x630 Satori render billed to this origin."*

`/r/[id]` — the page the OG card links to, and the one designed to be hit by
strangers in bulk — has **no equivalent gate.** `generateMetadata` and the page body
both call `getResult(id)` with whatever string is in the path; a non-UUID reaches
PostgREST and comes back as a swallowed `22P02` error. Under
`revalidate = 3600` + `generateStaticParams(): []`, every *distinct* id is an origin
render plus that read, and lands its own ISR cache entry.

**Recommendation** — two cheap changes:

```ts
import { cache } from "react";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_RE = /^local-[a-z0-9]+-[a-z0-9]+$/i;   // the dev id shape, lib/cloud/results.ts

/**
 * One read per request, and only for an id that could name a row. Memoised with
 * React `cache` so `generateMetadata` and the page body share the answer
 * explicitly, rather than relying on fetch memoisation collapsing them.
 */
const readRow = cache(async (id: string) =>
  UUID_RE.test(id) || LOCAL_RE.test(id) ? getResult(id).catch(() => null) : null,
);
```

…then call `readRow(id)` from both. The shape gate is the load-bearing half; the
`cache()` wrapper makes the single-read property a stated guarantee instead of an
implementation detail of Next's request memoisation.

*(Note: `lib/deepLink.ts:RESULT_ID_RE` already bounds this string on the way **in**
from `?vs=`, and its comment correctly calls itself "a sanity gate, not a security
one". This is the same gate applied at the surface that actually pays for the miss.)*

---

### QUAL-1 · Fire-and-forget timers that outlive their component — *Nit*

`components/social/FriendsSheet.tsx:228`, `components/cinematic/landing/FooterColophon.tsx:37`

```ts
window.setTimeout(() => setCopied(false), 2000);
window.setTimeout(() => setFlash(false), 180);
```

Neither is cleared on unmount. Harmless on React 18+ (a state update on an unmounted
component is a silent no-op, and the warning was removed), so this is a consistency
note rather than a defect — the rest of the codebase is meticulous about this
(`useShareUrl` carries an eight-line comment about exactly this class of leak). Worth
a `useRef` + cleanup only if these files are touched for another reason.

---

### QUAL-2 · `npm ci` is a prerequisite the gates don't state — *Nit*

With `node_modules` absent, `npm run typecheck` emits 15 errors that read like real
type defects (`Cannot find module 'react'`, `Parameter 'time' implicitly has an
'any' type`, `Cannot find name 'process'`) and `eslint` dies on a missing
`@eslint/eslintrc`. All are environmental and vanish after `npm ci`. Given how much
of this repo's quality lives in its QA scripts, a one-line precondition in the README
(or a `SessionStart` hook — see the `session-start-hook` skill) would stop the next
reviewer from chasing fifteen ghosts.

---

## Appendix · Areas reviewed and found sound

Listed so a future pass knows what has already been walked, and does not re-derive it.

* **`lib/mp/protocol.ts`** — every inbound field rebuilt rather than passed through;
  numbers clamped; `year < startYear` cross-check present (the forged-`yearIndex`
  cache-poisoning fix); `parsePresence` refuses a row claiming another player's
  status. `flags`/`yearChoices` build on `{}` with `=` assignment, so a `__proto__`
  key is an inert no-op, not prototype pollution. No gap found.
* **`supabase/schema.sql` + migrations 01–10** — `revoke table / grant columns`
  ordering is correct throughout (a column-level REVOKE cannot carve out of a table
  grant); `profiles_public` has the mandatory `revoke all` before its `grant select`;
  `security definer` functions all `set search_path = public` and revoke from
  `public`/`anon` first; `top_results` is deliberately `security invoker` so RLS
  still decides. `qa:rls` re-verifies 16 probes against both the migration path and a
  fresh `schema.sql`.
* **`supabase/functions/profile/index.ts`** — CORS is an explicit origin list, not
  `*`; Postgres error text is logged rather than returned to the player; the rename
  limiter is atomic via `spend_rename_attempt` with a documented fail-open fallback.
* **`lib/runEngine.ts` / `lib/replay.ts`** — clamps at every money boundary; the
  `record`/`yearRecord` shadowing trap is called out in-file; `replayRun` refuses on
  any desync rather than interpolating; `verifyResult` is honestly described as a
  self-check and not an attestation, on the page that renders it.
* **`lib/metrics.ts`** — the correct reading of untrusted jsonb (`typeof v === "number"`,
  never `Number.isFinite(Number(v))`), validate-whole-then-cap, and all-or-nothing
  series so a hole cannot re-date every later year. `qa:metrics` polices the readers.
* **Injection surface** — no `dangerouslySetInnerHTML`, `innerHTML`, `eval`,
  `new Function`, `document.write`, `window.open`, or `location.href =` anywhere in
  the tree. The single concatenated query grammar (`listEdges`' PostgREST `.or()`)
  carries a `UUID_RE` guard and an in-file note explaining why.
* **Secrets** — no hardcoded credential; `SERVICE_ROLE` appears only inside
  `supabase/functions/`; `.env.local.example` explicitly warns against pasting a
  `sb_secret_…` key into a `NEXT_PUBLIC_*` var.

---

*Generated by [Claude Code](https://claude.ai/code)*
