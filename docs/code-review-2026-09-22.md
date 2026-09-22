# LifePatch — Codebase Review

**Date:** 2026-09-22 · **Commit:** `claude/eager-cori-3wdcht` · **Scope:** app, components, hooks, lib, src, supabase, scripts, config

## Verdict up front

This codebase is unusually well hardened, and the review should say so plainly rather than manufacture findings. The
obvious vulnerability classes are closed and documented with reasoning:

- **No injection sinks.** Zero occurrences of `dangerouslySetInnerHTML`, `eval`, `new Function` or `innerHTML` anywhere
  in the tree.
- **No hardcoded secrets.** `.env*.local` is gitignored; only `.env.local.example` is tracked. No service-role key,
  token or password literal in source.
- **RLS is tested, not asserted.** `scripts/qa/rls-migration.mjs` stands up a real Postgres, runs attack probes that
  must report VULNERABLE *before* migrating and CLOSED *after*, then repeats against a fresh `schema.sql`.
- **Untrusted input is parsed, not cast.** `lib/mp/protocol.ts`, `lib/metrics.ts`, `lib/challenge.ts` and
  `lib/deepLink.ts` rebuild every inbound value field by field with explicit range clamps.
- **Gates are green.** `tsc --noEmit` clean, `eslint .` clean, and 9 of 11 QA gates pass (the two that fail —
  `qa:audio`, `qa:mp` — need a dev server on `:3000`; both exit 1 correctly, so they are not silently passing).

What follows is what survived that. Nothing found rises to a classic critical (no RCE, no authorization bypass, no
secret exposure). The most serious item is a **schema/migration drift that silently downgrades a security control on
any newly created project**.

---

## 1 · Critical Security Vulnerabilities

*None found.* See the verdict above.

---

## 2 · High — Security Control Degradation

### 2.1 `schema.sql` is missing two functions the app calls — the rename rate limiter silently degrades on every fresh install

**Files:** `supabase/schema.sql` (whole file) · `supabase/migrations/2026-09-02_09_rename_limit_atomic.sql:68` ·
`supabase/migrations/2026-09-02_10_top_results.sql:45` · `supabase/functions/profile/index.ts:256,277` ·
`scripts/qa/rls-migration.mjs:52-70`

**Risk.** There are two documented ways into this schema — `schema.sql` for a new project, `migrations/` in order for an
existing one — and `schema.sql`'s own header says they reach the same end state. They do not. Two functions defined in
migrations are absent from `schema.sql`:

```
$ grep -c "spend_rename_attempt" supabase/schema.sql   # 0
$ grep -c "top_results"          supabase/schema.sql   # 0
```

The consequence for `spend_rename_attempt` is a security regression, not a cosmetic one. `profile/index.ts:256` calls
the RPC; when it is missing the handler logs and falls back to the non-atomic read-modify-write at line 278:

```ts
const spend = await admin.rpc("spend_rename_attempt", { uid: userId });
if (!spend.error) { /* atomic path */ }
console.error("rename limiter: spend_rename_attempt unavailable, falling back", spend.error);
const { data, error } = await admin.from("profiles").select("rename_window_start,rename_attempts")…
```

That fallback is exactly the race migration 09 was written to remove — its own header states it: *"N requests issued
together all read 0, all decided 'allowed', and all wrote 1. The counter landed on 1 whatever N was."* The limiter
exists to bound a **username-enumeration oracle** (`rename` answers 409 "taken" vs 400 "refused"; the Edge Function's
own comment calls unlimited attempts an oracle for who exists). On a fresh install the ceiling therefore bounds only
*sequential* attempts — which is not how anyone walking a namespace issues them. The fallback is meant to cover one
deploy window; here it is permanent.

`top_results` missing is performance-only but real: `lib/cloud/results.ts:276` falls through to the page-walk, costing
up to **six sequential round trips plus a seventh for profiles** on every leaderboard load — the exact cost migration 10
was written to remove.

**Why the gate did not catch it.** The FRESH pass re-runs `10_attack_probes.sql`, which tests policies and grants, not
function existence. Separately, migration 10 is absent from the gate's `MIGRATIONS` list even though it creates a
function *and* grants EXECUTE to `anon, authenticated` — the list's own comment says such a migration "belongs here the
moment it is written."

**Fix.** Append both function definitions (with their REVOKE/GRANT lines) to `schema.sql`, register migration 10 in the
gate, and add an existence assertion so the drift cannot recur:

```sql
-- supabase/schema.sql — append, verbatim from migrations 09 and 10
create or replace function public.spend_rename_attempt(uid uuid)
returns table (allowed boolean, retry_after int)
language plpgsql security definer set search_path = public
as $$ … $$;   -- body: 2026-09-02_09_rename_limit_atomic.sql:68-124
revoke all on function public.spend_rename_attempt(uuid) from public, anon, authenticated;
grant execute on function public.spend_rename_attempt(uuid) to service_role;

create or replace function public.top_results(
  p_mode text, p_limit int default 25, p_since timestamptz default null,
  p_background text default null, p_daily text default null, p_users uuid[] default null)
returns table (…) language sql stable security invoker set search_path = public
as $$ … $$;   -- body: 2026-09-02_10_top_results.sql:45-88
grant execute on function public.top_results(text, int, timestamptz, text, text, uuid[])
  to anon, authenticated;
```

```js
// scripts/qa/rls-migration.mjs — add to MIGRATIONS
"supabase/migrations/2026-09-02_10_top_results.sql",
```

```sql
-- supabase/tests/20_still_works.sql — the assertion that keeps the two files in step
select case when to_regprocedure('public.spend_rename_attempt(uuid)') is null
  then 'FAIL: spend_rename_attempt missing' else 'PASS: rename limiter is atomic' end;
select case when to_regprocedure(
    'public.top_results(text,int,timestamptz,text,text,uuid[])') is null
  then 'FAIL: top_results missing' else 'PASS: leaderboard is one round trip' end;
```

---

## 3 · Medium — Security

### 3.1 A disconnected player's cached life can be overwritten by any room member, and it reaches the public leaderboard

**File:** `hooks/useMatch.tsx:1073-1102` (snapshot handler), `:639-643` (`sameWorld`)

**Risk.** The snapshot cache is fenced three ways — roster membership, session ownership, and freshness:

```ts
if (!isRosterMember(msg.playerId)) return;
const owner = sessionOwnersRef.current.get(msg.playerId);
if (owner && msg.sessionId !== owner) return;     // fails OPEN when no owner is known
if (!sameWorld(msg.state)) return;
const held = snapshotsRef.current.get(msg.playerId);
if (held && yearIndex(held) > yearIndex(msg.state)) return;
```

The session fence fails open by design, because the acting host relays sessionless snapshots for absent players — and an
absent player has no presence, so no owner is ever known for them. That is correct for the relay, but it means that
while a player is disconnected, **any** roster member (not only the acting host) can write their cached life. `sameWorld`
only checks `mode`, `seed` and `backgroundId` — not money:

```ts
return state.mode === "story" && state.seed === cfg.seed && state.backgroundId === cfg.backgroundId;
```

So a forged `RunState` on the right world, at an equal-or-higher `yearIndex`, is accepted. `parseRunState` clamps
`holdings` to `MONEY_LIMIT` (1e12), which is the ceiling, not a constraint. That cache is what the player is handed on
rejoin — and a match run posts to the public board as `mode: "story"` (`lib/cloud/buildResult.ts:27-93`), so the forged
figure can become a leaderboard row under the victim's account.

**Caveat, stated fairly.** `useMatch.tsx:1039` declares authority "out of scope by contract" — rooms are
code-gated and peer-to-peer, and this is a known posture, not an oversight. What is worth escalating is the *reach*: the
consequence leaves the room and lands on a public, unauthenticated board.

**Fix (cheapest option that keeps the relay working).** Require the freshness comparison to be strict, so an equal-year
snapshot cannot displace a held one, and refuse a relayed snapshot whose net worth jumps implausibly between years:

```ts
// hooks/useMatch.tsx — replace the freshness fence
const held = snapshotsRef.current.get(msg.playerId);
if (held && yearIndex(held) >= yearIndex(msg.state)) return;   // was `>`
```

Longer term, the honest fix is to stop treating a room run as leaderboard-eligible, or to require `verified: 1`
(`lib/replay.ts:189`) on any row carrying `shared: 1`.

---

## 4 · Functional Bugs

### 4.1 `bestPerUser` has no tiebreak, so tied leaderboard scores rank non-deterministically

**File:** `lib/cloud/results.ts:182-190`

```ts
return Array.from(best.values()).sort((a, b) => b.score - a.score);
```

`Array.from(map.values())` yields *insertion* order, which differs between the RPC path and the page-walk fallback (and
between page tilings). `sort` is stable, so tied scores keep whatever order they arrived in. Demonstrated:

```
map insertion order A -> r1,r2,r3
map insertion order B -> r3,r1,r2      (same three rows, all score 100)
```

This contradicts an invariant the codebase states twice and enforces everywhere else — `top_results` orders
`by b.score desc, b.id asc` with the comment *"ties broken by id so the result is a total order and two calls cannot
disagree"*, and the page-walk adds `.order("id", { ascending: true })` for the same reason. `bestPerUser` is described at
line 274 as *"the one place the board's ranking rules live"*, and it is the one place the tiebreak is missing. Because
`.slice(0, limit)` runs after this sort, tied players at the cutoff can appear and disappear between reloads.

**Fix:**

```ts
return Array.from(best.values()).sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
```

### 4.2 `tickStockPrices` consumes four RNG coordinates but reserves one, so tickers inherit each other's shocks

**File:** `lib/cashflow/engine.ts:320-337`

```ts
const shock = (rngAt(s.seed, s.rngCursor + 101 + i) - 0.5) * 0.14 * Math.min(volatility, 4);   // :326
…
return { ...s, stockPrices: prices, rngCursor: s.rngCursor + 1 };                              // :336
```

The loop reads `STOCK_CATALOG.length` (4) consecutive coordinates — `c+101 … c+104` — but advances the cursor by 1. Any
cursor advance smaller than 4 between two market cards causes ticker *i* to receive the exact draw ticker *i+1* used on
the previous tick. Isolated demonstration (cursor advancing by 1):

```
tick  ticker0   ticker1   ticker2   ticker3
0     0.479023  0.955521  0.637595  0.056227
1     0.955521  0.637595  0.056227  0.558926
2     0.637595  0.056227  0.558926  0.452759
identical draws reused across ticks: 15/15
```

In real play the gap between two market squares is a dice roll plus `drawMarket` plus the tick — typically 3-6 — so the
overlap is partial rather than total, but it is reachable (advance of 3 reuses one of four coordinates). The result is a
quote board whose "independent per-ticker" shocks are a single sequence sliding across the catalog. In a mode whose
leaderboard ranks on net worth, that is a learnable pattern — the same class of defect the `BAND_PULL` rewrite was
written to remove ("not a decision, an arbitrage").

**Fix — reserve the window the function actually spends:**

```ts
return { ...s, stockPrices: prices, rngCursor: s.rngCursor + STOCK_CATALOG.length };
```

Note this changes the draw sequence, so it invalidates recorded Rat Race replays; pair it with a `scoreVersion` bump in
`lib/cloud/buildResult.ts` (`CASHFLOW_SCORE_VERSION`) exactly as v2→v3 did.

### 4.3 `myBest` local branch can return an unrankable row the cloud branch would skip

**File:** `lib/cloud/results.ts:393-409`

The cloud branch deliberately over-fetches and skips bad rows — `.limit(5)` then `.find(rankable)`, with a comment
explaining that an unrankable row sorts to the top. The local branch does neither:

```ts
return rows.reduce((best, r) => (r.score > best.score ? r : best));
```

With a `NaN` score in `rows[0]`, `r.score > best.score` is false in both directions, so the NaN row is returned as the
player's best run. `localStorage` is player-editable, and `readLocal` casts parsed JSON straight to `ResultRow[]` with no
shape guard, so this is reachable.

**Fix:**

```ts
const ranked = rows.filter(rankable);
if (ranked.length === 0) return null;
return ranked.reduce((best, r) => (r.score > best.score ? r : best));
```

---

## 5 · Code Quality / Performance

### 5.1 `Object.entries()` materialises before the cap in two wire parsers

**File:** `lib/mp/protocol.ts:386-406`

```ts
for (const [k, v] of Object.entries(raw.flags).slice(0, MAX_FLAGS)) { … }
for (const [k, v] of Object.entries(raw.yearChoices).slice(0, MAX_EVENT_IDS)) { … }
```

Both build the *entire* entries array before slicing, so a peer sending an object with a million keys allocates a
million-entry array per message. Array inputs in the same file are handled correctly (`raw.history.slice(0, MAX_HISTORY)`
caps before iterating). The damage is largely already done at `JSON.parse` inside the realtime client, so this is a
mitigation rather than a fix — but it is one line and matches the file's own stated posture that "shapes are checked
field by field."

**Fix:**

```ts
let n = 0;
for (const k in raw.flags as Record<string, unknown>) {
  if (n++ >= MAX_FLAGS) break;
  const y = int((raw.flags as Record<string, unknown>)[k], 0, 4000);
  if (k.length <= 48 && y !== null) flags[k] = y;
}
```

### 5.2 `rollOutcome`'s boundary test would select a zero-weight outcome

**File:** `lib/runEngine.ts:521-533`

```ts
let r = rng() * total;
for (let i = 0; i < choice.outcomes.length; i++) {
  r -= choice.outcomes[i].weight;
  if (r <= 0) return i;
}
```

When `rng()` returns exactly `0` (mulberry32 can), `r` starts at 0 and the first outcome is selected regardless of its
weight. **Unreachable today** — no outcome in `lib/lifeEvents.ts` has `weight: 0` — so this is a latent hazard, noted
only because the engine is replay-critical and a future zero-weight outcome would break determinism assumptions
silently. Changing `<=` to `<` is safe and equivalent for all current content.

### 5.3 Operational notes

- `qa:audio` and `qa:mp` require a dev server on `:3000` and fail with a Playwright navigation error otherwise. Both
  exit `1` correctly, so they cannot silently pass — but a `SessionStart` hook or a preflight check that says *"start
  `npm run dev` first"* would save a confusing stack trace.
- `package.json` has no `"type": "module"`, so every `.mjs` gate that imports the `_shared/*.ts` sources emits a
  `MODULE_TYPELESS_PACKAGE_JSON` reparse warning. Cosmetic, and noisy in CI logs.

---

## Appendix — what was checked and found clean

| Area | Result |
|---|---|
| CSP / security headers (`next.config.ts`) | Sound. `script-src` omission is a documented, defensible trade-off; `connect-src` fails to `'self'` rather than silence. |
| RLS policies + column grants (`supabase/schema.sql`) | Correct. Table-level grants revoked before narrower re-grants — the only order that works. |
| `profiles_public` view | `security_invoker = off` with `revoke all` before `grant select`; friend code correctly absent. |
| Edge Function auth (`profile/index.ts`) | `verify_jwt` + `auth.getUser`; caller cannot name the row it writes. CORS allow-list, no `*`. |
| Username filter (`_shared/username.ts`) | Charset regex mirrors the DB CHECK; 1728 generated + 22 innocent names accepted, 24 abusive refused. |
| CSPRNG usage (`_shared/generate.ts`) | `crypto.getRandomValues` with modulo-bias rejection; friend codes not `Math.random`. |
| OG route (`app/api/og/[id]/route.tsx`) | UUID-validated, 2.5s abort, never 500s, unknown ids 302 to a cacheable card. |
| Untrusted parsers (`mp/protocol.ts`, `metrics.ts`, `challenge.ts`, `deepLink.ts`) | Field-by-field rebuild with range clamps; no pass-through by reference. |
| Audio engine (`src/audio/AudioEngine.ts`) | Every deferred disposal tracked in `pendingDisposals` and cancellable from `dispose()`. No leaked timers. |
| Auth fallback (`lib/supabase.ts`, `hooks/useAuth.tsx`) | `cloudMisconfigured` refuses the fabricated dev account in production builds. |
| `tsc --noEmit` / `eslint .` | Both clean. |
