# LifePatch — Codebase Security, Correctness & Performance Review

**Date:** 2026-09-05 · **Commit:** `claude/eager-cori-qg7u9j` (tree clean, in sync with `main`)
**Scope:** app/, components/, hooks/, lib/, src/, supabase/ (schema, migrations, Edge Functions), scripts/, dependencies, build & header configuration.

---

## Summary

This is an unusually well-hardened codebase. Every check the project ships passes on a clean
install: `tsc --noEmit` and `eslint .` are silent, `next build` succeeds, and the QA suites
(`qa:challenge`, `qa:cloud`, `qa:metrics`, `qa:rename`, `qa:rls`, `qa:username`, `qa:transport`,
`qa:engine`) pass 34/34, 19/19, 16/16, 16/16, 11/11, 10/10 and the RLS gate closes all 16 attack
probes. There are **no hardcoded secrets**, no `eval`/`new Function`/`dangerouslySetInnerHTML`,
no SQL or command injection surface, and no XSS vector I could reach.

**I found no critical vulnerability.** The findings below are ordered by real risk. The first one
is a genuine gap between a stated security property and what the database actually enforces;
the rest are moderate-to-minor.

| # | Bucket | Finding | Severity |
|---|--------|---------|----------|
| 1 | Security | `friends` insert policy lets any account send a friend request to any user id — "added by code, never by search" is not enforced server-side | **Medium** |
| 2 | Security | `friends` and `mastery` have no per-player row cap, unlike every other client-written table | **Medium** |
| 3 | Security | `profiles_public` is fully enumerable, which voids the rename limiter's stated purpose | **Low–Medium** |
| 4 | Security | Vulnerable transitive dependencies: `fflate@0.6.10` (prod), `qs@6.15.3` (dev) | **Low** |
| 5 | Security | `randomIndex` silently degrades to `Math.random()` when minting a capability token | **Low** |
| 6 | Bug | `cachedFonts` never checks `response.ok` — a bad response is memoised as font bytes and 500s the OG route for the isolate's life | **Medium** |
| 7 | Bug | `useAuth` dev path parses `lifepatch.devUser` with no shape guard | **Low** |
| 8 | Bug | `readChallenge` does not bound `history.length`, unlike every other series reader | **Low** |
| 9 | Bug | Two fire-and-forget timers call `setState` after possible unmount | **Trivial** |
| 10 | Perf | `/r/[id]` pulls the framer-motion runtime it documents itself as avoiding (~51 kB) | **Low–Medium** |
| 11 | Quality | `@tonejs/midi` is an unused production dependency; `@types/howler` is in `dependencies` | **Trivial** |
| 12 | Quality | Unbounded `.in()` lists on the friends leaderboard path | **Trivial** |

---

# Critical Security Vulnerabilities

None found. The items in this section are the highest-risk security findings, but none of them
gives an attacker code execution, data theft beyond pseudonymous public data, or account takeover.

---

## 1. `friends` insert policy does not enforce the friend-code capability — **Medium**

**Where:** `supabase/schema.sql:411-415` (policy `friends - write own side`); no `revoke insert`
on this table anywhere in `schema.sql` or `supabase/migrations/`.

**Risk.** `supabase/schema.sql:109` states the friends feature's whole security posture:
*"`friend_code` is the sole capability guarding addByCode"*, and migration 02's header calls the
property *"added by code, never by search"*. The `friends` table does not implement that. The
insert policy is:

```sql
create policy "friends - write own side" on public.friends
  for insert with check (
    auth.uid() = user_id
    and (status = 'pending' or public.has_incoming_request(friend_id))
  );
```

It constrains *whose side* you write and *what status* you write — the same two questions
migration 04 and the "MUTUAL BY CONSTRUCTION" note in `lib/cloud/friends.ts` were written to
answer — but it says nothing about **how you learned `friend_id`**. Any signed-in account can
`POST /rest/v1/friends` with `{user_id: me, friend_id: <any uuid>, status: "pending"}` and it is
accepted. `lib/cloud/friends.ts:addByCode` resolves a code to an id first, but that is the *UI*
path; PostgREST is directly reachable, which is the premise every other control in this schema is
built on.

The ids are not secret either. `profiles_public` publishes `id` for every player to `anon`
(finding #3), so the target list is one unauthenticated request away. The victim then sees each
edge in `listIncoming()` — the sheet's "N requests" badge — with no rate limit and no cap.

**Failure scenario.** An attacker signs up, fetches
`GET /rest/v1/profiles_public?select=id` with the publishable key, and inserts one pending edge
per id. Every player in the game opens the friends sheet to a request from a stranger they never
gave a code to. There is no per-player cap (finding #2), so the same account can repeat this after
each decline, and the rows persist.

**Recommendation.** Close it the same way `profiles` was closed in migration 04/05 — take the
write away and funnel it through a definer function that resolves the code server-side:

```sql
-- Requests must present the capability, not the id.
revoke insert on public.friends from authenticated, anon;

create or replace function public.request_friend(code text)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare target uuid;
begin
  select p.id into target
    from public.profiles p
   where p.friend_code = upper(trim(code))
   limit 1;
  if target is null or target = auth.uid() then return false; end if;
  insert into public.friends (user_id, friend_id, status)
  values (auth.uid(), target, 'pending')
  on conflict do nothing;
  return true;
end;
$$;

-- Accepting still needs the reciprocal edge, which the caller cannot forge.
create or replace function public.accept_friend(requester uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.has_incoming_request(requester) then return false; end if;
  insert into public.friends (user_id, friend_id, status)
  values (auth.uid(), requester, 'accepted')
  on conflict (user_id, friend_id) do update set status = 'accepted';
  return true;
end;
$$;

revoke all on function public.request_friend(text)  from public, anon;
revoke all on function public.accept_friend(uuid)   from public, anon;
grant execute on function public.request_friend(text) to authenticated;
grant execute on function public.accept_friend(uuid)  to authenticated;
```

`addByCode` and `accept` in `lib/cloud/friends.ts` then call `.rpc(...)` instead of `.insert(...)`
/ `.upsert(...)`. Keep the existing policies — they stay correct and become defence in depth.
Note this needs the same deploy-ordering note the other migrations carry: ship the client change
before revoking the grant.

---

## 2. `friends` and `mastery` have no per-player row ceiling — **Medium**

**Where:** `supabase/schema.sql:426-447` (`mastery`), `supabase/schema.sql:393-423` (`friends`).
Compare `results_cap_per_player()` at `supabase/schema.sql:284-320`.

**Risk.** The schema is explicit that an unbounded client-written table is a problem: the
`results` cap trigger's header says *"`results` is bounded per row (8 KiB) and not at all per
player: one account can insert indefinitely and nothing prunes"*, and `saves` is bounded by
`unique (user_id, mode)` plus `saves_state_small`. Two tables did not get the same treatment:

- **`mastery`** — `insert own` policy, primary key `(user_id, concept_id)`, `concept_id` is any
  text up to 64 chars. One account can insert an unbounded number of rows with distinct synthetic
  concept ids. The `level` CHECK bounds the *value*, not the *count*.
- **`friends`** — primary key `(user_id, friend_id)`, so the ceiling is the size of `auth.users`,
  which finding #1 makes reachable in one pass and which grows over time.

Neither table has a size CHECK, a cap trigger, or a rate limit. This is storage abuse against the
project's own free-tier quota rather than a data-integrity problem, but it is exactly the class of
issue the `results` trigger exists for.

**Recommendation.** Mirror the existing trigger. For `mastery`, a hard cap is simpler than a prune
because the honest row count is fixed by `lib/concepts.ts`:

```sql
create or replace function public.mastery_cap_per_player()
returns trigger language plpgsql security definer set search_path = public as $$
declare cap constant int := 200;  -- far above CONCEPTS.length; adjust with lib/concepts.ts
begin
  if (select count(*) from public.mastery m where m.user_id = new.user_id) >= cap then
    raise exception 'mastery row cap reached';
  end if;
  return new;
end;
$$;
create trigger mastery_cap_per_player before insert on public.mastery
  for each row execute function public.mastery_cap_per_player();
```

For `friends`, cap outgoing *pending* edges (the abusable half) rather than accepted ones, so a
popular player is never refused a real friendship:

```sql
-- e.g. 100 unanswered outgoing requests is far past any real player.
create or replace function public.friends_pending_cap()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending'
     and (select count(*) from public.friends f
           where f.user_id = new.user_id and f.status = 'pending') >= 100 then
    raise exception 'too many outstanding friend requests';
  end if;
  return new;
end;
$$;
```

Also worth doing on `friends` what `results` and `profiles` already do — narrow the grant so
`created_at` cannot be named by the client:

```sql
revoke insert, update on public.friends from authenticated, anon;
grant insert (user_id, friend_id, status) on public.friends to authenticated;
grant update (status) on public.friends to authenticated;
```

(Skip this if you adopt the RPC in finding #1, which removes the grant entirely.)

---

## 3. `profiles_public` is fully enumerable — the rename limiter's rationale does not hold — **Low–Medium**

**Where:** `supabase/schema.sql:149-162` (view + grant),
`supabase/functions/_shared/renameLimit.ts:1-30`, `supabase/functions/profile/index.ts:216-250`.

**Risk.** The rename limiter is documented as an *enumeration* control:

> `rename` answers 409 for "that name is taken" and 400 for "the filter refuses that name". Two
> distinguishable answers plus unlimited attempts is an oracle: one account can walk the username
> space a request at a time and learn who exists.

But `profiles_public` runs with `security_invoker = off` (bypassing RLS) and is granted `select`
to `anon`. So the entire username list — plus every player's `id` and `created_at` — is one
unauthenticated, unpaginated request away:

```
GET /rest/v1/profiles_public?select=id,username,created_at   →  every player
```

The oracle the limiter bounds to 120 guesses/day is a strictly worse version of a query that is
already free and complete. The limiter still earns its place as abuse control on the *write* path,
but its stated threat model is not the one it addresses, and the `id` column it publishes is what
makes finding #1 practical at scale.

**Recommendation.** Two options, in order of preference:

1. **Stop publishing the roster.** The leaderboard only ever asks about ids it already has
   (`getProfiles(userIds)` at `lib/cloud/profiles.ts:266`), so the view can be replaced with a
   set-returning definer function that answers a bounded id list and nothing else:

   ```sql
   revoke select on public.profiles_public from anon, authenticated;

   create or replace function public.profiles_for(ids uuid[])
   returns table (id uuid, username text, avatar_seed text, created_at timestamptz)
   language sql security definer stable set search_path = public as $$
     select p.id, p.username, p.avatar_seed, p.created_at
     from public.profiles p
     where p.id = any(ids[1:100]);   -- bounded: one leaderboard page
   $$;
   revoke all on function public.profiles_for(uuid[]) from public, anon;
   grant execute on function public.profiles_for(uuid[]) to authenticated;
   ```

   This is the same shape as `profile_by_friend_code` and closes the walk, not just the oracle.

2. **If the open roster is a deliberate product choice** (a public directory), say so in the
   schema comment and correct `renameLimit.ts`'s header, so the next reader does not believe a
   control is buying something it is not. Also set PostgREST's `db-max-rows` so a single request
   cannot page the whole table.

---

## 4. Vulnerable transitive dependencies — **Low**

**Where:** `package-lock.json`. `npm audit` reports 2 moderate advisories.

| Package | Version | Path | Advisory |
|---|---|---|---|
| `fflate` | 0.6.10 | `@react-three/rapier@2.2.0 → three-stdlib@2.36.1` (**production**) | [GHSA-px8p-9vwx-vf98](https://github.com/advisories/GHSA-px8p-9vwx-vf98) — infinite loop on malformed ZIP64 |
| `qs` | 6.15.3 | `shadcn@4.12.0 → @modelcontextprotocol/sdk → express@5.2.1` (**dev only**) | [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) |

**Practical risk is low.** `fflate` is only reached through `three-stdlib`'s archive loaders
(FBX/3MF), and nothing in this repo imports `three-stdlib` — `@react-three/rapier` is used solely
for the dice physics in `components/cashflow/board/DiceRollOverlay.tsx`, so the vulnerable code
should tree-shake out. `qs` is behind `shadcn`, a devDependency that never ships.

**Recommendation.** `npm audit fix` resolves both without a major bump. If it doesn't, pin the
transitive versions — the repo already has an `overrides` block for `postcss`:

```json
"overrides": {
  "postcss": "$postcss",
  "fflate": "^0.8.2",
  "qs": "^6.14.0"
}
```

Then re-run `npm audit` and `npm run qa:engine` to confirm nothing moved.

---

## 5. `randomIndex` silently falls back to `Math.random()` — **Low**

**Where:** `supabase/functions/_shared/generate.ts:39-52`.

**Risk.** The file's own header explains why this must be a CSPRNG:

> `Math.random()` is V8's xorshift128+, whose internal state is recoverable from a handful of
> consecutive outputs, and two of those outputs (username, avatar seed) are published for every
> player on the leaderboard — while this one guarded a throwaway lobby.

The function then does exactly that when `crypto.getRandomValues` is absent:

```ts
return Math.floor(Math.random() * bound);
```

Since `generateFriendCode` draws the username, the code and the avatar seed from one consecutive
run of this generator, and two of the three are public, a fallback build makes the friend code —
the whole capability in finding #1 — recoverable. Impact today is nil: Deno and every supported
browser have `crypto.getRandomValues`, so the branch is unreachable in practice.

**Recommendation.** Fail loudly rather than degrade a capability token. The room-code caller can
keep a fallback; the mint cannot:

```ts
export function randomIndex(bound: number): number {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (!c?.getRandomValues) {
    // A capability token minted from a recoverable stream is not a capability.
    throw new Error("randomIndex: no CSPRNG available");
  }
  // ... existing rejection-sampling loop
}
```

`ensure` in `supabase/functions/profile/index.ts` already answers a mint failure with a 503, so
the throw lands in a handled path.

---

# Functional Bugs

## 6. `cachedFonts` never checks `response.ok` — a bad read is memoised as font data — **Medium**

**Where:** `app/api/og/_fonts/cache.ts:17-27`; consumed at `app/api/og/[id]/route.tsx:31-34,139-153`
and `app/opengraph-image.tsx`.

```ts
pending = Promise.all(urls.map((u) => fetch(u).then((r) => r.arrayBuffer()))).catch((e) => {
  pending = null;
  throw e;
});
```

**Risk.** `arrayBuffer()` resolves happily on a 404 or 500 — it just hands back the error body's
bytes. So a non-OK response is a *success* here, and the memo caches it for the life of the
isolate. The route's guard cannot see it:

```ts
const [anton, plex] = ttf ?? [null, null];
if (!anton || !plex) { /* redirect to the static card */ }
```

A non-empty error-body `ArrayBuffer` is truthy, so this passes, and `new ImageResponse(..., { fonts })`
throws inside Satori on bytes that are not a TTF. That throw is **not** caught — `fetchRow` has its
own try/catch, the font read has `.catch(() => null)`, but the render does not — so the route 500s.
And because the memo only clears on rejection, it 500s for *every subsequent request to that
isolate*. This is precisely the outcome the file's own header is written to prevent
(*"the /api/og/[id] route's fallback branch exists precisely because that read can fail, and it is
written to survive a hiccup, not to inherit one"*), and the route's header repeats it
(*"an unfurl that errors shows a broken card in every chat client that renders it"*).

A zero-length `ArrayBuffer` has the same problem: truthy, passes the guard, throws in Satori.

**Failure scenario.** A deploy where the bundler emits the `.ttf` under a path the edge fetch
resolves to a 404 (or an asset CDN blip serving an error page). The first unfurl caches the error
body; every unfurl after it returns 500 instead of the wordmark card, until the isolate is
recycled.

**Recommendation.** Validate the response, and treat an empty buffer as a failure:

```ts
export function cachedFonts(urls: URL[]): () => Promise<ArrayBuffer[]> {
  let pending: Promise<ArrayBuffer[]> | null = null;
  return () => {
    if (!pending) {
      pending = Promise.all(
        urls.map(async (u) => {
          const res = await fetch(u);
          // A non-OK response still yields bytes from `arrayBuffer()`, and those
          // bytes would be memoised as a typeface. Reject so the slot clears.
          if (!res.ok) throw new Error(`font fetch ${res.status}: ${u}`);
          const buf = await res.arrayBuffer();
          if (buf.byteLength === 0) throw new Error(`empty font: ${u}`);
          return buf;
        }),
      ).catch((e) => {
        pending = null;
        throw e;
      });
    }
    return pending;
  };
}
```

Belt and braces: wrap the `new ImageResponse(...)` return in `app/api/og/[id]/route.tsx` in a
try/catch that falls back to the same `302 → /opengraph-image` the missing-font branch uses, so
*no* render fault can 500 the unfurl.

---

## 7. `useAuth` parses the dev user with no shape guard — **Low**

**Where:** `hooks/useAuth.tsx:106-110`.

```ts
const raw = localStorage.getItem(DEV_KEY);
if (raw) setUser(JSON.parse(raw));
```

**Risk.** Every other localStorage reader in this codebase shape-guards, and each one has a comment
saying why — `lib/challenge.ts:217` (*"Shape-guard rather than a cast: this is player-writable
storage"*), `lib/mp/matchStore.ts:99` (*"Run it through the same parsers the wire uses"*),
`lib/cloud/profiles.ts:249` (*"a stale/corrupted key must not yield a phantom Profile"*). This one
does not. A corrupt or hand-edited `lifepatch.devUser` sets `user` to any JSON value; `user.id`
then flows into `localKey(userId, mode)` in `lib/saves.ts:28`, producing keys like
`lifepatch.save.undefined.story`, and into `isGuestId` / `resolveProgressId`.

It is confined to the no-cloud dev branch (`isCloud` false), so it is not reachable on a configured
production deploy. It is still the one reader that trusts its own storage.

**Recommendation.**

```ts
const raw = localStorage.getItem(DEV_KEY);
const parsed: unknown = raw ? JSON.parse(raw) : null;
const ok =
  typeof parsed === "object" && parsed !== null &&
  typeof (parsed as AuthUser).id === "string" && (parsed as AuthUser).id !== "" &&
  typeof (parsed as AuthUser).email === "string";
setUser(ok ? (parsed as AuthUser) : storedGuest());
```

---

## 8. `readChallenge` does not bound `history.length` — **Low**

**Where:** `lib/challenge.ts:233-234`.

```ts
!Array.isArray(c.history) ||
!c.history.every(finiteNumber) ||
```

**Risk.** Every element is validated; the array's *length* is not. `lib/metrics.ts:28-39` spells
out why that matters — `MAX_SERIES = 200`, because *"a chart with 100,000 points is a hung tab, and
a challenge carrying one overflows the 5MB localStorage budget on `writeChallenge`"* — and both
the statement page and the report route their series through `wholeSeries`. The challenge record
is the one series that reaches `AnnotatedLifeChart` without passing that cap, and it comes from
player-writable storage, which the same file treats as untrusted everywhere else. The chart's
label solver (`components/share/AnnotatedLifeChart.tsx:249-382`) is O(n) per placement pass over
the points.

`writeChallenge` only ever writes capped histories, so this is only reachable by editing
localStorage — self-inflicted, but the codebase's own standard is that self-inflicted is still
worth refusing rather than hanging on.

**Recommendation.** Reuse the shared reader instead of hand-rolling the check:

```ts
import { finiteNumber, wholeSeries } from "./metrics";
// ...
const history = wholeSeries(c.history);
if (history === null) return null;
return { ...(c as Challenge), history };
```

`wholeSeries` already refuses a non-array, a bad element, and a series it had to cut — the same
three answers, from the one module that owns them.

---

## 9. Two fire-and-forget timers `setState` after possible unmount — **Trivial**

**Where:** `components/social/FriendsSheet.tsx:228`, `components/cinematic/landing/FooterColophon.tsx:37`.

```ts
window.setTimeout(() => setCopied(false), 2000);   // FriendsSheet
window.setTimeout(() => setFlash(false), 180);     // FooterColophon
```

Neither handle is stored or cleared. React 18 no longer warns on this, so it is harmless today —
but the sheet is a dialog that is routinely closed inside two seconds, and every comparable timer
in the codebase (`useArmedAction`, `HudRail`, `StreakChip`, `YearTimer`, `useConsequenceLadder`)
is cleaned up.

`components/share/ShareCard.tsx:73`'s `revokeObjectURL` timer is deliberately *not* in this list —
it must survive unmount to free the blob.

**Recommendation.** Park the handle in a ref and clear it on unmount, or use the existing
`useArmedAction` pattern.

---

# Code Quality / Performance

## 10. `/r/[id]` ships the framer-motion runtime it documents itself as avoiding — **Low–Medium**

**Where:** `app/r/[id]/page.tsx:129-140` and `:271`; `components/share/AnnotatedLifeChart.tsx:1-3`.

The page carries this reasoning for hand-rolling its CTA:

> This is a server component, so it cannot use `LedgerButton` (a client component carrying
> framer-motion) without pulling the whole motion runtime onto an otherwise static, cacheable page.

Then, forty lines further down, it renders `<AnnotatedLifeChart>` — which is `"use client"` and
whose first import is `import { motion } from "framer-motion"`. The motion runtime is on the page
regardless; the hand-rolled CTA buys nothing.

Measured from `next build`:

```
├ ○ /_not-found      135 B   103 kB   ← shared baseline
└ ● /r/[id]         3.84 kB  154 kB   ← ~51 kB above baseline
```

This is the app's highest-fanout public surface — the share card that every chat client unfurls
and every stranger lands on — and it is the one page where First Load JS is most worth defending.

**Recommendation.** Either

1. **Drop motion from the chart.** The chart's animation is a draw-on reveal; a CSS
   `stroke-dashoffset` transition guarded by `prefers-reduced-motion` covers it without the
   runtime, and `useMotionCtx` can stay for the reduced-motion read. This helps
   `LifeReport` too, which mounts the same component.
2. **Or split the chart** into a motion-free static variant for `/r/[id]` and keep the animated
   one in-app, and correct the comment at `app/r/[id]/page.tsx:129-140` either way — right now it
   claims a property the page does not have.

Re-measure with `next build` afterwards; the target is `/r/[id]` back near the 103 kB baseline.

---

## 11. Unused / misplaced production dependencies — **Trivial**

**Where:** `package.json:26,20`.

- **`@tonejs/midi@^2.0.28`** is declared in `dependencies` and imported **nowhere** — zero matches
  across `app/`, `components/`, `hooks/`, `lib/`, `src/`, `scripts/`. `CLAUDE.md` names it as part
  of the intended MIDI workflow, so it may be reserved deliberately; if so it belongs in
  `devDependencies` with a comment, since nothing in the shipped bundle uses it.
- **`@types/howler@^2.2.13`** is in `dependencies`. Types are build-time only and belong in
  `devDependencies` (its sibling `@types/qrcode` is correctly placed there).

Neither reaches the client bundle — Next only bundles what is imported — so this is hygiene, not
weight. It does affect `npm audit --omit=dev` accuracy and install time on the deploy target.

**Recommendation.**

```bash
npm pkg delete dependencies.@tonejs/midi        # or: move to devDependencies
npm pkg set devDependencies.@types/howler="^2.2.13"
npm pkg delete dependencies.@types/howler
npm install
```

---

## 12. Unbounded `.in()` lists on the friends path — **Trivial**

**Where:** `lib/cloud/results.ts:304`, `lib/cloud/profiles.ts:274,301`.

```ts
if (scope === "friends") q = q.in("user_id", friendIds);
```

`friendIds` comes from `listFriendIds()` with no cap, and PostgREST encodes `.in()` into the query
string. A player with a few hundred accepted friends produces a URL past the gateway's header
limit and gets a 414 — which surfaces as `Could not reach the leaderboard.` with no way for the
player to act on it. Related to finding #2: without a cap on `friends`, the list has no natural
ceiling.

**Recommendation.** Cap the list at the query boundary and say so, or switch the friends board to
the `top_results` RPC path (migration 10 already accepts `p_users`), which sends the array in the
body:

```ts
// A board shows `limit` rows; asking about more friends than that cannot change it.
const ids = friendIds.slice(0, 200);
if (scope === "friends") q = q.in("user_id", ids);
```

---

# What was checked and found clean

Recorded so the next reviewer does not re-derive it:

- **Secrets** — no hardcoded keys, tokens or service-role credentials anywhere in tracked files.
  `.gitignore` covers `.env*.local`. `.env.local.example` carries only variable names and an
  explicit warning against pasting `sb_secret_*`.
- **Injection** — no `eval`, `new Function`, `document.write`, `innerHTML` or
  `dangerouslySetInnerHTML` in the tree. The one place a query grammar is built by concatenation
  (`lib/cloud/friends.ts:listEdges`) guards with a UUID regex first and says why. The OG route's
  `id=eq.${id}` is gated by `UUID_RE` at `app/api/og/[id]/route.tsx:47`.
- **XSS** — no user-supplied HTML is rendered. Usernames are charset-locked in three places at
  once (`USERNAME_RE`, the `profiles_username_charset` CHECK, and the `profile` Edge Function).
  Verdicts are constrained by `results_verdict_known` *and* re-guarded by `safeVerdict` at every
  read boundary.
- **RLS** — `npm run qa:rls` closes all 16 attack probes against both a migrated database and a
  fresh `schema.sql`, with 24 behaviours intact.
- **Untrusted input parsing** — `lib/mp/protocol.ts` rebuilds every wire message field by field
  with explicit clamps; `lib/metrics.ts` is the single owner of `metrics` jsonb coercion and
  refuses rather than compacts a bad series. Prototype pollution is not reachable through the
  `flags` / `yearChoices` loops (values are numbers and strings, and `obj["__proto__"] = <primitive>`
  is a no-op).
- **Headers** — `next.config.ts` sets `X-Frame-Options`, `nosniff`, HSTS (2y, `includeSubDomains`,
  no `preload` — deliberately), `Referrer-Policy`, `Permissions-Policy`, and a CSP with
  `frame-ancestors`/`frame-src`/`form-action`/`object-src`/`base-uri` plus a `connect-src` derived
  from the Supabase URL with `'self'` as an honest floor. The absent `script-src` is a documented,
  costed decision with explicit reopen conditions; I agree with the reasoning as it stands and
  would revisit it the day any third-party script joins the document.
- **Resource cleanup** — `src/audio/AudioEngine.ts` and `src/audio/sfxBank.ts` track pending
  disposal timers explicitly; `lib/mp/transport.ts` gates every callback on a generation counter;
  event listeners balance everywhere except the two timers in finding #9.
- **Toolchain** — `tsc --noEmit` clean, `eslint .` clean, `next build` succeeds, all runnable QA
  suites pass. (`qa:audio` and `qa:mp` need a running dev server and were not exercised.)
