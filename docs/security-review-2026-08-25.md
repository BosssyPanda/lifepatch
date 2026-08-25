# LifePatch — Codebase Security, Correctness & Performance Review

**Date:** 2026-08-25 · **Branch:** `claude/eager-cori-qdyj61` (at `50a22ff`)
**Scope:** ~31k lines of TypeScript/TSX across `app/`, `components/`, `hooks/`, `lib/`, `src/`, plus `supabase/schema.sql`, `next.config.ts` and the dependency tree.

**Baseline health:** `tsc --noEmit` passes clean. `next lint` reports one warning (raw `<img>` in `ShareCard.tsx:132`). No secrets are committed; `.env*.local` is correctly gitignored and `.env.local.example` carries only placeholders. The multiplayer wire format (`lib/mp/protocol.ts`) is unusually well hardened — every inbound field is rebuilt and clamped. The findings below are therefore design- and logic-level, not compile-level.

---

## 1 · Critical Security Vulnerabilities

### 1.1 Leaderboard scores are entirely client-authored, unvalidated and unbounded
**Files:** `supabase/schema.sql:52–73`, `lib/cloud/results.ts:63–88`, `lib/cloud/buildResult.ts:96–110`

`results` accepts a direct client insert under `with check (auth.uid() = user_id)`. That is the *only* check. `score`, `verdict` and `metrics` are whatever the browser sends:

```sql
create policy "results - insert own" on public.results
  for insert with check (auth.uid() = user_id);
```

Consequences:
- **Forgeable rankings.** Any signed-in player can post `score: 999999999` with any `verdict` string. The global board, the `/r/{id}` share statement and the OG card all render it as fact.
- **No length or size caps.** `verdict` is bare `text` and `metrics` is bare `jsonb`. A single insert can carry megabytes, and there is no per-user row limit or rate limit — an unbounded storage sink on a public-read table.
- **No enum on `verdict`** even though the app only ever produces six values (`lib/verdict.ts`).

**Fix.** Move scoring behind a `SECURITY DEFINER` RPC that recomputes the score server-side from a submitted run transcript, or — if full validation is out of scope — at minimum constrain the shape and revoke direct insert:

```sql
revoke insert on public.results from authenticated;

alter table public.results
  add constraint results_score_range check (score between -1e12 and 1e12),
  add constraint results_verdict_len check (char_length(verdict) <= 64),
  add constraint results_metrics_size check (pg_column_size(metrics) <= 8192);

-- and cap submissions per player per day
create unique index results_daily_cap
  on public.results (user_id, mode, date_trunc('hour', created_at));
```

---

### 1.2 `profiles` is public-read *including* `friend_code`
**File:** `supabase/schema.sql:44–45`

```sql
create policy "profiles - public read" on public.profiles
  for select using (true);
```

The comment above it says leaderboards show "username + avatar only", but the policy grants every column — including `friend_code`, the single secret that gates adding someone as a friend (`lib/cloud/friends.ts:47`). Any client can `select friend_code from profiles` and enumerate the whole userbase. The code is also generated with `Math.random()` over a 31⁶ ≈ 887M space (`lib/cloud/generate.ts:36–39`), so it was never intended to withstand guessing — it was intended to be private.

**Fix.** Expose only the public columns, and resolve codes through a definer function so the code itself never leaves the server:

```sql
drop policy "profiles - public read" on public.profiles;

create policy "profiles - own row" on public.profiles
  for select using (auth.uid() = id);

create view public.profiles_public as
  select id, username, avatar_seed from public.profiles;
grant select on public.profiles_public to anon, authenticated;

create function public.profile_by_friend_code(code text)
returns table (id uuid, username text, avatar_seed text)
language sql security definer set search_path = public as $$
  select id, username, avatar_seed from profiles where friend_code = upper(code);
$$;
```

Then point `getProfiles`/`getByFriendCode` (`lib/cloud/profiles.ts:105–150`) at the view and the RPC.

---

### 1.3 Friendship is not mutual — anyone can unilaterally befriend you
**Files:** `lib/cloud/friends.ts:70–84` and `:100–110`, `supabase/schema.sql:105–112`

The header comment claims "RLS lets each user write only their own side, so friendship is mutual-accepted." It isn't. `accept()` writes an `accepted` edge on the **caller's own** side:

```ts
await supabase.from("friends").upsert(
  { user_id: userId, friend_id: friendId, status: "accepted" },
  { onConflict: "user_id,friend_id" },
);
```

…and `listFriendIds()` counts an accepted edge in **either** direction:

```ts
if (e.status !== "accepted") continue;
ids.add(e.userId === userId ? e.friendId : e.userId);
```

So `A` can insert `(A → B, accepted)` with no involvement from `B`, and `B`'s client then lists `A` as a friend. Combined with §1.2 (friend codes are readable), any user can insert themselves into any other user's friends leaderboard. Nothing in the schema requires a reciprocal edge.

**Fix.** Require the counterpart edge before an edge may be `accepted`, and make `listFriendIds` demand both directions:

```sql
create policy "friends - accept only what was offered" on public.friends
  for insert with check (
    auth.uid() = user_id and (
      status = 'pending'
      or exists (select 1 from friends f
                 where f.user_id = friends.friend_id
                   and f.friend_id = auth.uid())
    )
  );
```

```ts
// lib/cloud/friends.ts — both sides must have said yes
export async function listFriendIds(userId: string): Promise<string[]> {
  const edges = await listEdges(userId);
  const mine = new Set(edges.filter(e => e.userId === userId && e.status === "accepted").map(e => e.friendId));
  const theirs = new Set(edges.filter(e => e.friendId === userId && e.status === "accepted").map(e => e.userId));
  return [...mine].filter(id => theirs.has(id));
}
```

---

### 1.4 PostgREST filter string built by interpolation
**File:** `lib/cloud/friends.ts:89–96`

```ts
.or(`user_id.eq.${userId},friend_id.eq.${userId}`)
```

`userId` is interpolated straight into PostgREST filter syntax. Today it is a UUID from `auth`, and RLS bounds the blast radius to the caller's own rows, so this is **not currently exploitable** — but it is a filter-injection primitive sitting one refactor away from mattering (e.g. the day a friend id is taken from a URL or a room payload). Every other query in the codebase uses parameterised builders; this is the one exception.

**Fix.** Two `.eq` queries, or validate the id first:

```ts
const [asOwner, asTarget] = await Promise.all([
  supabase.from("friends").select("*").eq("user_id", userId),
  supabase.from("friends").select("*").eq("friend_id", userId),
]);
return [...(asOwner.data ?? []), ...(asTarget.data ?? [])].map(fromRow);
```

---

### 1.5 Twelve open dependency advisories (9 high, 3 moderate)
**File:** `package.json` / `package-lock.json`

`npm audit` on the locked tree:

| Package | Locked | Severity | Notable |
|---|---|---|---|
| `next` | 15.5.19 | **high** | SSRF via attacker-controlled rewrite destination (`GHSA-p9j2-gv94-2wf4`), response-body cache confusion (`GHSA-68g3-v927-f742`, `GHSA-4633-3j49-mh5q`), Image-Optimization DoS via SVG (`GHSA-q8wf-6r8g-63ch`), unauthenticated disclosure of internal Server Function endpoints (`GHSA-955p-x3mx-jcvp`), Server-Action DoS |
| `undici` | 7.28.0 | **high** | response desync via retry interceptor, cross-user disclosure via cache directives, CRLF injection |
| `sharp` | 0.34.5 | **high** | inherited libvips CVE-2026-33327/33328/35590/35591 |
| `ip-address` | — | **high** | SSRF / trust-boundary bypass (3 advisories) |
| `brace-expansion` | 1.1.15 | **high** | expansion DoS (3 advisories) |
| `js-yaml`, `nanoid`, `fast-uri` | — | **high** | ReDoS / infinite loop / host confusion |
| `postcss` | 8.5.15 | moderate | arbitrary `.map` file read via `sourceMappingURL` |
| `hono`, `@hono/node-server` | — | moderate | SSR cross-user data disclosure, CORS ReDoS, path traversal |

The Next.js image-optimizer advisory is partially mitigated here (`images: { unoptimized: true }` in `next.config.ts:16`), but the cache-confusion and Server-Function ones are not.

**Fix.** `npm audit fix` clears all twelve — the report states a fix is available for every entry. Re-run `npm run build && npx tsc --noEmit` after.

---

### 1.6 CSP offers no script protection; no HSTS
**File:** `next.config.ts:7–13`

```ts
{ key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" }
```

The header comment is honest that this is "the pragmatic set" with "no script-src". The result is that the CSP mitigates clickjacking and plugin/base-tag abuse only — it contributes nothing against injected script. Given that the app renders user-authored strings (usernames from `profiles`, `verdict` from `results`, peer names off the multiplayer wire), a `script-src` and `connect-src` would be meaningful defence in depth. `Strict-Transport-Security` is also absent (Vercel supplies it, but a self-hosted deploy would not).

**Fix.**

```ts
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
{ key: "Content-Security-Policy", value: [
    "default-src 'self'",
    // Next's inline bootstrap needs 'unsafe-inline'; move to a nonce if you add middleware
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self'",
    "font-src 'self' data:",
    `connect-src 'self' ${SUPA} wss://${SUPA.replace(/^https?:\/\//, "")}`,
    "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'",
  ].join("; ") },
{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
```

---

## 2 · Functional Bugs

### 2.1 Guest players in a cloud deploy break `useProfile` — 10 wasted round trips and an empty Money Brain
**Files:** `hooks/useProfile.ts:26–63`, `lib/cloud/profiles.ts:43–77`, `lib/cloud/identity.ts:60–64`

`useProfile` resolves identity with `resolveProgressId`, which deliberately returns a `device-…` id for guests *even in cloud mode*. It then hands that id to `ensureProfile`, which — unlike its siblings `cloudSavesFor` (`lib/saves.ts:41`) and `cloudMasteryFor` (`lib/cloud/mastery.ts:70`) — has **no guest guard**:

```ts
export async function ensureProfile(userId: string): Promise<Profile> {
  const existing = await getProfile(userId);          // uuid column vs "device-…" → error → null
  if (existing) return existing;
  if (isCloud && supabase) {
    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) { … }  // 5 inserts + 5 re-reads
    throw new Error("Could not create profile after multiple attempts");
  }
```

So every mount of `useProfile` for a cloud guest fires ~11 doomed requests and then throws. Because `load()` uses `Promise.all`, the throw discards the **streak and mastery results too**, and `useProfile`'s effect has a `finally` but no `catch` — an unhandled rejection each time. The user-visible symptom is exactly the one the codebase fights elsewhere: a report announcing "this run sharpened Compounding, Windfalls…" above a Money Brain reading 0%.

**Fix.** Give `ensureProfile` the same guard the other stores have:

```ts
// lib/cloud/profiles.ts
function cloudProfileFor(userId: string): boolean {
  return Boolean(isCloud && supabase && !isGuestId(userId));
}
// …then swap every `isCloud && supabase` in getProfile / ensureProfile /
// updateUsername / getByFriendCode for cloudProfileFor(userId).
```

…and add a `catch` in `useProfile`'s effect so one failed store never blanks the other two.

---

### 2.2 Rat Race stock book creates money through rounding asymmetry
**File:** `lib/cashflow/engine.ts:226` vs `:255`

Buys settle in **cents**; sells settle in **whole dollars**:

```ts
const cost = Math.round(n * price * 100) / 100;   // buyStock  — cents
…
return { ...s, cash: s.cash + Math.round(n * price), stocks };  // sellStock — dollars
```

A buy-then-sell at an unchanged quote is therefore not value-neutral: 1 share of a $2.95 ticker costs `$2.95` and returns `$3.00`. The swing is bounded at ±$0.50 per transaction but it is repeatable, and it also leaves fractional-cent residue in `cash` that then flows into `clampCash` and `netWorth`. `maxAffordable` already went to the trouble of working in integer cents (`lib/cashflow/selectors.ts:250–262`) precisely to avoid this class of drift.

**Fix.** Settle both sides identically:

```ts
// sellStock
const proceeds = Math.round(n * price * 100) / 100;
return { ...s, cash: s.cash + proceeds, stocks };
```

---

### 2.3 `loadCashflow` feeds unvalidated localStorage straight into the engine
**File:** `lib/cashflow/persist.ts:44–56`

```ts
const s = JSON.parse(raw) as CashflowState;
if (!s || typeof s.version !== "number") return null;
if (s.version === STATE_VERSION) return s;   // ← every other field unchecked
```

Only `version` is inspected. A truncated write, a hand-edited key, or a partially-flushed save resumes as a corrupt state: `totalExpenses` and `payday` (`lib/cashflow/selectors.ts:29–48`) sum fields with `+`, so a single `undefined` becomes `NaN` and propagates through the entire statement, the Freedom meter and the submitted leaderboard score. Compare the multiplayer path, which rebuilds every field (`parseRunState`, `lib/mp/protocol.ts:264`), and `isCompatibleSave` on the life-sim side.

**Fix.** Add a shape guard mirroring `migrateV1`'s existing checks and extend it to the numeric fields:

```ts
function isCashflowState(s: unknown): s is CashflowState {
  if (typeof s !== "object" || s === null) return false;
  const c = s as Partial<CashflowState>;
  return c.version === STATE_VERSION
    && !!c.liabilities && !!c.expenses
    && Array.isArray(c.stocks) && Array.isArray(c.realEstate) && Array.isArray(c.businesses)
    && Number.isFinite(c.cash) && Number.isFinite(c.salary) && Number.isFinite(c.seed);
}
// loadCashflow: if (s.version === STATE_VERSION) return isCashflowState(s) ? s : null;
```

---

### 2.4 `advanceYear` records a debt payment the player did not make
**File:** `lib/runEngine.ts:598–640`

The lender's minimum is taken from cash first, then by forced sale — and both may fall short:

```ts
const due = debtMinimum(debt);
…
debt -= fromCash + forcedSale;      // only what was actually paid
```

…but the year's statement line claims the whole amount left the account:

```ts
cashFlow: Math.round(takeHome - expenses - ms.payment - due),
```

For a player with no cash and no holdings — precisely the insolvency-spiral case the engine goes to great length to model — the printed cash flow overstates the outflow by `due − (fromCash + forcedSale)`, so the receipt no longer reconciles against the balance change. The comment on that line ("the figure the player sees is the one they lived") is the intent; the code doesn't meet it.

**Fix.**

```ts
const paid = fromCash + forcedSale;      // hoist out of the `if (due > 0)` block
…
cashFlow: Math.round(takeHome - expenses - ms.payment - paid),
```

---

### 2.5 `startMatch` can build a nine-seat roster that every peer then truncates
**File:** `hooks/useMatch.tsx:1349–1356`

```ts
const roster = Object.values(peersRef.current).filter(p => p.connected)
  .sort(…).slice(0, MAX_PLAYERS)          // up to 8
  .map(…);
if (!roster.some(r => r.playerId === cur.hostId) && selfInfoRef.current) {
  roster.unshift(selfInfoRef.current);    // → 9
}
```

`parseMatchConfig` truncates every inbound roster to `MAX_PLAYERS` (`lib/mp/protocol.ts:221`), dropping the **last** entry. The host would then believe a player is seated whom the entire rest of the room refuses — and since the roster is also the rejoin gate (`useMatch.tsx:1250`), that player is permanently locked out with "the host started the match without you". Presence caps `others` at 7 (`useMatch.tsx:963`) so this is hard to reach today, but the invariant is one line.

**Fix.** `if (roster.length > MAX_PLAYERS) roster.length = MAX_PLAYERS;` after the `unshift`.

---

### 2.6 `pickIndex` hands back index 0 for an empty deck
**File:** `lib/cashflow/rng.ts:29–31`

```ts
export function pickIndex(seed: number, cursor: number, len: number): number {
  return Math.floor(rngAt(seed, cursor) * len) % Math.max(1, len);
}
```

With `len === 0` this returns `0`, and `draw()` (`lib/cashflow/engine.ts:204–207`) then returns `deck[0] === undefined` as a card. Every caller destructures `.card` and reads fields off it. The `Math.max(1, len)` guard protects the modulo but not the caller.

**Fix.** Return `-1` for an empty range and have `draw` bail:

```ts
export function pickIndex(seed: number, cursor: number, len: number): number {
  if (len <= 0) return -1;
  return Math.floor(rngAt(seed, cursor) * len) % len;
}
```

---

### 2.7 `saveMatch`'s retry loop deletes other rooms on any storage failure
**File:** `lib/mp/matchStore.ts:125–133`

```ts
for (;;) {
  try { store.setItem(keyFor(roomCode), body); evict(store, roomCode); return; }
  catch { if (!dropOldest(store, roomCode)) return; }
}
```

The loop assumes every `setItem` throw is a quota error. It isn't — Safari's private mode and "block all cookies" throw unconditionally. In that case the loop deletes **every other stored match record** before finally giving up, destroying rejoin data for rooms that had nothing to do with this write. The comment explains why swallowing the error is wrong; the retry over-corrects.

**Fix.** Only sacrifice rooms for a genuine quota error:

```ts
catch (e) {
  const quota = e instanceof DOMException &&
    (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED");
  if (!quota || !dropOldest(store, roomCode)) return;
}
```

---

## 3 · Code Quality & Performance

### 3.1 Leaderboard over-fetches and dedupes client-side
**File:** `lib/cloud/results.ts:90–116`

```ts
const { data } = await query.limit(limit * 5);       // 125 rows
return bestPerUser((data ?? []).map(fromRow)).slice(0, limit);
```

Two problems. The transfer grows linearly with board size, and correctness is only probabilistic: if one prolific player owns the top 125 rows, the board renders **one** entry. Move the dedupe into Postgres:

```sql
create view public.results_best as
  select distinct on (user_id, mode) * from public.results
  order by user_id, mode, score desc, created_at desc;
```

### 3.2 `ShareCard` holds a multi-megabyte data URL in React state
**File:** `components/share/ShareCard.tsx:47`

`setPreview(cv.toDataURL("image/png"))` base64-encodes a 1080×1920 PNG (~1.3× the raw bytes) into a string that lives in state, is diffed by React, and is re-parsed by the browser as an `<img src>`. `URL.createObjectURL(blob)` avoids the encode, the copy and the diff — and the component already has a `toBlob()` helper. Revoke on unmount and on format change.

### 3.3 Identity generators are undersized / non-cryptographic
**File:** `lib/cloud/generate.ts:29–39`

`generateUsername()` draws from 24 × 24 × 900 ≈ 518k combinations against a `UNIQUE` constraint with only `MAX_CREATE_ATTEMPTS = 5` retries — collision pressure rises quadratically with the userbase, and exhausting the retries throws (swallowed by `submitRunOnce`, so the run silently never posts). `generateFriendCode()` uses `Math.random()`, which is not a CSPRNG; `lib/mp/roomCodes.ts:9–22` already does this correctly with `crypto.getRandomValues` and rejection sampling. Reuse that helper and append a random suffix to usernames.

### 3.4 Multiplayer messages carry no sender authentication
**File:** `hooks/useMatch.tsx:746–863`

`snapshot`, `snapshotReply` and `config` are trusted on the basis of the `playerId` **inside** the payload; the transport does not bind a sender identity. The code is candid about this ("Airtight needs a server authority, which is out of scope by contract", `useMatch.tsx:778`) and mitigates it well — roster gating (`isRosterMember`), session fencing, the `tick` bound to demonstrable peer years. Worth recording as an accepted risk rather than a defect: a room member who knows the code can still rewrite an absent player's cached life. Binding sends to the Supabase Realtime presence key would close it.

### 3.5 Smaller items
- **`lib/runEngine.ts:211`** — the solo `drawEvents` loop spins its full 60-iteration guard whenever the eligible pool has fewer distinct events than `want`. Break when `picks.length === new Set(weighted).size`.
- **`app/api/og/[id]/route.tsx:41`** — the upstream Supabase `fetch` has no `AbortSignal.timeout()`. On an edge function a slow upstream holds the request until the platform kills it; the fallback card exists precisely so this never blocks.
- **`lib/cloud/results.ts:63–88`** — `submitResult` posts `metrics.history` capped at 100 points (`buildResult.ts:29`) but nothing caps `verdict`; see §1.1.
- **`components/share/ShareCard.tsx:132`** — the one lint warning: raw `<img>`. Legitimate here (a data/blob URL), so silence it with an inline `eslint-disable-next-line` and a note rather than leaving the warning standing.

---

## Recommended order of work

1. `npm audit fix` — §1.5, mechanical, clears 12 advisories.
2. `ensureProfile` guest guard — §2.1, one function, fixes a live user-visible bug and 11 wasted requests per mount.
3. Schema hardening — §1.1, §1.2, §1.3 together: they are one migration and they are the difference between a leaderboard that means something and one that doesn't.
4. Rounding and validation fixes — §2.2, §2.3, §2.4, §2.6.
5. CSP + HSTS — §1.6.
6. Robustness and perf — §2.5, §2.7, §3.1, §3.2.
