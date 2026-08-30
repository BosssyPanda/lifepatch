# LifePatch — codebase review, 2026-08-30

Scope: every file under `app/`, `lib/`, `hooks/`, `src/`, `components/`,
`supabase/` and `scripts/`, plus `next.config.ts`, `package.json` and the
dependency tree. Automated gates were run against a clean `npm ci`:

| Gate | Result |
| --- | --- |
| `npm audit` | 0 vulnerabilities across 737 packages |
| `npx tsc --noEmit` | clean |
| `npx eslint .` | clean |
| `npm run qa:engine` (34 property checks) | 34/34 passed |
| `npm run qa:username` | passed — 1728 generated names accepted, 24 abusive refused |

**Headline: no critical security vulnerability was found.** No hardcoded
secrets, no injection sink (every PostgREST filter that concatenates a value
validates it against a UUID or room-code regex first), no `dangerouslySetInnerHTML`
or `eval`, no outdated dependency with a known CVE. The prior hardening passes
visible in the git log — RLS lockdown, column-level grants, the verdict/score
CHECK constraints, the server-side username gate, the wire parser in
`lib/mp/protocol.ts` — hold up under reading.

What follows is what is left, in priority order. The first three are real and
worth fixing; the rest are hygiene.

---

## 1. Functional Bug — `results.created_at` is client-written, so the weekly board can be held forever

**File:** `supabase/schema.sql:213-218` (the `results` policies); no migration
narrows the grant.

The `results - insert own` policy constrains **whose row** you write and says
nothing about **which columns**. Supabase's default privileges hand
`authenticated` table-wide INSERT — the repo already knows this and says so in
`supabase/migrations/2026-08-28_04_write_surface.sql:82-84`, where exactly this
reasoning was applied to `profiles`. It was never applied to `results`.

So a signed-in player can post straight at PostgREST with `created_at` set to
any value they like:

```json
{ "user_id": "<own id>", "mode": "story", "score": 999999999999,
  "verdict": "Financially Free", "created_at": "2099-01-01T00:00:00Z" }
```

`topResults` filters the weekly board with `gte("created_at", weekAgoIso())`
(`lib/cloud/results.ts:187`), so a far-future timestamp is inside every future
week: the row takes permanent first place on "This week" and no honest run can
age it out. The same insert can name any `metrics.daily` value, so it also tops
any past or future Daily Ledger board (`lib/cloud/results.ts:194`). `id` is
writable for the same reason, which lets a player choose the `/r/{id}` slug their
statement is served from.

This is the same class of hole the `profiles` lockdown closed, and it has the
same fix — a table grant traded for a column list:

```sql
-- supabase/migrations/2026-08-30_06_results_write_surface.sql
revoke insert on public.results from authenticated;
revoke insert on public.results from anon;
grant insert (user_id, mode, score, verdict, metrics)
  on public.results to authenticated;
```

`id` and `created_at` then fall to their column defaults, which is what every
honest write already relies on — `submitResult` (`lib/cloud/results.ts:130-142`)
sends neither, so no client change is needed. Note the ordering constraint the
other migrations carry: this one is safe to apply at any time, because nothing in
the build ever wrote those two columns.

---

## 2. Functional Bug — a finished run is marked "submitted" before the write succeeds, so a network blip loses it permanently

**File:** `lib/cloud/buildResult.ts:146-157`

```ts
if (!playerId || alreadySubmitted(runKey)) return;
markSubmitted(runKey); // optimistic: synchronous, so re-fires within a mount no-op
try {
  await ensureProfile(playerId);
  await submitResult(playerId, result);
  await bumpStreak(playerId);
} catch {}
```

`markSubmitted` writes the run key to localStorage **durably** and is never
rolled back. The comment justifies the ordering against a re-fire inside one
mount, which it does solve — but the durable half means that any failure in the
three awaits (offline, expired session, RLS refusal, a 500 from the Edge
Function) permanently marks the run as posted. The player finishes a 21-year
story run, the insert fails, and the run is never posted again from that browser:
no leaderboard row, no share URL, no streak bump, and nothing on screen says so.

This is also the one write path in the file that still swallows its error, which
is precisely the asymmetry `lib/saves.ts:41-56` documents and fixed for saves.

**Fix** — keep the synchronous guard against a re-entrant call, but release it
when the work did not land:

```ts
export async function submitRunOnce(
  runKey: string,
  playerId: string | null,
  result: NewResult,
): Promise<boolean> {
  if (!playerId || alreadySubmitted(runKey)) return false;
  markSubmitted(runKey); // in-flight guard against a re-fire inside one mount
  try {
    await ensureProfile(playerId);
    await submitResult(playerId, result);
    await bumpStreak(playerId);
    return true;
  } catch {
    // The mark is durable, so leaving it after a failed write costs the player
    // the run for good. Release it: the next mount retries.
    unmarkSubmitted(runKey);
    return false;
  }
}
```

with a matching `unmarkSubmitted` beside `markSubmitted` in
`lib/cloud/results.ts:299`. Callers that want to surface the failure now can.

---

## 3. Code Quality / Performance — `/api/og/{id}` renders an uncached image per unknown UUID

**File:** `app/api/og/[id]/route.tsx:36-56`, `:149`

The route is unauthenticated and takes any well-formed UUID. A **known** id is
cheap after the first hit — `s-maxage=86400`. An **unknown** id is not: it costs
one Supabase REST round trip plus a full Satori render of the fallback wordmark
card, served under `max-age=0, s-maxage=60`. The short TTL is deliberate and
correct (the comment explains why: a link shared before its row lands must not
pin the wrong card), but it means a stream of random UUIDs never hits cache. Each
one is a database read and a 1200×630 render billed to this origin.

The underlying `fetch` also has no timeout, so a slow Supabase holds an edge
invocation open until the platform's own limit.

**Recommendation** — two cheap mitigations, neither of which changes the
correct-case behaviour:

```ts
// 1. Bound the upstream call.
const res = await fetch(url, {
  headers: { apikey: anon, authorization: `Bearer ${anon}` },
  signal: AbortSignal.timeout(2500),
});

// 2. Serve the fallback as a redirect to the static wordmark image rather than
//    rendering it, exactly as the missing-font path already does (`:128`).
//    A 302 costs no Satori render and no CPU:
if (!row) {
  return new Response(null, {
    status: 302,
    headers: { location: "/opengraph-image", "cache-control": "public, max-age=0, s-maxage=60" },
  });
}
```

The 302 keeps the 60-second TTL semantics (a scraper that follows it re-checks on
the same schedule) while removing the render entirely from the abusable path.

---

## 4. Code Quality — two cloud writes still discard their `{ error }`

**Files:** `lib/cloud/streaks.ts:77`, `lib/cloud/mastery.ts:103`

```ts
await supabase.from("streaks").upsert({ ... }, { onConflict: "user_id" });
return next;                       // ← the error is never read

await supabase.from("mastery").upsert(rows, { onConflict: "user_id,concept_id" });
return gains;                      // ← same
```

supabase-js resolves rather than rejects on a failed request, so both of these
report success on an RLS refusal, an expired session or a network failure. Both
then return the *computed* next value, so the UI shows a streak that advanced and
concepts that levelled up while the database holds neither — and the next read
silently reverts them.

`lib/saves.ts:41-56` states the house rule on this explicitly and `submitResult`
follows it. These two are the remaining exceptions.

**Fix:** destructure and act on `error` — throw for streaks (the caller in
`submitRunOnce` already has a `catch`), and for mastery return the gains with a
flag, or throw, so the Money Brain does not animate a level the server refused.

---

## 5. Code Quality — no upper bound on `streaks.current` / `streaks.longest`

**File:** `supabase/schema.sql:221-236`

`results.score` got `results_score_sane` for a well-documented reason
(`2026-08-27_01b_score_bounds.sql`). `streaks` never did: `current` and `longest`
are plain `int` under an update-own policy, and `streaks` is **publicly
readable** by design ("so friends can see each other's streaks"). A player can
PATCH their own row to `2147483647` and it renders in `StreakChip` and beside
their leaderboard row.

Impact is cosmetic — nothing ranks on it — so this is integrity hygiene, not a
vulnerability. But it is the same shape as the score bound, and it is one line:

```sql
alter table public.streaks
  add constraint streaks_sane check (
    current between 0 and 100000
    and longest between 0 and 100000
    and longest >= current
  );
```

`mastery.level` (`supabase/schema.sql:300`) has the same gap. Its blast radius is
smaller — the table is read-own-only, so a forged level is visible to nobody but
its author — but `check (level between 0 and 5)` mirrors `MAX_MASTERY_LEVEL` in
`lib/cloud/mastery.ts:12` and costs nothing.

---

## 6. Code Quality — response headers: HSTS is missing, and the `profile` function answers any origin

**Files:** `next.config.ts:35-58`, `supabase/functions/profile/index.ts:62-66`

`SECURITY_HEADERS` is a considered set and the comment above it is honest about
what the CSP does and does not do. One header that costs nothing is absent:

```ts
{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
```

Separately, the `profile` Edge Function replies `Access-Control-Allow-Origin: "*"`.
This is not exploitable today — `verify_jwt` refuses anything unsigned, the token
is a `Authorization` header rather than a cookie, so no browser sends it
cross-origin implicitly — but `*` means any page that *does* obtain a token can
drive the function. Naming the app origin is strictly better and no harder:

```ts
const ALLOWED = new Set([Deno.env.get("APP_ORIGIN") ?? "", "http://localhost:3000"]);
const origin = req.headers.get("Origin") ?? "";
const CORS = {
  "Access-Control-Allow-Origin": ALLOWED.has(origin) ? origin : "null",
  "Vary": "Origin",
  // ...unchanged
};
```

Worth noting alongside it: `rename` has no rate limit, and its 409 ("That name is
taken") is distinguishable from its 400, which makes the username space
enumerable one request at a time. Low value to an attacker on a pseudonymous
board, but it is the surface a squatting script would use.

---

## 7. Code Quality — `results` rows are unbounded per user

**File:** `supabase/schema.sql:163-219`

`saves` is bounded by `unique (user_id, mode)` and by `saves_state_small`.
`results` is bounded per-row (`results_metrics_small`, 8 KiB) but not per-user:
one authenticated account can insert rows indefinitely. There is no cost ceiling
and nothing prunes.

This is a storage-and-bill concern rather than a data-integrity one, and it
interacts with §1: forged rows are also unlimited rows. A `before insert` trigger
capping rows per `(user_id, mode)`, or a periodic prune of everything but each
player's best N runs per mode, closes it. Given that `topResults` only ever shows
each player's single best run, keeping the rest is already close to free storage
with no reader.

---

## Things deliberately **not** flagged

Several patterns look alarming and are, on reading, correct and documented:

- **Client-authored `score` and `verdict`.** There is no server simulation, and
  `lib/replay.ts` is explicit that its check "cannot prove anything about a client
  that was modified to write both halves". The `results_verdict_known` CHECK and
  the `safeVerdict` reader guard close the part that mattered (an official-looking
  statement minted on this origin); the rest is a stated design limit, not an
  oversight.
- **Peer-to-peer multiplayer with no authority.** `lib/mp/protocol.ts` rebuilds
  every inbound `RunState` field by field with clamps, refuses foreign protocol
  and engine versions, and fences per-session seats. `hooks/useMatch.tsx` bounds
  the authorless `tick` message by what the roster can be shown to have reached.
  The residual trust in room members is named in the code as out of scope by
  contract.
- **`profiles_public` running with `security_invoker = off`.** Deliberate and
  load-bearing; the view projects four columns and `friend_code` is not among them.
- **`.or()` string concatenation in `lib/cloud/friends.ts:163`.** Guarded by a
  UUID regex on the line above, with a comment explaining exactly why the guard
  is there rather than assumed.
- **CSP with no `script-src`.** A stated scope call — a nonce pipeline through
  Next hydration is real work — and `connect-src` is derived from the same env
  var the client is built against, which is the half that matters for
  exfiltration.
- **`scripts/qa/rls-migration.mjs` shelling out via `sh -c`.** Every interpolated
  value is a module-level constant; it is a dev-only gate and never sees input.
