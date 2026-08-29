# LifePatch — Codebase Review, 2026-08-29

Scope: every file under `app/`, `components/`, `hooks/`, `lib/`, `src/`, `supabase/`,
`scripts/`, plus `next.config.ts`, `package.json` and the dependency tree.

**Headline: there is no critical security vulnerability in this codebase.** The
obvious classes are already closed — no hardcoded secrets, no `eval` /
`dangerouslySetInnerHTML` / `innerHTML` anywhere in app code, no SQL or PostgREST
filter built from unvalidated input (`listEdges` guards its one concatenation with
a UUID regex), RLS on every table, `verdict` and `score` constrained at the
database, and the multiplayer wire format rebuilt field-by-field in
`lib/mp/protocol.ts`. `npm audit` reports 0 vulnerabilities; `tsc --noEmit` and
`eslint .` are both clean.

What follows is ranked by real risk. The security findings are availability/cost
and residual-exposure issues, not compromise paths.

| # | Category | Finding | Location |
|---|---|---|---|
| S1 | Security | Unauthenticated OG render is a cheap-request → expensive-response amplifier | `app/api/og/[id]/route.tsx` |
| S2 | Security | `saves.state` has no size bound (`results.metrics` does) | `supabase/schema.sql:13` |
| S3 | Security | Friend codes minted with `Math.random()`; RPC unthrottled | `lib/cloud/generate.ts:34` |
| S4 | Security | Whole player roster enumerable via `profiles_public` / `results` | `supabase/schema.sql:87,161` |
| S5 | Security | No `Strict-Transport-Security` header | `next.config.ts:8` |
| F1 | Bug | Insolvent years report a cash flow $22k more negative than reality | `lib/runEngine.ts:867` |
| F2 | Bug | A finished run is permanently discarded if the submit request fails | `lib/cloud/buildResult.ts:151` |
| F3 | Bug | Submit dedupe key `mode-seed` is not unique per run | `components/AppShell.tsx:158` |
| F4 | Bug | `useShareUrl` retry timer survives unmount | `components/share/useShareUrl.ts:63` |
| F5 | Bug | Stock sale proceeds round to dollars, purchases settle in cents | `lib/cashflow/engine.ts:255` |
| F6 | Bug | An unwanted friend request can never be declined | `supabase/schema.sql:240` |
| P1 | Perf | Leaderboard pulls up to ~750 full rows (`select("*")`) to render 25 | `lib/cloud/results.ts:156` |
| P2 | Perf | Two full run re-simulations on the main thread when the report mounts | `components/AppShell.tsx:158` |
| P3 | Perf | `metrics->>*` filters are unindexed; the indexes are "optional" in the README | `README.md:44` |
| P4 | Quality | `advanceYear` shadows the module-level `record()` helper | `lib/runEngine.ts:858` |
| P5 | Quality | No CI — the `qa:*` scripts and `supabase/tests/` never run | (repo root) |

---

## Critical Security Vulnerabilities

None found. The four findings below are genuine security issues but sit at
**medium / low** severity: they cost money or leak already-pseudonymous data, they
do not let an attacker read, write or impersonate another player.

### S1 · Unauthenticated image render is an amplification vector — *Medium*

`app/api/og/[id]/route.tsx:110-128`

Two problems compound:

1. **Fonts are re-fetched on every request.** `Anton-Regular.ttf` (167 KB) and
   `IBMPlexMono-Regular.ttf` (132 KB) are read inside `GET`, so every single
   invocation allocates ~300 KB of `ArrayBuffer` before satori starts.
2. **The unknown-id path is deliberately near-uncacheable.** Line 127 sets the
   fallback card to `max-age=0, s-maxage=60`, for the good reason given in the
   comment. But it means an attacker cycling random UUIDs
   (`/api/og/<random-uuid>`) misses the CDN on essentially every request and
   forces, per request: a Supabase REST round-trip, 300 KB of font reads, and a
   full 1200×630 satori render on the edge. `/r/[id]` has the mirror problem —
   `revalidate = 3600` with `generateStaticParams() => []` means each novel UUID
   mints a new ISR cache entry plus a database read.

Nothing here is a breach; it is an unmetered way to run up an edge-compute and
Supabase bill from a single laptop.

**Fix.** Hoist the fonts to a module-scope promise (they are immutable build
assets), and stop rendering the fallback at all — for an id that is not a real row
there is nothing per-run to draw, so redirect to the already-static site card:

```tsx
// module scope — resolved once per isolate, not once per request
const FONTS = Promise.all([
  fetch(new URL("./_fonts/Anton-Regular.ttf", import.meta.url)).then((r) => r.arrayBuffer()),
  fetch(new URL("./_fonts/IBMPlexMono-Regular.ttf", import.meta.url)).then((r) => r.arrayBuffer()),
]);

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Refuse a malformed id before any work at all — no fetch, no fonts, no render.
  if (!UUID_RE.test(id)) return Response.redirect(new URL("/opengraph-image", SITE), 307);
  const [[anton, plex], row] = await Promise.all([FONTS, fetchRow(id)]);
  if (!row) return Response.redirect(new URL("/opengraph-image", SITE), 307);
  // ...real card only from here
}
```

A 307 is cheap, cacheable by every scraper, and still correct: the reason the
fallback could not be cached forever was that it might be replaced by a real
statement — a redirect that the CDN holds for 60s preserves exactly that property
at a fraction of the cost.

### S2 · `saves.state` is an unbounded jsonb column — *Medium*

`supabase/schema.sql:9-16`

```sql
create table if not exists public.saves (
  ...
  state jsonb not null,     -- no size constraint
```

`results.metrics` was correctly bounded (`pg_column_size(metrics) <= 8192`, plus
`results_metrics_history_bounded`) precisely because a client-written jsonb column
is whatever the client sends. `saves.state` never got the same treatment. Any
authenticated account can `upsert` an arbitrarily large blob into its own row —
Postgres accepts up to ~1 GB per jsonb value — and RLS is no defence, because
writing your own row is exactly what the policy permits. A handful of free
accounts is enough to fill the project's storage.

**Fix** (additive, safe to run on a live table):

```sql
-- The largest honest save is a long Infinite run with a full journal: ~30 KB.
-- 64 KiB is twice that and three orders of magnitude below anything that hurts.
alter table public.saves
  add constraint saves_state_small check (pg_column_size(state) <= 65536) not valid;
alter table public.saves validate constraint saves_state_small;
```

Add the matching ceiling in `lib/saves.ts:saveRun` so the player sees "this run is
too large to sync" rather than a bare PostgREST error.

### S3 · Friend codes are minted with `Math.random()` — *Low/Medium*

`lib/cloud/generate.ts:25-38`

```ts
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];   // ← V8 xorshift128+
}
export function generateFriendCode(): string { /* 6 × pick(CODE_CHARS) */ }
```

The friend code is the *only* thing standing behind the property the whole
friends design rests on — "added by code, never by search" (see
`supabase/migrations/2026-08-27_02_profiles_lockdown.sql`). `Math.random()` is a
non-cryptographic PRNG with recoverable state; two accounts registered by the same
attacker leak 14 consecutive draws from it.

The codebase already knows the right answer and applies it one module away —
`lib/mp/roomCodes.ts:9` uses `crypto.getRandomValues` with proper modulo-bias
rejection for room codes, which are *less* security-relevant than friend codes.

Secondly, `profile_by_friend_code` has no rate limit. 31⁶ ≈ 887 M is a large space
in the abstract, but a code only has to collide with *some* player, so the
expected work to hit a live account falls linearly with the player count.

**Fix.** Reuse the existing helper rather than writing a second one:

```ts
// lib/cloud/generate.ts
import { randomIndex } from "@/lib/mp/roomCodes";   // export it from there

export function generateFriendCode(): string {
  let code = "";
  for (let i = 0; i < FRIEND_CODE_LENGTH; i++) code += CODE_CHARS[randomIndex(CODE_CHARS.length)];
  return code;
}
```

Then throttle the RPC — a `security definer` function can count its own calls, or
put the lookup behind a Supabase Edge Function with a per-IP budget. Note the
friends UI is not shipped yet, which makes this the cheapest possible moment to
fix it: migration 03 (`rotate_friend_codes`) says so itself.

### S4 · The whole player roster is enumerable — *Low*

`supabase/schema.sql:87` and `:160-161`

```sql
grant select on public.profiles_public to anon, authenticated;
create policy "results - public read" on public.results for select using (true);
```

Migration 02's own rationale for closing the `profiles` leak was that it "hands out
a full roster of who plays". `profiles_public` re-exposes that roster — every
`id`, `username` and `created_at` — to anyone holding the publishable key, with no
row cap:

```
GET /rest/v1/profiles_public?select=*        # every player who has ever signed up
GET /rest/v1/results?select=user_id          # every player who has ever finished a run
```

This is a smaller harm than the friend-code leak (the data is pseudonymous by
design — no real names, no PII, no chat) and a leaderboard genuinely needs *some*
public read. But an unbounded dump is more than a leaderboard needs.

**Fix.** Set PostgREST's `db-max-rows` (Supabase: Settings → API → Max rows) to
something the app's own queries stay under — the leaderboard's largest page is
`limit * 5 = 125` — so a `select=*` with no filter cannot walk the table. If the
boards later need more, move them behind a `security definer` RPC that takes the
scope as an argument and returns the ranked page, the same shape
`profile_by_friend_code` already uses.

### S5 · No `Strict-Transport-Security` header — *Low*

`next.config.ts:8-14`

The header set is otherwise well chosen and the CSP's omission of `script-src` is
argued for in the comment. HSTS costs nothing and is not in the list:

```ts
{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
```

Vercel terminates TLS and redirects HTTP→HTTPS, so this only closes the
first-request window — but that is the window it exists to close.

---

## Functional Bugs

### F1 · An insolvent year reports a cash flow that is $22,000 too negative — *confirmed by simulation*

`lib/runEngine.ts:821-838, 867`

`advanceYear` computes the lender's minimum, then pays as much of it as the player
can actually cover:

```ts
const due = debtMinimum(debt);
if (due > 0) {
  const fromCash = Math.min(cash, due);
  cash -= fromCash;
  const short = due - fromCash;
  if (short > 0 && after > 0) { forcedSale = Math.min(short, after); /* ... */ }
  debt -= fromCash + forcedSale;      // ← only what was actually paid
}
```

…and then reports the year using `due` rather than what was paid:

```ts
cashFlow: Math.round(takeHome - expenses - ms.payment - due),
```

The comment above that line says "What actually left the account this year". For a
player with no cash and no holdings — the exact profile `isUnrecoverable` is
watching — `fromCash` and `forcedSale` are both 0, nothing leaves the account, and
the year is still reported as if the whole minimum had been paid. Reproduced with
the engine's own arithmetic (`$400k` debt, `$30k` take-home, `$42k` expenses):

```
due: 22000, fromCash: 0, forcedSale: 0, actuallyPaid: 0
reportedCashFlow: -34000    honestCashFlow: -12000    overstated by: 22000
```

This lands on the run screen, the year record, and the `history` series that rides
in `metrics` to `/r/{id}` — and it is wrong specifically on the runs where the
insolvency countdown is on screen and the number matters most.

**Fix:**

```ts
let paid = 0;
const due = debtMinimum(debt);
if (due > 0) {
  const fromCash = Math.min(cash, due);
  cash -= fromCash;
  const short = due - fromCash;
  if (short > 0 && after > 0) { /* forced sale as today */ }
  paid = fromCash + forcedSale;
  debt -= paid;
}
// ...
cashFlow: Math.round(takeHome - expenses - ms.payment - paid),
```

Note this changes recorded `history` values, so `scripts/qa/golden-draws.json`
needs regenerating with `scripts/qa/regen-golden-draws.mjs`. It does **not** move
net worth, so no `RUN_VERSION` bump is needed.

### F2 · A finished run is permanently discarded if the submit fails

`lib/cloud/buildResult.ts:146-158`

```ts
if (!playerId || alreadySubmitted(runKey)) return;
markSubmitted(runKey);            // durable, written to localStorage, BEFORE the network
try {
  await ensureProfile(playerId);
  await submitResult(playerId, result);
  await bumpStreak(playerId);
} catch {}                        // and swallowed
```

`markSubmitted` persists to `localStorage`, so it survives reloads by design. The
consequence is that one dropped connection at the moment a run ends means the run
is never posted, never retried, and the player's streak never bumps — silently and
irreversibly, because the durable flag now says it was submitted.

**Fix.** Keep the durable flag for what it was written for (surviving a reload
*after a success*) and use an in-memory set for the re-entrancy case:

```ts
const inFlight = new Set<string>();

export async function submitRunOnce(runKey: string, playerId: string | null, result: NewResult) {
  if (!playerId || alreadySubmitted(runKey) || inFlight.has(runKey)) return;
  inFlight.add(runKey);           // synchronous: re-fires within a mount still no-op
  try {
    await ensureProfile(playerId);
    await submitResult(playerId, result);
    markSubmitted(runKey);        // durable only once the row actually landed
    await bumpStreak(playerId);
  } finally {
    inFlight.delete(runKey);      // a failure leaves it retryable
  }
}
```

`bumpStreak` after `markSubmitted` is deliberate: a streak that fails to bump is a
smaller loss than a result posted twice.

### F3 · The submit dedupe key is not unique per run

`components/AppShell.tsx:158`

```ts
void submitRunOnce(`${r.mode}-${r.seed}`, id, resultFromRun(r));
```

`seed` is not a run identifier, it is a *world* identifier, and three paths hand
the same world to more than one run:

- **A match run** is `mode: "story"` with the room's shared `config.seed`
  (`hooks/useMatch.tsx:1146`) — so playing the same room twice, or replaying after
  a rejoin, is one key.
- **A daily run** is `mode: "story"` with `dailySeed(date)`, which is a pure
  function of the date (`lib/daily.ts:85`) — deliberate for the one-attempt rule,
  but it means the daily and any other Story run that lands on the same integer
  collide.
- Two solo runs colliding at 1-in-10⁹ is negligible on its own, but it stacks with
  the above.

**Fix.** Mint a per-run id in `initRun` (a `crypto.randomUUID()` on the state,
carried in `metrics`) and key the dedupe on that; the seed then goes back to being
what it is, a description of the world. Failing that, `${r.mode}-${r.seed}-${r.startYear}-${r.history.length}`
at least distinguishes two runs of the same world that ended differently.

### F4 · `useShareUrl`'s retry timer survives unmount

`components/share/useShareUrl.ts:47-69`

```ts
if (attempt < ATTEMPTS) setTimeout(() => void lookup(attempt + 1), RETRY_MS);
// ...
return () => { cancelled = true; };
```

The timer handle is never captured, so the cleanup cannot clear it. `cancelled` is
only checked *after* the query resolves, which means a component unmounted during
the poll still fires up to four more Supabase round-trips — each one an unindexed
`metrics->>seed` filter (see P3). Track and clear it:

```ts
let timer: ReturnType<typeof setTimeout> | null = null;
// ...
if (attempt < ATTEMPTS) timer = setTimeout(() => void lookup(attempt + 1), RETRY_MS);
return () => { cancelled = true; if (timer) clearTimeout(timer); };
```

### F5 · Stock sales round to dollars; purchases settle in cents

`lib/cashflow/engine.ts:226` vs `:255`

```ts
const cost = Math.round(n * price * 100) / 100;   // buy — cents
// ...
cash: s.cash + Math.round(n * price),             // sell — whole dollars
```

`lib/cashflow/selectors.ts:maxAffordable` was deliberately rewritten into integer
cents because a floating-point share count "leaves the engine holding negative
cash, which the next `clampCash` reads as a shortfall and answers with a phantom
$1,000 loan at 10%/mo". The sell path is the same money on the way back out and
still rounds to the dollar, so every round trip silently creates or destroys up to
$0.50. Make it match: `Math.round(n * price * 100) / 100`.

### F6 · An unwanted friend request can never be declined

`supabase/schema.sql:240-241`

```sql
create policy "friends - delete own" on public.friends
  for delete using (auth.uid() = user_id);
```

A request is an edge *them → me*, so `user_id` is the sender. The recipient has no
policy that lets them delete it, and `listIncoming` surfaces only `pending` edges —
so an unwanted request sits in the recipient's list permanently with no way to
clear it. Low severity today only because the friends UI is not shipped.

```sql
create policy "friends - decline incoming" on public.friends
  for delete using (auth.uid() = friend_id and status = 'pending');
```

---

## Code Quality / Performance

### P1 · The leaderboard transfers megabytes to render 25 rows

`lib/cloud/results.ts:153-203`

```ts
let q = supabase!.from("results").select("*")   // ← every column
// ...
const PAGE = limit * 5;    // 125
const MAX_PAGES = 6;       // up to 750 rows
```

`select("*")` includes `metrics`, which is bounded at 8 KiB and routinely carries
a 100-point `history` array plus seed, background and engine build. Worst case is
~6 MB over the wire to draw a board that needs six fields per row. The paging loop
(correctly added to fix the dedupe-starvation bug) multiplies the cost by six.

The board renders `id`, `userId`, `mode`, `score`, `verdict`, `createdAt`, plus
`metrics.verified` for the ✓ mark and `metrics.backgroundId` for the filter — so
name the columns and project the two fields you need:

```ts
.select("id,user_id,mode,score,verdict,created_at,metrics->verified,metrics->backgroundId")
```

That is roughly a 50× reduction on a full board, and it removes `history` — the
single largest field — from a query that never looks at it.

### P2 · Two whole-run re-simulations on the main thread when the report mounts

`components/AppShell.tsx:154-159` and `components/screens/LifeReport.tsx:236`

```ts
void submitRunOnce(`${r.mode}-${r.seed}`, id, resultFromRun(r));
```

`resultFromRun` calls `ticketFor` → `verifyResult` → `replayRun`, which re-runs the
entire life act by act (`lib/cloud/buildResult.ts:59`). It is evaluated as an
*argument*, so it runs **before** `submitRunOnce` gets to check
`alreadySubmitted` — on every pass of that effect, including the second one when
a match player taps through from the podium to the report. `LifeReport` then runs
a second full replay for the ghost line.

`replayRun` also copies `history` and `marketLog` on every simulated year
(`lib/runEngine.ts:896-897`), so it is O(years²) in array writes — fine at 21 Story
years, less fine on a long Infinite run.

**Fix.** Guard the expensive build behind the dedupe check, and let the ghost share
the work:

```ts
useEffect(() => {
  if ((phase !== "report" && phase !== "podium") || !run.run || run.run.status !== "ended") return;
  const r = run.run;
  const key = runKeyFor(r);
  if (alreadySubmitted(key)) return;        // cheap check first
  const id = resolvePlayerId(auth.user?.id ?? null);
  void submitRunOnce(key, id, resultFromRun(r));
}, [phase, run.run, auth.user]);
```

### P3 · The `metrics->>*` filters have no indexes, and the app depends on them

`README.md:44-58`, `lib/cloud/results.ts:165-166`, `components/share/useShareUrl.ts:55`

The README offers `results_background_idx`, `results_seed_idx` and
`results_daily_idx` under the heading "Optional index for the segmented boards".
They are not optional in practice: `useShareUrl` runs the `metrics->>seed` filter
up to five times for *every finished run*, on a table with a `results - public read`
policy and no other index that helps. Without them each poll is a sequential scan.

Move all three into `supabase/schema.sql` beside `results_mode_score_idx`, where
a fresh install will pick them up, and keep the README section as documentation of
what they are for rather than as an opt-in.

### P4 · `advanceYear` shadows the module-level `record()` helper

`lib/runEngine.ts:221` vs `:858`

```ts
function record(s: RunState, act: JournalAct): RunState { /* appends to the journal */ }
// ...
export function advanceYear(s: RunState): RunState {
  // ...
  const record: YearRecord = { yearIndex: yearIndex(s), /* ... */ };
```

Harmless today because nothing calls `record()` after the shadow is introduced —
and one line of future maintenance away from a journal append that silently
resolves to a `YearRecord` object. Rename the local to `yearRecord`.

### P5 · Nothing runs the QA suite

There is no `.github/` directory. The repo ships eight `qa:*`/`audio:*` scripts, a
`golden-draws.json` regression fixture, and four SQL files under `supabase/tests/`
(including `10_attack_probes.sql`, which is exactly the file that proves the RLS
work in this review still holds) — and none of it runs automatically. A single
workflow on push would cover it:

```yaml
name: ci
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run qa:engine
      - run: npm run qa:username
      - run: npm run qa:rls
      - run: npm run audio:meta
```

---

## What was checked and found clean

- **Secrets.** No credentials, tokens, keys or private material anywhere in the
  tree. `.gitignore` covers `.env*.local` and `*.pem`; `.env.local.example` carries
  values-free placeholders and an explicit warning never to paste a
  `sb_secret_...` key into a `NEXT_PUBLIC_*` variable.
- **Injection.** No `eval`, `new Function`, `document.write`,
  `dangerouslySetInnerHTML` or `innerHTML` in application code. The OG route's
  Supabase URL is UUID-validated before interpolation
  (`app/api/og/[id]/route.tsx:39`); `listEdges` guards its PostgREST `.or()`
  expression with the same regex and returns early on anything else
  (`lib/cloud/friends.ts:159`).
- **Untrusted input.** `lib/mp/protocol.ts` rebuilds every inbound field with
  explicit type, range and length checks, refuses a mismatched protocol or engine
  version, and never passes a wire object through by reference. A presence row
  claiming another player's status is dropped (`:403`).
- **XSS via stored data.** `verdict` is constrained to a closed set at the
  database *and* run through `safeVerdict` at the one read boundary every
  consumer crosses (`lib/cloud/results.ts:56`), with the OG route carrying its own
  copy because it bypasses that boundary.
- **Username abuse.** Charset enforced identically in `lib/cloud/profanity.ts:42`
  and the `profiles_username_charset` CHECK — homoglyphs, RTL overrides,
  zero-width joiners and combining marks all refused.
- **Dependencies.** `npm audit`: 0 vulnerabilities across 669 packages. Next 16
  and framer-motion 13 are available as majors; neither current pin has a known
  advisory.
- **Build health.** `tsc --noEmit` clean, `eslint .` clean.
