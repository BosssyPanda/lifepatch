# LifePatch — Codebase Review, 2026-09-14

Full-tree pass for security vulnerabilities, functional bugs and performance
issues. Scope: `app/`, `lib/`, `hooks/`, `components/`, `src/`, `supabase/`
(schema, migrations, Edge Functions), build config and the dependency tree.

## Headline

**No critical security vulnerability was found.** The obvious classes are all
closed, and closed deliberately rather than by accident:

- No `dangerouslySetInnerHTML`, `eval`, `new Function` or `innerHTML` anywhere
  in the tree. React and Satori both escape; the one player-authored string that
  reaches another player's screen (`username`) is charset-locked in three places
  at once (`USERNAME_RE`, the `profiles_username_charset` CHECK, and the
  `profile` Edge Function as sole writer).
- No secrets in the repo. `.env*.local` is gitignored, only `NEXT_PUBLIC_*` keys
  are referenced client-side, and `.env.local.example` explicitly warns against
  pasting a `sb_secret_` key into a `NEXT_PUBLIC_` var.
- RLS is thorough and — unusually — the **grants** are handled too, which is the
  half most projects miss. `revoke insert on public.results` followed by a
  five-column `grant insert (...)` is the correct shape; so is the
  `profiles_public` read-only lockdown in migration 08.
- Untrusted input has real parsers rather than casts: `lib/mp/protocol.ts`
  rebuilds every field, `lib/metrics.ts` refuses `Number(null) === 0`-style
  coercions, `lib/challenge.ts` shape-guards player-writable storage.
- The one place a query grammar is built by concatenation
  (`friends.listEdges`'s `.or(...)`) is guarded by a UUID regex before the
  interpolation.

What follows is what did turn up, most consequential first. Two findings are
real defects with a user-visible failure mode; the rest are hardening and
hygiene.

---

## 1. Functional Bug — `/opengraph-image` can 500, and it is the fallback for every unknown share link

**`app/opengraph-image.tsx:34`**

```ts
export default async function OgImage() {
  const [anton, mono] = await loadFonts();   // no catch anywhere in the file
```

`app/api/og/[id]/route.tsx` goes to considerable lengths never to return a 5xx —
its own comment says *"an unfurl that errors shows a broken card in every chat
client that renders it"* — and it handles a font-read failure by redirecting:

```ts
if (!anton || !plex) {
  return new Response(null, { status: 302, headers: { location: "/opengraph-image" } });
}
```

It also redirects **every unknown `/r/{id}`** to the same URL. So the route that
must never fail hands both its failure path and its unknown-run path to a route
that has no error handling at all. `cachedFonts` memoises on success only and
rethrows on failure (`app/api/og/_fonts/cache.ts:22`), so a transient read fault
propagates straight out of `OgImage`.

The blast radius is wider than one card: `/opengraph-image` is served with
`s-maxage=604800`, and it is deliberately the single URL every unknown id funnels
into so the render happens once. A failure there is the failure of the whole
fallback design, not of one request.

**Fix** — give it the same fallback posture as its caller. A static, fontless
card still beats a 500:

```ts
export default async function OgImage() {
  const fonts = await loadFonts().catch(() => null);
  if (!fonts) {
    // No typeface: draw the frame with the platform default rather than throwing.
    // No cache-control — this is a fault, not a fact, and must not be pinned
    // at the edge for a week.
    return new ImageResponse(<WordmarkFallback />, { width: 1200, height: 630 });
  }
  const [anton, mono] = fonts;
  // ...unchanged
}
```

---

## 2. Code Quality / Performance — `/r/[id]` accepts any id string and caches a page for each one

**`app/r/[id]/page.tsx:23-37, 171, 191`** and **`lib/cloud/results.ts:412`**

The sibling OG route validates the id before it spends anything:

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-...$/i;
if (!base || !anon || !UUID_RE.test(id)) return null;   // app/api/og/[id]/route.tsx:47
```

The page does not. `getResult(id)` goes straight to
`.from("results").select("*").eq("id", id)` with no shape check, and the route is
opted into ISR with `revalidate = 3600` and an empty `generateStaticParams`, so
`dynamicParams` generates and caches an entry for **any** path segment. A
non-UUID id still costs a full Supabase round trip: PostgREST answers
`22P02 invalid input syntax for type uuid`, `getResult` discards the error and
returns `null` on `!data`.

This is the exact amplification the OG route's own comment describes and fixes
("a stream of random UUIDs never hits cache, and each one cost a Supabase round
trip") — left open on the page beside it, where it additionally accumulates ISR
cache entries.

**Fix** — validate at the boundary every reader crosses, which is `getResult`,
matching how `safeVerdict` was hoisted there for the same reason:

```ts
// lib/cloud/results.ts
const CLOUD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getResult(id: string): Promise<ResultRow | null> {
  if (isCloud && supabase) {
    // A cloud row id is a uuid. Anything else cannot match a row, so it is not
    // worth a round trip — and the /r/[id] page caches an ISR entry per id it
    // is asked for. Same gate app/api/og/[id] already applies.
    if (!CLOUD_ID_RE.test(id)) return null;
    // ...unchanged
```

`notFound()` then fires without touching the database. Consider also lowering
`revalidate` for the not-found branch, or pre-checking the id in
`generateMetadata` so the miss costs nothing at all.

---

## 3. Code Quality — `myBest`'s local branch does not apply the `rankable` guard its cloud branch does

**`lib/cloud/results.ts:393-410`**

```ts
// cloud
return (data ?? []).map(fromRow).find(rankable) ?? null;   // skips NaN / Infinity
// local
return rows.reduce((best, r) => (r.score > best.score ? r : best));
```

`rankable` exists because *"Postgres orders NaN ABOVE every real number"* and
because `r.score > prev.score` is false against NaN **in both directions** — the
file says so at line 109. The reduce above inherits exactly that flaw: once a
NaN-scored row is the accumulator, nothing can displace it, and `PersonalBestRow`
renders it as the player's best run. `localStorage` is player-writable, which is
the threat model this file adopts explicitly elsewhere (`readChallenge` in
`lib/challenge.ts` shape-guards for precisely this reason).

**Fix** — one line, and it makes both branches state the same rule:

```ts
const rows = readLocal().filter((r) => r.userId === userId && r.mode === mode && rankable(r));
if (rows.length === 0) return null;
return rows.reduce((best, r) => (r.score > best.score ? r : best));
```

---

## 4. Code Quality / Security Hardening — `top_results` is granted to `anon` with an unbounded `p_limit`

**`supabase/migrations/2026-09-02_10_top_results.sql`**

```sql
create or replace function public.top_results(
  p_mode text, p_limit int default 25, ...
) ...
   limit p_limit;
...
grant execute on function public.top_results(...) to anon, authenticated;
```

The app only ever passes 25 (`DEFAULT_LIMIT`, and `Leaderboard.tsx:269` passes no
`limit` at all), but the function is directly callable by anyone holding the
publishable key. `p_limit` is neither clamped nor sanity-checked, so one RPC call
can ask for the entire deduplicated board. The client-side page-walk this
replaced bounded itself at `MAX_PAGES = 6`; the RPC lost that ceiling.

The inner `distinct on` scans the filtered set regardless, so this is a response-
size amplifier rather than a new scan cost — but it is free to close:

```sql
   limit least(greatest(coalesce(p_limit, 25), 1), 100);
```

Worth pairing with the expression indexes the README mentions as optional
(`(mode, (metrics->>'backgroundId'), score desc)`), since the current plan sorts
every matching row before the limit applies.

---

## 5. Code Quality — dependency advisories

`npm audit --package-lock-only` (run against the committed lockfile; there is no
`node_modules` in this checkout):

| Package | Version | Severity | Advisory | Reachability |
|---|---|---|---|---|
| `fflate` | 0.6.10 | moderate | [GHSA-px8p-9vwx-vf98](https://github.com/advisories/GHSA-px8p-9vwx-vf98) — infinite loop on malformed ZIP64 | **production** tree, via `three-stdlib` → `three`. Not reachable: `unzipSync` is only used by three's asset loaders, and this app's three usage (`BillVortex`, `DiceRollOverlay`, `BoardDiorama`) is procedural geometry with no model loading. |
| `qs` | 6.15.3 | moderate | [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) | **dev-only** (`"dev": true` in the lockfile). No runtime exposure. |

Neither is exploitable in this application today. Both are `npm audit fix`
one-liners and worth clearing so the next genuine advisory is not buried in
noise.

---

## 6. Security Hardening — one premise of the "no `script-src`" decision has already lapsed

**`next.config.ts:16-35`**

The decision to omit `script-src` is well argued and I would not overturn it: a
nonce forces middleware on every route, which costs `/r/{id}` its ISR — and that
route is the one designed to be hit by strangers in bulk. The comment sets its
own trigger for revisiting:

> REOPEN THIS the day any of those premises stops holding — the app renders
> user-supplied markup, **a third-party script is added to the document**, or a
> free-text field reaches another player's screen.

`app/layout.tsx:69-70` mounts `<Analytics />` and `<SpeedInsights />`. Both
inject a `<script>` into the document whose **body is controlled by Vercel** and
served from this origin (`/_vercel/insights/script.js`,
`/_vercel/speed-insights/script.js`) — first-party by path, third-party by
provenance. That is the stated trigger condition, met.

This does not make the current posture wrong, and `connect-src` still does the
load-bearing work of stopping exfiltration. But the comment should either record
that these two are a knowingly-accepted exception, or the premise should be
restated — otherwise the next reader checks the trigger, sees it satisfied, and
has no way to tell whether that was noticed.

Cheap adjacent additions, none of which interact with hydration:

```ts
{ key: "Cross-Origin-Opener-Policy", value: "same-origin" },
{ key: "X-Permitted-Cross-Domain-Policies", value: "none" },
// and widen the existing Permissions-Policy:
{ key: "Permissions-Policy",
  value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
```

---

## Reviewed and found sound

Recording these so the next pass does not re-derive them:

- **Leaderboard integrity.** `results_score_sane`, `results_verdict_known`,
  `results_metrics_small` and the `results_cap_per_player` trigger between them
  close the NaN-takes-first-place, forged-verdict, unbounded-history and
  unbounded-rows holes. The client-side `rankable()` covers rows written before
  the constraints landed. `verified: 1` is honestly labelled on `/r/[id]` as *not*
  a proof against a determined forger.
- **Username screening.** One implementation shared by browser and Edge Function
  (`supabase/functions/_shared/username.ts`), with the three-list structure that
  keeps "Scunthorpe" and "titan-grape" out of the false-positive bucket, and a QA
  gate over the lists.
- **Rename limiter.** Correctly atomic after migration 09
  (`spend_rename_attempt` does read and write in one `UPDATE` under the row lock);
  the `decideRenameAttempt` fallback fails open for a defensible, stated reason;
  the RPC is revoked from `public`/`anon`/`authenticated` and granted only to
  `service_role`.
- **CSPRNG placement.** `randomIndex` uses `crypto.getRandomValues` with modulo-
  bias rejection, and it is on `generateFriendCode` — the actual capability token
  — rather than only on the lobby code.
- **Multiplayer trust model.** `lib/mp/protocol.ts` rebuilds every inbound field;
  `useMatch`'s `status`/`snapshot` handlers fail **closed** on the session fence
  once presence has seated an owner, check roster membership, and bound the tick
  clock by what the room can be *shown* to have reached. The residual gap — a
  peer who knows the room code can hand a rejoining player a well-formed
  alternative life — is inherent to a serverless room, is documented in-line, and
  is not an escalation over what a player can already post to their own row.
- **Engine determinism.** One PRNG home (`lib/rng.ts`), the journal's
  `y[i] === startYear + i` identity check in `hasFullJournal`, and `replayRun`
  returning `null` rather than interpolating on any desync.

## Suggested order of work

1. **#1** — one `.catch` and a fallback card. Highest ratio of user-visible
   breakage prevented to lines changed.
2. **#2** — one regex in `getResult`.
3. **#5** — `npm audit fix`, then re-run to confirm clean.
4. **#3**, **#4**, **#6** — batch into a hardening pass.
