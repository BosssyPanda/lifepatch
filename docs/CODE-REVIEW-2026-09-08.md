# LifePatch — codebase review, 2026-09-08

Security, correctness and performance pass over the whole tree: 246 source files,
the Supabase schema and its eleven migrations, the two Edge Function modules, the
Next config and the dependency graph.

Every claim below was checked rather than inferred. Where something was measured,
the measurement and the way it was taken are given. Where a finding is a judgement
call rather than a demonstrated fault, it says so.

**What was run:** `tsc --noEmit` (clean), `eslint .` (clean), `npm audit`,
and the project's own gates — `qa:challenge` 10/10, `qa:cloud` 16/16,
`qa:engine` 34/34, `qa:metrics` 19/19, `qa:rename` 16/16, `qa:username` (1,728
generated names), `qa:rls` (16 probes closed, 24 behaviours intact). All pass.

**Headline:** this codebase has been hardened hard and it shows. The injection
surface is genuinely closed — no `dangerouslySetInnerHTML`, no `eval`, no
`innerHTML`, no user-supplied markup anywhere in the tree, no hardcoded secrets,
and the one player-authored string that reaches another player's screen is
charset-locked in three places at once. The RLS work is unusually thorough:
column grants are revoked before being re-granted, the auto-updatable view hole
is closed, `NaN` is fenced out of every ordering, and the attack probes are
checked in. **No critical vulnerability was found, and none is being reported
as one.** The findings below are real but none of them is a break-glass.

The one that matters is S1, because it is the single stated security property of
the friends feature not actually holding at the database — and it was confirmed
by running the attack, not by reading the policy.

---

## S1 · The friend-code capability is enforced only in the browser

**Severity:** High (abuse / spam vector; no data disclosure)
**Files:** `supabase/schema.sql:161-162` (the view grant), `supabase/schema.sql:411-415`
(`friends - write own side`), `lib/cloud/friends.ts:92-115` (`addByCode`)

### The claim the schema makes

`supabase/schema.sql` states the property in its own words, twice — the friends
layer rests on *"added by code, never by search"*, and `friend_code` is
*"the sole capability guarding addByCode"*. The lockdown migrations went to real
lengths to protect that code: `profiles` is select-own-row-only, `profiles_public`
deliberately omits `friend_code`, `profile_by_friend_code` is a point query that
never returns the code back, and the column is unwritable by any client role.

All of that holds. I verified the control case: a signed-in player reading
`public.profiles` for anybody but themselves gets **0 rows**. Friend codes are not
leaking.

### What does not hold

The code is never actually *required*. Two facts compose:

1. `profiles_public` is granted `select` to `authenticated` with no row filter, so
   any signed-in client can read **every player's `id`** out of it.
2. The `friends` insert policy checks only `auth.uid() = user_id` and
   `status = 'pending'`. It says nothing about *how* the caller came to know
   `friend_id`.

`addByCode` resolves a code to an id and then inserts — but the code half is
client-side decoration. A caller posting straight at PostgREST skips it, exactly
the way username screening used to be skippable before the `profile` Edge
Function was written. There is no cap on rows per player and no rate limit.

### Verified, not assumed

Against a throwaway Postgres cluster loaded with the current `supabase/schema.sql`
and the project's own `supabase/tests/00_supabase_harness.sql` (which reproduces
Supabase's roles and `auth.uid()`), seeded with 302 players:

```
--- A. can any signed-in player enumerate every other player? ---
OPEN: profiles_public returned 302 rows (every player id + username)

--- B. friend request WITHOUT knowing the target friend_code ---
OPEN: pending friend edge written with no friend_code (id from profiles_public)

--- C. bulk, ids harvested from profiles_public ---
SPAM: 301 unsolicited pending edges accepted from one account

--- D. what the victim sees ---
INBOX: victim has 1 pending request(s) they never invited

--- E. control: is friend_code itself still protected? ---
CLOSED: read 0 other profile rows
```

One account, one loop, no friend code anywhere: a pending request at every player
in the database. Each one surfaces in that player's `FriendsSheet` via
`listIncoming`, and the table grows without bound.

### Recommendation

The honest fix is to bound the write, since the capability cannot be reconstructed
after the fact — an id is public by necessity (the leaderboard needs it) and a
policy cannot ask "did you know the code". Bound outbound *unaccepted* requests,
which is the shape being abused and is cheap to state:

```sql
-- Cap unanswered outbound requests. An accepted friendship is not spam, so only
-- `pending` edges count toward the ceiling; a player who is actually making
-- friends is never blocked by this. SECURITY DEFINER for the same reason
-- `results_cap_per_player` is: this is a schema invariant, not a user action.
create or replace function public.friends_request_cap()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare cap constant int := 50; n int;
begin
  if new.status <> 'pending' then return new; end if;
  select count(*) into n
    from public.friends
   where user_id = new.user_id and status = 'pending';
  if n >= cap then
    raise exception 'too many pending friend requests'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.friends_request_cap() from public, anon, authenticated;

drop trigger if exists friends_request_cap on public.friends;
create trigger friends_request_cap
  before insert on public.friends
  for each row execute function public.friends_request_cap();
```

**This DDL was run, not just written.** Applied to the same throwaway cluster on
top of the current `schema.sql`:

```
--- 1. the spam run, with the cap in place ---
CAPPED: 50 edges accepted (was 121 uncapped on this seed)

--- 2. a real friendship must still work end to end ---
ACCEPT: reciprocal accepted edge written = t

--- 3. accepted edges must NOT count toward the pending ceiling ---
ACCEPTED-OK: accepted edges written despite the pending cap
```

The accept path is the one that had to be checked rather than assumed: accepting
is an INSERT of the reciprocal edge, not an update (`lib/cloud/friends.ts:129`), so
a cap written carelessly would block people from answering their own requests. It
does not — the `status <> 'pending'` early return sees to that.

Pair it with a Supabase rate limit on `profile_by_friend_code` (see S2). `addByCode`
already distinguishes error codes properly, so surfacing the refusal is a message
change in `AddFriendResult`, not a restructure.

**Caveat worth stating:** this bounds the blast radius, it does not restore the
"by code only" property. Genuinely restoring it means either not publishing ids in
`profiles_public` (which the leaderboard needs) or making the insert carry the code
— e.g. a `security definer` `request_friend(code text)` RPC as the only writer of
`friends`, mirroring exactly what the `profile` function did for `profiles`. That
is the structurally correct answer and it is a larger change; the trigger above is
the one that can land today.

---

## S2 · `profile_by_friend_code` has no rate limit, and the UI it was gated on has shipped

**Severity:** Medium
**File:** `supabase/migrations/2026-08-27_01_security_additive.sql:69`

The function's own comment says it:

> *Codes are 6 chars over a 31-glyph alphabet (~887M); consider a Supabase rate
> limit if the friends UI ever ships.*

The friends UI has shipped — `components/social/FriendsSheet.tsx` is wired and
calls `addByCode`. The condition attached to that note is met and the limit was
never added.

887M is a large space and blind brute-force for one specific code is not the
realistic attack. The realistic one is *harvesting*: unlimited point lookups let a
caller sweep the space for any valid code at whatever rate the platform allows,
and a hit is a capability. It also composes with S1 — an attacker who wants
plausible-looking requests rather than a mass insert can use this.

**Recommendation:** apply a Supabase rate limit to the RPC. The durable
per-user counter pattern already exists in this repo and is well documented —
`spend_rename_attempt` (migration `2026-09-02_09`) does the read and the write in
one statement so concurrent callers serialise. The same shape applies here, keyed
on `auth.uid()`. Note the rename limiter's *fail-open* posture is correct there and
would be wrong here: a lookup limiter that cannot read its counter should refuse,
because the cost of refusing is one retry rather than a lost feature.

---

## S3 · `streaks` is public-read and self-writable with no column narrowing

**Severity:** Low — and already documented as accepted
**File:** `supabase/schema.sql:336-372`

Confirmed on the live schema: a player can set their own row to
`current = 100000, longest = 100000` and it lands. The `streaks_sane` CHECK bounds
it (100,000 days = 273 years) and the schema's own comment reasons this through
honestly — nothing ranks on a streak, so it is cosmetic rather than competitive,
*"which is why it is a CHECK and not a redesign"*.

I agree with that call and am not asking for it to be reversed. Restating it only
because the surrounding tables have since had the treatment that would close it:
`results` and `profiles` both narrow the table grant and re-grant the specific
columns. `streaks` is now the one client-written table that did not get that pass.
If it is ever revisited, the cheap version is to move the bump into a
`security definer` `bump_streak()` — the consecutive-day rule is already a pure
function (`nextStreak` in `lib/cloud/streaks.ts:110`) and would port directly.

---

## S4 · Two moderate transitive advisories, one on a production path

**Severity:** Low
**File:** `package.json` / `package-lock.json`

`npm audit`: 2 moderate, 0 high, 0 critical.

| Package | Version | Advisory | Path | Ships to prod? |
|---|---|---|---|---|
| `fflate` | 0.6.10 | [GHSA-px8p-9vwx-vf98](https://github.com/advisories/GHSA-px8p-9vwx-vf98) — infinite loop on malformed ZIP64 | `@react-three/rapier` → `three-stdlib` | **Yes** (dependency, not dev) |
| `qs` | 6.15.3 | [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) + DoS via `isBuffer` | `shadcn` → `@modelcontextprotocol/sdk` → `express` | No — `devDependencies` |

Neither is reachable in practice as far as I can tell: `fflate` is pulled in by
`three-stdlib`'s asset loaders and this app loads no ZIP-backed assets, so the
vulnerable function is almost certainly never called and probably never bundled.
`qs` is behind a CLI dev tool and never runs in the browser.

**Recommendation:** `npm audit fix` resolves both and the report says a fix is
available for each. Low urgency, but it is a one-command change and it keeps the
next audit output honest rather than habitually ignored.

---

## P1 · The leaderboard reads every result row in the mode to render 25

**Severity:** Medium — grows with the table, and this is the app's busiest query
**Files:** `supabase/migrations/2026-09-02_10_top_results.sql`, `supabase/schema.sql:229-230`

`top_results` is `select distinct on (r.user_id) … order by r.user_id, r.score desc`.
The two indexes on the table are `(mode, score desc)` and `(user_id)`, and neither
serves that ordering — so the planner walks every row for the mode and sorts it.
The cost scales with **total stored rows**, not with board size, and
`results_cap_per_player` permits 500 rows per player per mode.

### Measured

Same throwaway cluster, current `schema.sql`, 2,000 players × 40 story runs =
80,000 rows. `EXPLAIN (ANALYZE)`, warm cache, `limit 25`:

| Variant | Rows scanned | Execution |
|---|---|---|
| **V1 — as shipped** (Incremental Sort over `results_user_idx`) | 80,000 | **115.7 ms** |
| **V2 — plus `(mode, user_id, score desc, id)`** | 80,000 | **36.7 ms** |
| V3 — pick winning ids first, then join the heap | 80,000 | 66.3 ms |

V2 is a **3.2× improvement for one index and no query change**. V3 (rewriting the
function to defer the heap access) is both slower and more complex — it was tried
and is reported here so it is not tried again.

An early run showed V2 looking *worse* on buffer counts; that was a cold-cache
artifact immediately after `create index`, and it reverses on a warm run after
`ANALYZE`. Flagging it because it is the kind of measurement that misleads once.

```sql
create index if not exists results_mode_user_score_idx
  on public.results (mode, user_id, score desc, id);
```

**Note the ceiling this does not raise.** All three variants still touch all 80,000
rows — `distinct on` over an unbounded table is inherently linear, and the index
makes each row much cheaper rather than skipping any. At a few hundred thousand
rows that is still fine; if the table reaches millions, the real answer is a
materialised best-per-player table maintained by the existing insert trigger, not
another index. Not needed yet.

---

## P2 · The segmented boards filter on unindexed jsonb expressions

**Severity:** Low
**Files:** `lib/cloud/results.ts:300-310`, `README.md:44-57`

`backgroundId` and `daily` scopes filter on `metrics->>'backgroundId'` and
`metrics->>'daily'`. Both run in the database (correct — the schema comment is
right that this beats filtering a page client-side), but neither is indexed, so
each is a scan. `README.md` already carries the DDL for
`results_background_idx` / `results_seed_idx` / `results_daily_idx` and calls them
optional.

They compose with P1 rather than duplicating it: P1's index fixes the ordering,
these fix the filters. **Recommendation:** apply the README's three expression
indexes alongside P1. They are already written; they just are not applied.

---

## P3 · Migration 10 is optional, and the fallback is up to seven serial round trips

**Severity:** Low (process, not code)
**File:** `lib/cloud/results.ts:258-290`

`topResults` calls the `top_results` RPC and falls through to a page-walk when it
errors. That "no deploy ordering required" posture is a deliberate and good pattern
— it appears in `fromFunction` too — but it means a project that never applies
migration 10 silently keeps the slow path forever, and the code cannot tell anyone.
The walk is up to 6 **sequential** round trips plus a 7th for profiles; the
migration header measures that at over a second of spinner on mobile.

**Recommendation:** this needs a deploy checklist rather than a code change.
Migrations 09 and 10 are both optional-but-wanted and both fail silently-slow
rather than loudly. Worth a line in `README.md` listing which migrations are
applied on the live project.

---

## Q1 · `qa:audio` hard-crashes where every other gate skips cleanly

**Severity:** Low (process)
**File:** `scripts/qa/audio-integration.mjs:42`

On a clean checkout `npm run qa:audio` dies with an unhandled Playwright error:

```
'  - navigating to "http://localhost:3000/", waiting until "domcontentloaded"'
Node.js v22.22.2
```

It needs a dev server on :3000 and does not start one. Compare `qa:rls`, which
checks for its dependency and says so:

> `• no local PostgreSQL (psql + initdb + pg_ctl) — skipping the RLS gate`

and explicitly reasons that *"this gate needs a server; a machine without one is
not broken."* The same is true here. As it stands the audio gate is the one that
appears broken in any environment that has not been set up by hand, which is how a
gate stops being run.

**Recommendation:** probe :3000 first and skip with a message, matching `qa:rls`.
No product behaviour is involved.

---

## Q2 · `engines` pins Node 24, the toolchain runs on 22

**Severity:** Informational
**File:** `package.json:5-7`

`"engines": { "node": "24.x" }`. Everything above was run on Node v22.22.2 with no
failure — typecheck, lint and all six runnable QA gates pass. Not a bug; noted only
because a strict-engines install would refuse, and because it makes the pin
unverified rather than enforced.

Two `MODULE_TYPELESS_PACKAGE_JSON` warnings also appear when the QA scripts import
the `supabase/functions/_shared/*.ts` modules. Cosmetic. Adding `"type": "module"`
would silence them, but the `_shared` files are deliberately importable by both
Deno and the Next bundler and that constraint is documented at length in
`username.ts` — worth leaving alone unless someone confirms it is safe.

---

## What was examined and found sound

Recording this so a later pass does not re-derive it.

- **Injection.** No `dangerouslySetInnerHTML` / `innerHTML` / `eval` /
  `new Function` / `document.write` anywhere in `app`, `components`, `lib`, `src`,
  `hooks`. No hardcoded credentials; the only `service_role` reference is the Edge
  Function reading it from the environment.
- **The `verdict` content-injection fix.** Closed on both sides — the
  `results_verdict_known` CHECK at the database and `safeVerdict` at every render
  boundary, including the raw-REST OG route that bypasses the row mapper.
- **`NaN` / `Infinity` in `score`.** Fenced at four independent layers: the
  `results_score_sane` CHECK, `rankable()`, the bounds inside `top_results`, and
  `finiteColumn` in the OG route. The reasoning about Postgres sorting `NaN` above
  every real number is correct.
- **Multiplayer wire format.** `lib/mp/protocol.ts` rebuilds every inbound field
  rather than passing references, bounds every number, and the `year < startYear`
  cross-check closes the forged-`yearIndex` cache-displacement bug. The peer
  authority model in `hooks/useMatch.tsx` (session-owner fencing on `status` and
  `snapshot`, roster membership, tick bounded by demonstrated peer years) is
  coherent and its residual trust assumptions are documented as out of scope by
  contract — which is the right call for a serverless P2P room.
- **CSP.** The absent `script-src` is a documented, defensible trade with its
  reopen conditions written down, and `connect-src` correctly falls back to
  `'self'` rather than vanishing when the env var is missing.
- **Auth.** `cloudMisconfigured` closes the fail-open dev sign-in on a
  keyless production build. Guest/cloud routing (`isGuestId`, `resolveProgressId`
  vs `resolvePlayerId`) is consistent across results, streaks, mastery and saves,
  and `qa:cloud` asserts the call sites.
- **Error handling on writes.** The house rule — supabase-js resolves rather than
  rejects, so a discarded `error` reads as success — is applied consistently in
  `saveRun`, `submitResult`, `bumpStreak` and `topResults`.
- **Resource lifecycle.** `AudioEngine.dispose()` cancels and drains
  `pendingDisposals`, the ambience crossfade is tracked rather than orphaned, and
  `transportOwner` correctly prevents a fading engine from stopping its
  replacement's Transport. `cachedFonts` memoises on success only.
- **React data fetching.** `Leaderboard` and `useShareUrl` both guard against
  stale responses and clear their timers on unmount.

No functional bug was found. `tsc`, `eslint` and all six runnable QA gates are
clean, and I would rather report that than manufacture a finding to fill the
bucket.

---

## Suggested order

1. **S1** — bound pending friend requests (trigger above). The only finding with a
   live abuse path.
2. **P1 + P2** — four indexes, no code change, 3.2× on the busiest query.
3. **S2** — rate-limit `profile_by_friend_code`; composes with S1.
4. **S4** — `npm audit fix`.
5. **Q1** — make the audio gate skip instead of crash.
6. **P3 / S3 / Q2** — checklist and housekeeping.
