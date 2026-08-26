# LifePatch — Codebase Security & Quality Review

**Date:** 2026-08-26 · **Branch:** `claude/eager-cori-6sncz6` · **Head:** `f672692`
**Scope:** 200 TS/TSX source files, `supabase/schema.sql`, build config, dependency tree.

## Verification performed

| Check | Result |
| --- | --- |
| `tsc --noEmit` | Clean (exit 0) |
| `next lint` | 1 warning (`<img>` in ShareCard.tsx:132) |
| Hardcoded secrets scan | **None found** |
| `dangerouslySetInnerHTML` / `eval` / `innerHTML` | **None found** |
| `npm audit` | 9 high, 3 moderate |

The codebase is unusually disciplined. `lib/mp/protocol.ts` is a genuinely well-built
untrusted-input boundary (field-by-field rebuild, numeric clamps, protocol versioning),
`fastForward` is guard-bounded, animation intervals are gated on `IntersectionObserver` +
`visibilitychange`, and code-splitting is thorough. The findings below are concentrated in
one place: **the Supabase trust boundary**, where the client is treated as authoritative.

---

## 1. Critical Security Vulnerabilities

### 1.1 — Leaderboard scores are client-authoritative and trivially forgeable
**`supabase/schema.sql:70` · `lib/cloud/results.ts:84-100` · `lib/cloud/buildResult.ts:26`**

The only constraint on a leaderboard row is that you own it:

```sql
create policy "results - insert own" on public.results
  for insert with check (auth.uid() = user_id);
```

`score`, `verdict` and `metrics` are entirely unvalidated. The anon key is shipped to every
browser by design (`NEXT_PUBLIC_SUPABASE_ANON_KEY`), so any signed-in player can `POST` directly
to `/rest/v1/results` with `score: 999999999`. Because `topResults` ranks by score and
`bestPerUser` keeps each player's maximum, one forged row permanently tops every board.

There are three amplifying factors:

- **`score` is unbounded `numeric`** — no CHECK constraint, no plausibility ceiling.
- **`metrics` is unbounded `jsonb`** — a storage-abuse vector (Postgres allows up to 255 MB per
  value) with no rate limit on inserts.
- **The `verified` provenance badge is self-asserted.** `buildResult.ts:58` writes
  `verified: 1` after a client-side replay, and `app/r/[id]/page.tsx:50` renders it as
  *"Replayed · re-simulated to this score"*. `lib/replay.ts` is honest about this in its own
  comments, but the shipped UI presents a trust signal that a forger sets by hand.

**Recommendation.** Move scoring server-side. The minimum viable fix is a `SECURITY DEFINER`
RPC that is the *only* insert path, with the direct-insert policy revoked:

```sql
revoke insert on public.results from anon, authenticated;
drop policy "results - insert own" on public.results;

alter table public.results
  add constraint results_score_sane check (score between -1e10 and 1e10),
  add constraint results_metrics_small check (pg_column_size(metrics) < 8192);

create or replace function public.submit_result(
  p_mode text, p_score numeric, p_verdict text, p_metrics jsonb
) returns public.results
language plpgsql security definer set search_path = public as $$
declare v_row public.results;
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  -- one row per player per hour: blunt, but it ends bulk forgery
  if (select count(*) from public.results
      where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'rate limit';
  end if;
  insert into public.results (user_id, mode, score, verdict, metrics)
  values (auth.uid(), p_mode, p_score, p_verdict, p_metrics - 'verified')
  returning * into v_row;
  return v_row;
end $$;
```

Note `p_metrics - 'verified'`: the flag must be stripped, since the client cannot be the one
that attests to it. If the badge is to survive at all, re-run `replayRun` server-side from the
submitted `seed` + journal and set it there. Until then, **remove the "Replayed" row from
`provenanceRows()`** — an unbacked verification claim is worse than none.

---

### 1.2 — Friend requests can be accepted unilaterally (consent bypass)
**`supabase/schema.sql:107` · `lib/cloud/friends.ts:44-113`**

`lib/cloud/friends.ts:8` states the invariant: *"RLS lets each user write only their own side,
so friendship is mutual-accepted."* The code does not implement it.

The insert policy checks ownership but never constrains `status`:

```sql
create policy "friends - insert own" on public.friends
  for insert with check (auth.uid() = user_id);
```

So Mallory inserts `(user_id: mallory, friend_id: victim, status: 'accepted')` in one call. On
the victim's client, `listFriendIds` (line 97) counts an accepted edge in **either** direction:

```ts
for (const e of edges) {
  if (e.status !== "accepted") continue;
  ids.add(e.userId === userId ? e.friendId : e.userId);  // ← adds mallory
}
```

Mallory is now the victim's friend. Worse, it is **silent**: `listIncoming` (line 108) filters on
`status === "pending"`, so an edge that skips straight to `accepted` never appears as a request
the victim could decline. This grants friends-scope leaderboard visibility without consent.

*Data-exposure impact is limited* — `results` and `streaks` are public-read anyway — but for a
product that describes itself as opt-in and teen-safe, a friend graph anyone can write
themselves into is a product-integrity defect, not a cosmetic one.

**Recommendation.** Fix in both places. Constrain the write in SQL:

```sql
drop policy "friends - insert own" on public.friends;
create policy "friends - request own" on public.friends
  for insert with check (auth.uid() = user_id and status = 'pending');

drop policy "friends - update own" on public.friends;
create policy "friends - accept own" on public.friends
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id and (
      status = 'pending'
      or exists (                       -- may only accept a real incoming request
        select 1 from public.friends f
        where f.user_id = friends.friend_id and f.friend_id = auth.uid()
      )
    )
  );
```

`accept()` at line 66 uses `upsert`, which under the policy above correctly requires the
reciprocal edge to exist. And make the client agree with the invariant it documents — require
**both** directions:

```ts
export async function listFriendIds(userId: string): Promise<string[]> {
  const edges = await listEdges(userId);
  const mine = new Set(edges.filter(e => e.userId === userId && e.status === "accepted")
                            .map(e => e.friendId));
  const theirs = new Set(edges.filter(e => e.friendId === userId && e.status === "accepted")
                              .map(e => e.userId));
  return [...mine].filter(id => theirs.has(id));
}
```

---

### 1.3 — Every player's friend code is published to every visitor
**`supabase/schema.sql:44` · `lib/cloud/profiles.ts:134-145`**

`profiles` is `for select using (true)` and every read is `select("*")`, so `friend_code` — the
one token gating the friend graph — ships to the browser on every leaderboard render:

```ts
const { data } = await supabase.from("profiles").select("*").in("id", unique);
```

`components/social/Leaderboard.tsx:169` calls this for all 25 ranked players. Anyone holding the
public anon key can also dump the entire table directly. Chained with **1.2**, an attacker can
enumerate active players and write themselves into every one of their friend lists.

**Recommendation.** A secret must not live in a public-read table. Split it:

```sql
revoke select on public.profiles from anon, authenticated;
create view public.profiles_public as
  select id, username, avatar_seed, created_at from public.profiles;
grant select on public.profiles_public to anon, authenticated;

create policy "profiles - read own full row" on public.profiles
  for select using (auth.uid() = id);
```

Then point `getProfiles` / `getProfile` at `profiles_public`, and resolve `getByFriendCode`
through a `SECURITY DEFINER` RPC that takes a code and returns only the matching `id` — so a
lookup can confirm a code but never enumerate one. As an interim mitigation that costs one line,
narrow the leaderboard query today:

```ts
.select("id, username, avatar_seed, created_at")   // never "*"
```

---

### 1.4 — Dependencies carry 9 high-severity advisories
**`package.json` / `package-lock.json`**

| Package | Installed | Advisories | Fix |
| --- | --- | --- | --- |
| `next` | 15.5.19 | **8 high/moderate** — unauthenticated disclosure of internal Server Function endpoints, SSRF in rewrites, cache confusion of response bodies, Server Action DoS | → `15.5.24` |
| `postcss` | 8.5.15 | 4 high — arbitrary `.map` file read via attacker-controlled `sourceMappingURL`, XSS via unescaped `</style>` | → `8.5.26` |
| `@tailwindcss/postcss` | 4.3.1 | moderate (transitive postcss) | → `4.3.3` |
| `sharp` | 0.34.5 | high — inherited libvips CVEs | not reachable (see below) |
| `undici`, `hono`, `js-yaml`, `nanoid`, `ip-address`, `brace-expansion`, `fast-uri` | — | high/moderate | all transitive via the `shadcn` devDependency |

**Verified:** bumping to `next@15.5.24` (the maintained 15.x backport line) clears all 8 `next`
advisories, leaving only one moderate from a bundled postcss copy. All three bumps are **within
the existing semver ranges** — a lockfile refresh, not a breaking upgrade:

```bash
npm i next@15.5.24 postcss@8.5.26 @tailwindcss/postcss@4.3.3
npm audit   # expect: next (moderate, bundled postcss) only
```

Two mitigating notes, so the risk is not overstated: `sharp` is unreachable because
`next.config.ts:17` sets `images: { unoptimized: true }`, and the `undici`/`hono`/`js-yaml`
cluster comes exclusively from `shadcn@4.12.0`, a scaffolding CLI in `devDependencies` that
never ships. Neither is a production-runtime path — but `shadcn` pulls
`@modelcontextprotocol/sdk` and `@dotenvx/dotenvx` onto every developer and CI machine, which is
a wide supply-chain surface for a tool run a handful of times. Consider `npx shadcn@latest`
on demand and dropping the pinned dependency.

---

### 1.5 — No Realtime channel authorization
**`supabase/schema.sql` (absent) · `lib/mp/transport.ts:99`**

Match rooms are Supabase Realtime channels named `lp-match-v1-${roomCode}`. The schema
configures RLS for every table but **nothing for `realtime.messages`**, so with the public anon
key any client may subscribe to any channel. Room codes are 31⁶ ≈ 887M (and `roomCodes.ts`
correctly uses `crypto.getRandomValues` with rejection sampling), so brute-forcing a *specific*
room is impractical — but nothing rate-limits sweeping the space for *any* live room, and
`lib/mp/protocol.ts:20` is the only gate once inside.

Credit where due: `useMatch.tsx:522` (`isRosterMember`) refuses statuses and snapshots from
non-roster ids and holds nothing before the match starts, which closes the cache-growth attack
an open channel would otherwise enable. The residual exposure is passive observation of a room's
traffic.

**Recommendation.** Add a Realtime authorization policy so joining a topic requires
authentication:

```sql
create policy "authenticated may join match topics" on realtime.messages
  for select to authenticated
  using (realtime.topic() like 'lp-match-v1-%');
```

---

## 2. Functional Bugs

### 2.1 — `pickIndex` returns a valid-looking index for an empty deck
**`lib/cashflow/rng.ts:32-34`**

```ts
export function pickIndex(seed: number, cursor: number, len: number): number {
  return Math.floor(rngAt(seed, cursor) * len) % Math.max(1, len);
}
```

The `Math.max(1, len)` guard prevents `NaN` from `% 0`, but for `len === 0` it returns `0` —
an out-of-bounds index. `draw()` (`engine.ts:204`) then hands back `{ card: undefined }`, which
propagates as a crash at the first property access rather than at the empty-deck call site.

Not currently reachable (all four decks are non-empty module constants), so this is a latent
trap rather than a live defect — but the guard reads as if it handles the case it doesn't.

```ts
export function pickIndex(seed: number, cursor: number, len: number): number {
  if (len <= 0) return -1;                    // caller must handle; never a phantom index 0
  return Math.floor(rngAt(seed, cursor) * len);
}
```

### 2.2 — `ensureProfile` throws once the username space fills
**`lib/cloud/profiles.ts:12, 42-62` · `lib/cloud/generate.ts:29-32`**

`generateUsername()` yields 24 × 24 × 900 = **518,400** combinations against a `unique`
constraint (`schema.sql:38`), and `ensureProfile` retries only `MAX_CREATE_ATTEMPTS = 5` before
throwing. Because `friend_code` is *also* unique with only 31⁶ values drawn by `Math.random()`,
collisions compound. By the birthday bound, collisions become routine in the low tens of
thousands of profiles, and the failure surfaces as a hard throw inside the sign-in path
(`buildResult.ts:119` calls `ensureProfile` before every submit).

```ts
export function generateUsername(): string {
  const n = Math.floor(Math.random() * 9000) + 1000;   // 1000–9999 → 5.2M combinations
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${n}`;
}
```

…and widen the retry budget, appending a disambiguating suffix on the last attempts rather than
re-rolling blind. `ensureProfile` should also degrade to a read-only anonymous profile rather
than throwing, so a full username table can never block a submit.

### 2.3 — Friend codes use `Math.random()`
**`lib/cloud/generate.ts:25-27, 34-38`**

`lib/mp/roomCodes.ts:9-22` gets this exactly right — `crypto.getRandomValues` with modulo
rejection sampling. `generate.ts` does not, and it is the module producing the token that gates
the friend graph:

```ts
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];   // predictable PRNG
}
```

V8's `Math.random` state is recoverable from a modest run of outputs. Reuse the existing helper:

```ts
import { ROOM_CODE_ALPHABET } from "@/lib/mp/roomCodes";   // or lift randomIndex() into a shared util
```

(Lower priority once **1.3** is fixed and codes stop being public — but the two fixes are
independent and both belong.)

### 2.4 — Asymmetric rounding between stock buys and sells
**`lib/cashflow/engine.ts:226` vs `:255`**

Buying settles in cents; selling rounds to whole dollars:

```ts
const cost = Math.round(n * price * 100) / 100;   // buy  — cent-accurate
return { ...s, cash: s.cash + Math.round(n * price), stocks };   // sell — whole dollars
```

A buy-then-immediate-sell at an unchanged quote nets ±$0.50. Small, but it breaks the balance-sheet
identity `netWorth = totalAssets − totalLiabilities` that `selectors.ts:161` exists to hold, and
`maxAffordable` (`selectors.ts:258`) documents at length how a sub-cent drift once triggered a
phantom $1,000 bank loan. Match the buy path:

```ts
return { ...s, cash: s.cash + Math.round(n * price * 100) / 100, stocks };
```

### 2.5 — `/r/[id]` hits the database on any malformed id
**`app/r/[id]/page.tsx:124, 141` vs `app/api/og/[id]/route.tsx:26, 40`**

The OG route validates before querying:

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!base || !anon || !UUID_RE.test(id)) return null;
```

The page route does not — `getResult(id)` is called on arbitrary path input, and each junk
request costs a Supabase round trip that fails on a uuid cast error. Two calls per request
(`generateMetadata` + the page body), unauthenticated and uncached. Not an injection risk
(`.eq()` parameterises correctly), but it is free quota burn against a project with no rate
limiting.

Export the regex from the OG route and guard both entry points:

```ts
if (!isCloud || !UUID_RE.test(id)) notFound();
```

### 2.6 — The multiplayer session fence fails open on an omitted field
**`hooks/useMatch.tsx:800-802, 820-821` · `lib/mp/protocol.ts:147-150`**

```ts
const owner = sessionOwnersRef.current.get(msg.playerId);
if (msg.sessionId && owner && msg.sessionId !== owner) return;
```

The fence is skipped entirely when `sessionId` is absent — deliberately, and the comments give
two good reasons (older builds, and the acting host's sessionless ghost rows). But an attacker
simply omits the field, so the fence stops anything except an honest second tab. Combined with
`parsePeerStatus` accepting `netWorth` up to 1e12, any roster member can post arbitrary
standings for any other roster member.

This is inherent to a serverless peer-to-peer design and the file says so
(`protocol.ts:9-19`: *"There is no server and no authority"*). Flagging it as a **known and
accepted** limit rather than a fixable defect — but it should be written down as such, because
multiplayer podium results carry the same trust weight as **1.1**. If matches ever feed the
public leaderboard, they need the same server-side arbitration.

---

## 3. Code Quality & Performance

### 3.1 — Leaderboard queries are the main scaling bottleneck
**`lib/cloud/results.ts:125-141`**

```ts
if (background) query = query.eq("metrics->>backgroundId", background);
if (scope === "daily" && daily) query = query.eq("metrics->>daily", daily);
const { data } = await query.limit(limit * 5);       // 125 rows, select("*")
return bestPerUser((data ?? []).map(fromRow)).slice(0, limit);
```

Three compounding costs: the jsonb-path filters are **unindexed** (acknowledged in the source
comment), `select("*")` pulls the full `metrics` blob — including the capped-100 `history`
array — for 125 rows to render 25, and best-per-user dedupe happens client-side, so a board
where one player holds the top 125 rows renders nearly empty.

The expression indexes the README mentions should ship in `schema.sql` rather than staying
optional, and the dedupe belongs in the database:

```sql
create index if not exists results_bg_idx
  on public.results (mode, (metrics->>'backgroundId'), score desc);
create index if not exists results_daily_idx
  on public.results (mode, (metrics->>'daily'), score desc);
```

```ts
.select("id, user_id, mode, score, verdict, created_at")   // metrics is not rendered on a row
```

Longer term a `distinct on (user_id)` view removes the over-fetch entirely.

### 3.2 — ESLint 8.57.1 is end-of-life
**`package.json` devDependencies**

No security impact, but it receives no fixes, and `next lint` itself now warns it is removed in
Next.js 16. The migration path is printed by the tool: `npx @next/codemod@canary next-lint-to-eslint-cli .`

### 3.3 — `<img>` instead of `next/image`
**`components/share/ShareCard.tsx:132`** — the single lint warning. Low impact here since
`images: { unoptimized: true }` is set globally, so `next/image` would add little; either
migrate or add a scoped `eslint-disable` with the reason, so the lint run stays clean.

---

## What was checked and found sound

Worth recording, so a future reviewer doesn't re-derive it:

- **`lib/mp/protocol.ts`** — every inbound field is rebuilt rather than passed through, numbers
  are clamped, the protocol version is checked, and roster membership gates writes. This is the
  strongest part of the codebase.
- **`lib/runEngine.ts`** — `advanceYear` guards `status !== "playing"`, `trade`/`payDebt` floor
  both sides at zero (with the historical bug documented), and `hasFullJournal` checks per-entry
  year identity rather than length.
- **`fastForward`** (`autoResolve.ts:164`) and `drawEvents` (`runEngine.ts:355, 377`) are all
  guard-bounded; no unbounded loop is reachable from wire input.
- **Animation hygiene** — `DataAtlas.tsx:86-110` gates its interval on both
  `IntersectionObserver` and `visibilitychange`; rAF and interval cleanups are present
  throughout.
- **`app/api/og/[id]/route.tsx`** — UUID-validated before interpolation, distinct cache TTLs for
  real vs fallback cards, and it never 500s on an unfurl.
- **Event and outcome weights** (`lib/lifeEvents.ts`) — all integers; the `weight: 1999` on the
  lottery is a deliberate 1-in-2000 jackpot, not a typo.
- **No hardcoded secrets, no `dangerouslySetInnerHTML`, no `eval`.** `.env.local.example`
  explicitly warns against pasting a `sb_secret_` key into a `NEXT_PUBLIC_` variable.

## Suggested order of work

1. **1.4** — three in-range version bumps, ~5 minutes, clears 8 high advisories.
2. **1.3** — one-line query narrowing now; the view/RPC split next.
3. **1.2** — two RLS policies plus the `listFriendIds` fix.
4. **1.1** — the largest change. Ship the CHECK constraints and remove the unbacked
   "Replayed" badge immediately; the `SECURITY DEFINER` RPC can follow.
5. **2.5**, **2.4**, **2.1** — small, self-contained correctness fixes.
6. **3.1** — before the results table grows past a few thousand rows.
