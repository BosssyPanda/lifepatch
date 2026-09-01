# LifePatch — Codebase Review (bugs, performance, security)

**Date:** 2026-09-01 · **Commit reviewed:** `claude/eager-cori-djt022` @ `main` parity
**Scope:** app/, lib/, hooks/, src/, components/, supabase/ (schema, migrations, Edge Functions), scripts/, build config, dependencies.

---

## Executive summary

This codebase is already hardened well beyond the norm, and the review should say so
before it lists anything. Every gate the project ships passes on this tree:

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `eslint .` | clean |
| `npm audit` (737 deps) | 0 vulnerabilities, all severities |
| `qa:engine` | 34/34 |
| `qa:rls` (16 attack probes, migrated **and** fresh schema) | pass |
| `qa:username` (1728 generated + 46 fixtures) | pass |
| `qa:cloud` / `qa:metrics` / `qa:challenge` / `qa:rename` / `qa:transport` | 16/16, 19/19, 10/10, 12/12, 11/11 |
| Committed secrets (`sb_secret_`, `service_role`, JWTs, PEM, AWS, Slack) | none found |

The trust boundaries that usually leak in a game with a public leaderboard —
client-written scores, RLS column grants, username screening, friend-code
enumeration, wire parsing — are all closed, tested, and documented in-line.

**No critical, remotely-exploitable vulnerability was found.** The security findings
below are (1) a mitigation that is weaker than the code's own comment claims,
(2) missing rate limits, and (3) hardening/latent-risk items. They are ranked by
severity, most serious first, exactly as requested — but the honest headline is that
S1 is the only one I would schedule work for this sprint.

---

## Bucket 1 — Security

### S1 · HIGH · `connect-src` does not prevent exfiltration; the allow-listed origin *is* the exfiltration channel

**Files:** `next.config.ts:32`, `next.config.ts:92-101`; `lib/supabase.ts:8`; `supabase/schema.sql:212-213,227`

The CSP deliberately omits `script-src`, and the file's header argues this is
acceptable because `connect-src` closes the half that matters:

> *"it does not stop an injected script from running, but it does stop one from phoning home, and exfiltration is the part of an injection that actually hurts a player."*

**That conclusion does not hold, and the reason is in this repo's own schema.** The
policy resolves to:

```
connect-src 'self' https://<ref>.supabase.co wss://<ref>.supabase.co
```

An injected script needs no third-party host. It has, entirely inside the allow-list:

1. **The victim's session, in readable storage.** `lib/supabase.ts:8` sets
   `persistSession: true`, so the access + refresh token sit in `localStorage`
   under `sb-<ref>-auth-token`, readable by any same-origin script.
2. **A public, writable dead-drop on the allowed origin.** `results.metrics` is
   client-written `jsonb` with no key constraints and an 8 KiB budget
   (`schema.sql:212-213`), and `results` is `for select using (true)`
   (`schema.sql:227`). So the script can `insert` the stolen token — or anything
   else it scraped — into its own row, and the attacker reads it back from
   anywhere holding the publishable key. Nothing leaves the allow-list.
3. **Direct account takeover without any exfiltration at all.** With the session in
   hand the script can act as the user against Supabase directly: delete their
   `results`, overwrite their `saves`, rename them via the `profile` function.

So `connect-src` here buys defence against a *lazy* injection that posts to
`evil.com`, and essentially nothing against a targeted one. The comment should not
be relied on as the reason not to build the nonce pipeline.

**Recommendation** — the real fix is the `script-src` the file defers. Next 15
supports it via middleware:

```ts
// middleware.ts
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,       // Tailwind/next-font inline styles
    `img-src 'self' data: blob:`,             // QR + share canvas
    `font-src 'self'`,
    `worker-src 'self' blob:`,                // Tone.js
    `object-src 'none'`, `base-uri 'self'`,
    `frame-ancestors 'none'`, `frame-src 'none'`, `form-action 'self'`,
    connectSrc(),
  ].join("; ");
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}
export const config = { matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }] };
```

Roll it out `Content-Security-Policy-Report-Only` first — `three`/`@react-three`,
`tone` and the Satori OG route are the three most likely to need a `worker-src` or
`blob:` allowance. Two cheaper partial mitigations, worth taking regardless:

- Add `default-src 'self'` to the existing policy today. It costs nothing (every
  fetch destination the app uses is already `'self'` or Supabase) and closes
  `img-src`, `font-src`, `media-src`, `worker-src` and `manifest-src` in one line.
- **Amend the comment at `next.config.ts:5-20`** so the next reader does not inherit
  the overstated claim. This is the cheapest fix in the report and arguably the
  most valuable: a security control documented as stronger than it is will not get
  revisited.

---

### S2 · MEDIUM · No write-rate limit on `results`; the cap trigger makes each abusive insert progressively more expensive

**Files:** `supabase/schema.sql:276-325`; `lib/cloud/results.ts` (`submitResult`)

`results_cap_per_player` bounds *storage* at 500 rows per (player, mode). It does
not bound *write volume*, and nothing else does either — an authenticated account
can `insert` at PostgREST as fast as the network allows. Each insert fires a
`BEFORE INSERT ... FOR EACH ROW` trigger that runs:

```sql
select count(*) - cap + 1 ...   -- schema.sql:287, index scan over the player's rows
select r.id ... order by r.score desc, r.created_at, r.id limit 1
delete from public.results ...
```

Once a player is at the cap this is a count + a sort + a delete on **every** insert,
so the steady-state cost per abusive write is at its maximum, not its minimum. One
free account is enough to generate sustained database load on a project with no
per-user quota. This is a cost/availability issue, not a data-integrity one — the
cap and the CHECKs hold throughout.

**Recommendation** — a cheap durable limiter, in the same shape the rename limiter
already uses (`supabase/functions/_shared/renameLimit.ts` is a good model: pure
decision function, database-backed counter, testable without a JWT). Simplest
version, no new table:

```sql
-- inside results_cap_per_player(), before the cap logic
declare recent int;
begin
  select count(*) into recent
    from public.results r
   where r.user_id = new.user_id
     and r.created_at > now() - interval '1 minute';
  if recent >= 20 then
    raise exception 'rate limited' using errcode = '53400';
  end if;
```

20/minute is ~100× any honest play rate (a Story run is 21 years of real decisions).
Pair it with a partial index on `(user_id, created_at desc)` so the probe is O(log n).

---

### S3 · LOW · The whole player base is enumerable by an anonymous caller

**Files:** `supabase/schema.sql:145-154` (`profiles_public`), `schema.sql:227` (`results - public read`)

`profiles_public` runs `security_invoker = off` and is granted to `anon`, with no row
limit — so anyone with the publishable key (i.e. anyone who views source) can page the
entire table: `id`, `username`, `avatar_seed`, `created_at`. `results` being
`using (true)` supplies the same `user_id` set independently.

The schema's own comment explains at length why `friend_code` was removed from this
view — because enumerability "voids the one property the friends feature rests on".
Worth being explicit that the *directory itself* is still fully enumerable; what the
view protects is only the capability token, not the membership list.

This is **defensible and probably intended** — the data is pseudonymous by design
(no real names, no PII, no chat, generated usernames), and a public leaderboard has
to publish names. Recording it so the decision is explicit rather than incidental:

**Recommendation** — either document it as accepted in the schema comment, or, if the
membership list is meant to be private, move leaderboard name resolution behind an
RPC that takes a bounded `uuid[]` and returns at most `array_length` rows, and revoke
`select` on the view from `anon`. `getProfiles` (`lib/cloud/profiles.ts`) already
calls with a bounded id list, so the client change is small.

---

### S4 · LOW · Module-level Supabase client is shared across server requests

**File:** `lib/supabase.ts:8`, consumed by `app/r/[id]/page.tsx` (server component) via `lib/cloud/results.ts`

```ts
export const supabase = url && anon
  ? createClient(url, anon, { auth: { persistSession: true, detectSessionInUrl: true } })
  : null;
```

This module is imported by a **server** component, so one client instance — carrying
auth options designed for a browser — is shared by every request the Node/edge
process serves. It is **not exploitable today**: `detectSessionInUrl` is inert with no
`window`, `persistSession` falls back to in-memory storage, and no server path ever
authenticates, so the session stays empty and every read is anonymous.

It is a latent footgun. The day someone adds a server-side authenticated read, one
request's session becomes process-global.

**Recommendation** — split the export so server callers cannot pick up the browser
client by accident:

```ts
// lib/supabase.ts — browser singleton, unchanged
export const supabase = /* ... persistSession: true ... */;

// lib/supabaseServer.ts — per-call, no session machinery
export function serverClient() {
  return url && anon
    ? createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
}
```

and point `getResult`'s server callers at `serverClient()`.

---

### S5 · LOW · `http://localhost:3000` is in the production Edge Function CORS allow-list

**File:** `supabase/functions/profile/index.ts:98-103`

`ALLOWED_ORIGINS` ships with the dev origin included, so the deployed function
returns `Access-Control-Allow-Origin: http://localhost:3000` to any page served from
there. Not exploitable on its own — the JWT travels as an `Authorization` header, not
a cookie, so no browser attaches it cross-origin, which is exactly the reasoning the
file already gives for why the previous `*` was not exploitable either. But it is the
same standing invitation the file removed `*` to avoid.

**Recommendation** — gate it on the environment rather than hardcoding it:

```ts
const ALLOWED_ORIGINS = [
  "https://lifepatch-nine.vercel.app",
  "https://lifepatch.app",
  ...(Deno.env.get("ALLOW_LOCALHOST") === "1" ? ["http://localhost:3000"] : []),
];
```

---

## Bucket 2 — Functional bugs

### B1 · `YearRecord.cashFlow` charges a debt minimum that was never paid

**File:** `lib/runEngine.ts:876` (with `lib/runEngine.ts:826-838`)

```ts
cashFlow: Math.round(takeHome - expenses - ms.payment - due),
```

`due` is what the lender *demanded* (`debtMinimum(debt)`), not what was collected.
Lines 826-838 show the actual collection is `fromCash + forcedSale`, which is less
than `due` whenever the player has neither cash nor holdings — the shortfall rolls
forward as debt instead. The field's own comment says it is *"what actually left the
account this year"*, so the intent is unambiguous and the arithmetic does not match it.

**Measured** on 1,200 headless Story runs (6 backgrounds × 200 seeds, a plausible
"invest 60 % of spare cash" policy, 12,600 run-years):

- 8,400 run-years (66.7 %), concentrated in **400 runs** — the debt-heavy backgrounds,
  where the minimum is never affordable in any year.
- Largest single-year overstatement: **$43,059**.
- 0 run-years where the minimum was met by forced sale, so the second-order question
  (should a liquidation count as an income outflow?) does not arise in practice.

**Currently invisible.** A full-tree grep shows `YearRecord.cashFlow` has exactly
three references: the type (`runEngine.ts:75`), this write, and the wire re-validation
in `lib/mp/protocol.ts:373`. **No UI, report, chart or scoring path reads it.** So
today this is a wrong number in a dead field that is nonetheless serialised into
every multiplayer snapshot. The hazard is the first reader — a year-by-year cash-flow
column on the report is an obvious future feature, and it would ship wrong.

**Recommendation** — record what was collected:

```ts
  // ...
  let forcedSale = 0;
  let paid = 0;                                    // ← add
  const due = debtMinimum(debt);
  if (due > 0) {
    const fromCash = Math.min(cash, due);
    cash -= fromCash;
    const short = due - fromCash;
    if (short > 0 && after > 0) { /* ...unchanged... */ }
    debt -= fromCash + forcedSale;
    paid = fromCash + forcedSale;                  // ← add
  }
  // ...
  cashFlow: Math.round(takeHome - expenses - ms.payment - paid),
```

Two notes on doing this safely:

- This changes recorded history, so it wants a **`RUN_VERSION` bump** (6 → 7 precedent
  is already in the file header) — or, if invalidating live saves is not worth it for
  a field nothing reads, delete the field instead and re-add it correctly when a
  reader exists. Deleting is the smaller change and I would lean that way.
- Either way it does **not** affect determinism, scores, verdicts or
  `golden-draws.json`: `paid` is derived from values `advanceYear` already computes,
  and nothing downstream consumes `cashFlow`.

### B2 · `accept()` does not shape-check `friendId`, unlike its sibling

**File:** `lib/cloud/friends.ts` (`accept`, vs. the `UUID_RE` guard in `listEdges`)

`listEdges` validates `userId` against `UUID_RE` before interpolating it into a
PostgREST `.or()` filter expression, with a good comment about why. `accept` passes
`friendId` straight into an upsert body with no such check. This is **not** injectable
— a value in a JSON body is a value, not grammar, and a non-uuid simply makes Postgres
error and `accept` return `false`. It is an asymmetry worth closing so the file's own
rule holds uniformly.

**Recommendation** — `if (!UUID_RE.test(friendId)) return false;` at the top of `accept`.

---

## Bucket 3 — Code quality / performance

### P1 · `topResults` can issue 6 sequential round-trips behind unindexed JSON filters

**File:** `lib/cloud/results.ts:261-311`

The dedupe-to-best-per-player walk is `MAX_PAGES = 6` pages of `limit * 5` rows,
awaited **serially** (`results.ts:301`) — up to 750 rows and 6 sequential RTTs to
render 25 names. Two of the filters run on expressions with no index:

- `metrics->>backgroundId` (`results.ts:273`) — the comment acknowledges this
  ("Unindexed by design… README carries the optional expression index").
- `metrics->>daily` (`results.ts:274`) — **not** covered by that note, and it is the
  Daily Ledger board's only filter, so it is the hottest of the two.

At current scale this is fine. It degrades super-linearly: more rows per player means
more pages *and* a more expensive scan per page.

**Recommendation** — add both expression indexes, and make the `daily` one partial so
it stays small:

```sql
create index concurrently if not exists results_bg_idx
  on public.results (mode, (metrics->>'backgroundId'), score desc);

create index concurrently if not exists results_daily_idx
  on public.results ((metrics->>'daily'), score desc)
  where metrics ? 'daily';
```

The deeper fix, when it is worth a migration, is a `distinct on (user_id)` RPC —
Postgres can do the per-player dedupe in one round trip, which removes the paging
loop entirely.

### P2 · `images: { unoptimized: true }` disables Next's image pipeline globally

**File:** `next.config.ts:105`

Every asset under `public/` (notably `board3d/board-poster.jpg`,
`img/atlas-engraving.webp`, `film/*-poster.jpg`) ships at full size with no
responsive `srcset` and no AVIF/WebP negotiation. On Vercel the loader is available
at no config cost.

**Recommendation** — drop the flag and let `next/image` handle it, or, if it was set
to keep the export static, scope it: pre-generate 2–3 widths for the posters and give
each `<Image>` an explicit `sizes`. Measure first — this is the kind of thing worth a
Lighthouse run on `/` before and after, since the landing page carries the heaviest
media.

### P3 · The rejection-sampling bound in `randomIndex` is off by one value

**File:** `supabase/functions/_shared/generate.ts` (`randomIndex`)

```ts
const limit = Math.floor(0xffffffff / bound) * bound;
```

`Uint32Array` values span `0 … 0xffffffff`, i.e. `2**32` values, so the correct
divisor is `0x100000000`. **The output is still perfectly uniform** — `limit` is a
multiple of `bound` either way — it just rejects up to `bound` more draws than
necessary (e.g. 16 extra for `randomIndex(16)` in `generateAvatarSeed`). Cosmetic, and
noted only because the surrounding comment reasons carefully about uniformity and a
future reader may check the arithmetic.

Separately, the 16-attempt fallback (`return buf[0] % bound`) is a silently biased
path. The probability of reaching it is below `2**-500` for every bound used here, so
it is unreachable in practice; a `throw` would be more honest than a biased value, but
this is genuinely a nit.

**Recommendation** — `const limit = Math.floor(0x100000000 / bound) * bound;`

---

## Things checked and found sound

Recording these so a future review does not re-tread them:

- **Wire parsing** (`lib/mp/protocol.ts`) — every inbound field rebuilt, clamped and
  version-gated; `year < startYear` cross-check present; roster deduped before use.
- **RLS + column grants** — table-level `insert`/`update` traded for column lists on
  both `profiles` and `results`, in the correct order (a column REVOKE cannot carve an
  exception out of a table grant). Verified by `qa:rls` against a fresh schema *and* a
  migrated one.
- **Untrusted-JSON reads** (`lib/metrics.ts`) — `typeof`-based guards, series validated
  whole before capping, `finiteColumn` vs `finiteNumber` split is correct.
- **Verdict/score constraint pairs** — DB CHECK plus `safeVerdict()` reader guard, so
  pre-constraint rows are handled too.
- **OG route** (`app/api/og/[id]/route.tsx`) — UUID-validated before interpolation,
  2.5 s abort, 302-to-static for unknown ids, independent catch per half.
- **Deep links** (`lib/deepLink.ts`) — single-consume, regex-bounded, params stripped
  from the address bar.
- **Timer/listener hygiene** — `addEventListener` 17 / `removeEventListener` 18;
  the one `requestAnimationFrame` without a cancel
  (`components/run/LifeEventCard.tsx:250`) is a single-frame focus call with optional
  chaining, not a loop.
- **`Math.min(...array)` spreads** (7 sites) — every input is bounded (`MAX_SERIES`
  200, run history by run length), so no stack-overflow path.
- **Secrets** — nothing committed; `.gitignore` covers `.env*.local`;
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` is the publishable key and correctly public.

---

## Suggested order of work

1. **S1** — amend the `next.config.ts` comment today (5 minutes, stops the
   overstatement propagating); add `default-src 'self'` (1 line); schedule the nonce
   pipeline behind `Report-Only`.
2. **S2** — insert-rate limit on `results`.
3. **B1** — decide *delete* vs *fix + version bump*; deleting is smaller.
4. **P1** — the two expression indexes (pure win, no code change).
5. S3–S5, B2, P2, P3 as cleanup.
