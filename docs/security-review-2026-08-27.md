# LifePatch — Codebase Security & Quality Review

**Date:** 2026-08-27
**Scope:** application source (`app/`, `lib/`, `src/`, `hooks/`, `components/`), `supabase/schema.sql`, `next.config.ts`, dependency tree via `npm audit`.
**Branch reviewed:** `claude/eager-cori-wp9eh9` @ `f672692`

---

## Summary

| # | Finding | Bucket | Severity |
|---|---|---|---|
| 1 | `next@15.5.19` carries 8 published advisories (3 high) | Critical Security | **High** |
| 2 | `profiles` RLS publishes every player's `friend_code` | Critical Security | **High** |
| 3 | `friends` RLS permits unilateral `accepted` edges | Critical Security | **Medium-High** |
| 4 | Unconstrained `results.verdict` / `results.metrics` rendered on public pages | Critical Security | **Medium-High** |
| 5 | Unbounded `metrics.history` → render amplification on `/r/{id}` | Critical Security | **Medium** |
| 6 | 11 further transitive advisories in the build chain | Critical Security | **Medium** |
| 7 | Unhandled `getSession()` rejection locks the app on "Verifying ID" | Functional Bug | **High** |
| 8 | `AudioEngine.setAmbience` leaks the outgoing ambience graph past teardown | Functional Bug | **Low-Medium** |
| 9 | PostgREST `.or()` filter built by string interpolation | Code Quality | **Low** |
| 10 | `drawEvents` burns 59 wasted iterations on a one-card pool | Code Quality | **Low** |
| 11 | CSP omits `form-action`; `frame-ancestors` only | Code Quality | **Low** |
| 12 | `eslint@8.57.1` is end-of-life | Code Quality | **Low** |

**General note.** This codebase is unusually well defended in the places that normally fail. There is no `dangerouslySetInnerHTML`, no `eval`, no hardcoded secret, no unsanitized SQL. `lib/mp/protocol.ts` rebuilds every inbound field rather than passing wire data through, and `hooks/useMatch.tsx` fences peer messages by roster membership and session ownership. Every finding below is at the edges of that work, not in its middle.

---

# Critical Security Vulnerabilities

## 1. `next@15.5.19` — eight published advisories, three high

**File:** `package.json:30` (`"next": "^15.1.6"`, resolving to `15.5.19` per `package-lock.json`)

The pinned range resolves below the fix line for every advisory in the table. All are fixed in `15.5.21`.

| Advisory | Severity |
|---|---|
| [GHSA-m99w-x7hq-7vfj](https://github.com/advisories/GHSA-m99w-x7hq-7vfj) — DoS in App Router via Server Actions | High |
| [GHSA-89xv-2m56-2m9x](https://github.com/advisories/GHSA-89xv-2m56-2m9x) — SSRF in Server Actions on custom servers | High |
| [GHSA-p9j2-gv94-2wf4](https://github.com/advisories/GHSA-p9j2-gv94-2wf4) — SSRF via attacker-controlled rewrite destination hostname | High |
| [GHSA-68g3-v927-f742](https://github.com/advisories/GHSA-68g3-v927-f742) — cache confusion of response bodies | Moderate |
| [GHSA-4633-3j49-mh5q](https://github.com/advisories/GHSA-4633-3j49-mh5q) — cache confusion on invalid UTF-8 bodies | Moderate |
| [GHSA-4c39-4ccg-62r3](https://github.com/advisories/GHSA-4c39-4ccg-62r3) — unbounded Server Action payload in Edge runtime | Moderate |
| [GHSA-955p-x3mx-jcvp](https://github.com/advisories/GHSA-955p-x3mx-jcvp) — unauthenticated disclosure of internal Server Function endpoints | Moderate |
| [GHSA-q8wf-6r8g-63ch](https://github.com/advisories/GHSA-q8wf-6r8g-63ch) — DoS in Image Optimization API via SVG | Moderate |

**Risk.** The cache-confusion and Server-Function-disclosure issues apply to any deployment. The Image Optimization DoS is already neutralised here by `next.config.ts:16` (`images: { unoptimized: true }`), and the Server Actions issues have limited reach because this app declares none — but the patch is free and the range is only a patch bump away.

**Fix**

```jsonc
// package.json
"next": "^15.5.21",
```

```bash
npm install next@^15.5.21 && npm run build
```

---

## 2. `profiles` row-level security publishes every player's `friend_code`

**Files:** `supabase/schema.sql:43-45`; `lib/cloud/profiles.ts:30,105-115,139`

```sql
-- Anyone may read profiles (leaderboards show username + avatar only).
create policy "profiles - public read" on public.profiles
  for select using (true);
```

The comment states the intent — username and avatar only — but the policy grants the whole row, and RLS has no column granularity. `friend_code` sits in that row, and `NEXT_PUBLIC_SUPABASE_ANON_KEY` is by design shipped to every browser. Anyone can therefore run:

```
GET /rest/v1/profiles?select=username,friend_code
apikey: <the public anon key>
```

and receive the complete user table with every friend code in it. Every client query in `lib/cloud/profiles.ts` uses `select("*")`, so the codebase is not relying on column projection anywhere.

**Risk.** The friend code is the sole capability guarding `addByCode` (`lib/cloud/friends.ts:44`) — the design comment there says friends are added "by code, never by search". That property is void: the entire user base and all its codes are enumerable, so any account can be targeted by code. It also allows trivial bulk enumeration of the player base.

**Fix.** Drop the blanket policy and expose only the public columns through a view, keeping code lookup behind a `security definer` function that takes a code and returns one row:

```sql
drop policy "profiles - public read" on public.profiles;

create policy "profiles - read own" on public.profiles
  for select using (auth.uid() = id);

-- Public projection: username + avatar only, no friend_code.
create view public.profiles_public
  with (security_invoker = off) as
  select id, username, avatar_seed, created_at from public.profiles;

grant select on public.profiles_public to anon, authenticated;

-- Code lookup stays a point query; it can never enumerate.
create function public.profile_by_friend_code(code text)
returns table (id uuid, username text, avatar_seed text)
language sql security definer stable
set search_path = public as $$
  select id, username, avatar_seed
  from public.profiles
  where friend_code = upper(trim(code))
  limit 1;
$$;

revoke execute on function public.profile_by_friend_code(text) from anon;
grant execute on function public.profile_by_friend_code(text) to authenticated;
```

Then in `lib/cloud/profiles.ts`, point `getProfiles` at `profiles_public` and `getByFriendCode` at the RPC:

```ts
export async function getByFriendCode(code: string): Promise<Profile | null> {
  const clean = code.trim().toUpperCase();
  if (!clean) return null;
  if (isCloud && supabase) {
    const { data } = await supabase.rpc("profile_by_friend_code", { code: clean }).maybeSingle();
    return data ? fromRow(data as Record<string, unknown>) : null;
  }
  /* …unchanged local branch… */
}
```

Rotating existing friend codes after the fix is worth doing — the current ones should be assumed public.

---

## 3. `friends` RLS permits a unilateral `accepted` edge

**Files:** `supabase/schema.sql:107-108`; `lib/cloud/friends.ts:66-82`

```sql
create policy "friends - insert own" on public.friends
  for insert with check (auth.uid() = user_id);
```

The policy constrains *whose side* of the edge you may write, but not the `status` you write there. Nothing requires a reciprocal request to exist. Any authenticated user can insert

```json
{ "user_id": "<attacker>", "friend_id": "<victim>", "status": "accepted" }
```

and `listFriendIds(victim)` (`lib/cloud/friends.ts:97-105`) will count them, because it accepts an accepted edge in **either** direction. The client mirrors the gap: `accept()` (line 66) upserts an accepted edge without checking that an incoming request exists.

**Risk.** Non-consensual friendship. The victim is never shown a request — `listIncoming` filters on `status === "pending"` (line 108), so a directly-inserted `accepted` edge is invisible in the requests UI while still granting friend standing. Impact today is limited (the friends leaderboard reads results that are already public and there is no chat), but the schema comment claims "friendship is mutual-accepted", and it is not.

**Fix.** Constrain the insert to `pending`, and permit the flip to `accepted` only when the counterpart edge exists:

```sql
drop policy "friends - insert own" on public.friends;
create policy "friends - request own" on public.friends
  for insert with check (auth.uid() = user_id and status = 'pending');

drop policy "friends - update own" on public.friends;
create policy "friends - accept own" on public.friends
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (
      status = 'pending'
      or exists (
        select 1 from public.friends f
        where f.user_id = friends.friend_id
          and f.friend_id = auth.uid()
      )
    )
  );
```

And make `accept()` refuse to invent an edge, rather than upserting one:

```ts
export async function accept(userId: string, friendId: string): Promise<void> {
  if (isCloud && supabase) {
    // Only ever an UPDATE: an accept with no incoming request is not an accept.
    await supabase
      .from("friends")
      .update({ status: "accepted" })
      .eq("user_id", userId)
      .eq("friend_id", friendId);
    return;
  }
  /* …unchanged local branch… */
}
```

Note the local-storage branch of `accept()` has the same shape and should be tightened alongside it, for parity of behaviour between dev and cloud.

---

## 4. `results.verdict` and `results.metrics` are unconstrained and rendered on public pages

**Files:** `supabase/schema.sql:52-60`; `app/r/[id]/page.tsx:126-135,170-172`; `app/api/og/[id]/route.tsx:180-191`; `lib/cloud/profiles.ts:81-95`

```sql
score numeric not null,
verdict text not null,          -- no CHECK
metrics jsonb not null default '{}'::jsonb,   -- no CHECK, no size bound
```

`results - insert own` validates only that `user_id = auth.uid()`. Everything else in the row is whatever the client sends. `verdict` is then rendered:

- as the page `<h1>` — `app/r/[id]/page.tsx:170-172`
- as the `<title>` and `og:description` — `app/r/[id]/page.tsx:126-135`
- as up-to-118px display type on the generated OG image — `app/api/og/[id]/route.tsx:190`

and `metrics.seed` / `metrics.engine` reach the page as free text through `provenanceRows` (`app/r/[id]/page.tsx:43-52`).

**This is not XSS.** React escapes the JSX and Next escapes the metadata; Satori renders text, not markup. The exposure is **content injection on a trusted origin**: any account (a magic-link signup is the only barrier) can mint `https://<your-domain>/r/<uuid>` displaying arbitrary attacker-chosen text as an official-looking "statement", complete with a matching social unfurl card served from your domain. That is a ready-made phishing artifact wearing your branding.

`profiles.username` has the same shape — `updateUsername` (`lib/cloud/profiles.ts:81`) enforces length only, and the file's own comment notes "profanity screening lands in Phase 2". Usernames render publicly on the leaderboard.

**Fix.** The verdict set is closed and already enumerated in `lib/verdict.ts` plus the three Rat Race strings. Pin it in the database:

```sql
alter table public.results
  add constraint results_verdict_known check (
    verdict in (
      -- lib/verdict.ts
      'Financially Free', 'Comfortable', 'Rich Enough',
      'Getting By', 'Underwater', 'The Estate',
      -- lib/cloud/buildResult.ts, resultFromCashflow
      'Escaped the Rat Race', 'Still Racing', 'Buried in Debt'
    )
  );

-- And keep metrics from becoming a document store.
alter table public.results
  add constraint results_metrics_small check (pg_column_size(metrics) <= 4096);
```

Belt and braces on the render side — treat an unknown verdict as unprintable rather than printing it:

```ts
// app/r/[id]/page.tsx
import { VERDICTS } from "@/lib/verdict";

/** The closed set. `VERDICTS` covers Story/Infinite; the Rat Race's three are literals
 *  in `resultFromCashflow`, so they are listed here rather than derived. */
const KNOWN_VERDICTS = new Set<string>([
  ...Object.values(VERDICTS).map((v) => v.title),
  "Escaped the Rat Race", "Still Racing", "Buried in Debt",
]);

/** A verdict this build does not recognise is not a verdict. */
function safeVerdict(v: string): string {
  return KNOWN_VERDICTS.has(v) ? v : "Run Closed";
}
```

and use `safeVerdict(row.verdict)` at both the `<h1>` and in `generateMetadata`. Apply the same in `app/api/og/[id]/route.tsx`. Add a username content filter before Phase 2 ships to a public leaderboard.

---

## 5. Unbounded `metrics.history` amplifies rendering on `/r/{id}`

**Files:** `app/r/[id]/page.tsx:148-154`; `lib/cloud/buildResult.ts:29`

The honest client caps the series at 100 points:

```ts
const hist = run.history.slice(-100); // cap the stored series for very long infinite runs
```

but that cap lives only in the client, and the reader applies none:

```ts
const rawHistory = row.metrics?.history;
const series = Array.isArray(rawHistory) ? rawHistory.map(Number).filter(Number.isFinite) : [];
const chartPoints = series.length > 1 && Number.isFinite(startYear)
  ? series.map((v, i) => ({ year: startYear + i, netWorth: v }))
  : null;
```

A row inserted directly against PostgREST with a 100,000-element `history` array causes the server component to map it twice and hand `AnnotatedLifeChart` a six-figure point count, which becomes SVG geometry in the streamed HTML. `/r/{id}` is unauthenticated and uncached, so each request pays it again.

**Risk.** Cheap self-inflicted DoS / bandwidth amplification against your own hosting bill, reachable by URL with no auth.

**Fix.** Cap at the reader, which is the boundary that actually matters. The `pg_column_size` constraint in finding #4 closes the ingest side.

```ts
/** The writer caps at 100 (lib/cloud/buildResult.ts); a row is not the writer, so cap here too. */
const MAX_SERIES = 200;

const rawHistory = row.metrics?.history;
const series = Array.isArray(rawHistory)
  ? rawHistory.slice(0, MAX_SERIES).map(Number).filter(Number.isFinite)
  : [];
```

While here: both `/r/{id}` and `/api/og/{id}` issue an uncached, unauthenticated database read per request. `/api/og` at least sets a long `cache-control` on hits. Consider `export const revalidate = 3600` on the `/r/{id}` page, since a `results` row is immutable (there is no UPDATE policy on the table).

---

## 6. Eleven further advisories in the transitive build chain

`npm audit` reports **12 vulnerabilities (3 moderate, 9 high)**. Beyond `next` (finding #1):

| Package | Severity | Direct | Note |
|---|---|---|---|
| `postcss` | High | yes | Arbitrary `.map` file read via attacker-controlled `sourceMappingURL` ([GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q), + incomplete-fix follow-ups) |
| `@tailwindcss/postcss` | Moderate | yes | inherits the above |
| `undici` | High | no | five advisories incl. response desync and cross-user cache disclosure |
| `sharp` | High | no | inherited libvips CVEs |
| `brace-expansion`, `nanoid`, `js-yaml`, `ip-address`, `fast-uri` | High | no | DoS / parsing |
| `hono`, `@hono/node-server` | Moderate | no | path traversal in `serve-static` (Windows) |

All are build-time or tooling dependencies rather than shipped browser code, which caps real-world exposure — the `postcss` source-map read matters only if untrusted CSS is ever compiled. All report `fixAvailable: true`.

**Fix**

```bash
npm audit fix
npm run build && npm run typecheck   # confirm nothing moved underneath
```

---

# Functional Bugs

## 7. An unhandled `getSession()` rejection locks the entire app on "Verifying ID"

**Files:** `hooks/useAuth.tsx:52-76`; `components/screens/AuthGate.tsx:250-251`

```ts
if (isCloud && supabase) {
  supabase.auth.getSession().then(async ({ data }) => {
    /* … */
    setLoading(false);          // ← the only place loading is ever cleared
  });
  // no .catch()
```

`loading` starts `true` and is cleared in exactly one place: inside the fulfilled branch of a promise with no rejection handler. If `getSession()` rejects — offline start, DNS failure, a Supabase outage, a blocked request — `loading` stays `true` for the life of the page and the promise rejects unhandled.

The gate renders on that flag:

```tsx
{loading ? (
  <p className="text-center"><TerminalOp label="Verifying ID" center /></p>
) : !user ? ( /* the sign-in form and the guest button */ ) : …}
```

**Impact.** A transient network failure permanently hides both the sign-in form *and* the "play as guest" button. Guest play needs no network at all — `continueAsGuest` only writes localStorage — so a player who would have been entirely unaffected is instead locked out of the game until they reload and get luckier. This is the highest-impact non-security finding: it converts a recoverable blip into a hard failure of the whole product.

**Fix.** Clear `loading` on both paths, and keep the guest fallback reachable:

```ts
useEffect(() => {
  let active = true;
  if (isCloud && supabase) {
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!active) return;
        const u = data.session?.user;
        if (u) await adoptGuestSaves(localPlayerId(), u.id);
        if (!active) return;
        setUser(u ? { id: u.id, email: u.email ?? "" } : storedGuest());
      })
      .catch(() => {
        // The network is not the gate. A session we cannot reach is not a session
        // that refused us — fall back to any remembered guest and let the player in.
        if (active) setUser(storedGuest());
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    /* …onAuthStateChange unchanged… */
```

`adoptGuestSaves` inside `onAuthStateChange` (line 69) is likewise unguarded; it is internally `try`-wrapped per mode, but a `.catch()` on that async callback would make the guarantee explicit.

---

## 8. `AudioEngine.setAmbience` leaks the outgoing ambience graph past teardown

**File:** `src/audio/AudioEngine.ts:888-903` (the offending line is `896`)

The engine tracks every deferred disposal so that teardown can cancel it, and documents exactly why at `AudioEngine.ts:726-734`:

> The handle is tracked so `dispose()` can cancel it. Without that, tearing the engine down leaves every in-flight SFX holding a timer that fires into a dead graph seconds later […] it keeps the disposed nodes reachable, so the teardown does not actually finish until the last SFX would have finished ringing.

Every one-shot in the file routes through `disposeLater`. `setAmbience` does not:

```ts
if (this.currentAmb) {
  const prev = this.currentAmb;
  prev.out.gain.cancelScheduledValues(now);
  prev.out.gain.linearRampTo(0, 0.7, now);
  setTimeout(() => { try { prev.dispose(); } catch {} }, 900);  // ← untracked
  this.currentAmb = null;                                       // ← now unreachable to dispose()
}
```

Two things go wrong together. The timer is not in `pendingDisposals`, so `dispose()` (line 1028) cannot cancel it; and `currentAmb` is nulled immediately, so `dispose()`'s own `this.currentAmb?.dispose()` (line 1034) finds nothing. The outgoing ambience — a full oscillator/filter/loop chain from `buildAmbience` — stays reachable for 900 ms after the engine claims to be torn down, and is freed by a timer firing into a dead graph.

**Impact.** Bounded and non-crashing (the call is `try`-wrapped), but it is precisely the leak the `disposeLater` contract exists to prevent, and it repeats on every ambience change across a session.

**Fix.** Use the mechanism the rest of the file uses:

```ts
if (this.currentAmb) {
  const prev = this.currentAmb;
  prev.out.gain.cancelScheduledValues(now);
  prev.out.gain.linearRampTo(0, 0.7, now);
  // Tracked, so `dispose()` can cancel it — same contract as every one-shot voice.
  this.disposeLater(prev, 0.9);
  this.currentAmb = null;
}
```

`disposeLater` accepts any `{ dispose(): void }`, and `currentAmb` satisfies it, so no other change is needed.

---

# Code Quality / Performance Issues

## 9. PostgREST `.or()` filter assembled by string interpolation

**File:** `lib/cloud/friends.ts:90`

```ts
.or(`user_id.eq.${userId},friend_id.eq.${userId}`)
```

`userId` is auth-derived and in practice a UUID, so this is not currently exploitable — but `.or()` takes a filter *expression*, and commas, parentheses and dots are structural inside it. This is the one place in the codebase that builds a query grammar by concatenation, and it is one careless caller (a device id, a future guest path) away from mattering.

**Fix.** Refuse a value that cannot be a UUID before it reaches the grammar:

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listEdges(userId: string): Promise<FriendEdge[]> {
  if (isCloud && supabase) {
    // `.or()` takes an expression, not a value — anything that is not a plain
    // uuid is structure, not an id, and does not belong in it.
    if (!UUID_RE.test(userId)) return [];
    const { data } = await supabase
      .from("friends")
      .select("*")
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`);
    return (data ?? []).map(fromRow);
  }
  return readLocal(userId);
}
```

## 10. `drawEvents` spins 59 wasted iterations when the eligible pool is smaller than the draw

**File:** `lib/runEngine.ts:354-359`

```ts
let guard = 0;
while (picks.length < want && guard < 60) {
  guard++;
  const id = weighted[Math.floor(rng() * weighted.length)];
  if (!picks.includes(id)) picks.push(id);
}
```

When `want === 2` (35% of years) and the eligible pool holds one distinct event, the first iteration takes it and the remaining 59 each draw from the stream and discard. Correctness is unaffected — the stream is re-seeded per `(seed, year)`, so replay still matches, which is why this is a quality note and not a bug — but it is 59 needless `mulberry32` steps, and it is on the hot path of every `advanceYear` including every ghost-line and verification replay.

**Fix.** Bound the draw by what is actually distinct:

```ts
// Never ask for more distinct cards than the pool can supply.
const target = Math.min(want, mine.length);
let guard = 0;
while (picks.length < target && guard < 60) {
  /* …unchanged… */
}
```

Note this preserves the stream position in the common case (`mine.length >= want`), so recorded runs and `scripts/qa/golden-draws.json` are unaffected. It changes stream consumption only in the degenerate case, which currently produces a one-card year either way.

## 11. CSP restricts embedding but not form submission

**File:** `next.config.ts:14`

```ts
{ key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
```

The deliberately-minimal policy is a defensible call — the comment explains that omitting `script-src` keeps Next hydration, Tone.js and Supabase working without a nonce pipeline. Two directives cost nothing and close real gaps: `form-action 'self'` (a defence against injected form targets that does not interact with hydration at all), and `frame-src 'none'` given the app embeds nothing.

**Fix**

```ts
{
  key: "Content-Security-Policy",
  value: "frame-ancestors 'none'; frame-src 'none'; form-action 'self'; object-src 'none'; base-uri 'self'",
},
```

## 12. `eslint@8.57.1` is end-of-life

**File:** `package.json:44`

ESLint 8 left support in October 2024 and receives no security fixes. `eslint-config-next@15` supports ESLint 9. Worth scheduling alongside the `npm audit fix` in finding #6, though it is a config migration (flat config) rather than a drop-in bump.

---

## What was checked and found clean

Recorded so the next reviewer does not re-walk it:

- **No hardcoded secrets.** A repository-wide scan for API-key, JWT, AWS and service-role patterns found only the `.env.local.example` comment *warning against* pasting a service-role key. `NEXT_PUBLIC_*` usage is correct throughout.
- **No injection sinks.** No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, or `document.write` anywhere in `.ts`/`.tsx`. All Supabase access goes through the client's parameterised builders. The one raw REST call (`app/api/og/[id]/route.tsx:41`) is gated by a strict UUID regex first (line 39).
- **Listener and timer hygiene.** Every `addEventListener` is paired with a `removeEventListener`; every `setInterval`/`requestAnimationFrame` is cleared, with the single exception at finding #8.
- **The multiplayer wire is genuinely defended.** `lib/mp/protocol.ts` rebuilds `RunState` field by field with clamped numeric bounds (`MONEY_LIMIT`, `MAX_HISTORY`, `MAX_ACTS_PER_YEAR`), rejects mismatched protocol and engine versions, and refuses a presence row that speaks for another player (line 403). `hooks/useMatch.tsx` additionally fences inbound `status` and `snapshot` by roster membership and session ownership (lines 789-830). The residual gap — `snapshotReply` is accepted from any room member (line 855) — falls inside the trust model the file states outright at lines 777-779 ("Airtight needs a server authority, which is out of scope by contract") and is not reported as a defect.
- **The daily puzzle's UTC/local split is correct.** `lib/daily.ts:14-20` and `lib/cloud/streaks.ts:27` deliberately disagree, and the reasoning documented for it holds.
- **The replay path is faithful.** `lib/replay.ts` refuses on desync rather than interpolating, and `verifyResult`'s limits are stated accurately both in code (lines 180-185) and in the UI copy on `/r/{id}` (line 215-218). The `open` flag and `hasFullJournal`'s year-identity check line up correctly across all five terminal states.
- **Leaderboard score integrity** is client-asserted by design and the product says so rather than overclaiming. Not reported as a finding; server-side scoring would be the only real fix and is a product decision, not a defect.

---

## Suggested order of work

1. `npm install next@^15.5.21` and `npm audit fix` — findings #1 and #6, minutes of work, closes nine high advisories.
2. The `useAuth` `.catch()`/`.finally()` — finding #7, three lines, removes a hard lockout.
3. The `profiles` and `friends` RLS migration — findings #2 and #3, the two policies that do not do what their comments say. Rotate friend codes after.
4. Verdict `CHECK` + `metrics` size cap + the `MAX_SERIES` slice — findings #4 and #5, one migration and one line.
5. The remaining quality items — #8 through #12.
