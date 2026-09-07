# LifePatch — Codebase Review, 2026-09-07

Scope: `app/`, `lib/`, `src/`, `hooks/`, `components/`, `supabase/` (schema, migrations,
Edge Functions), `next.config.ts`, dependency tree via `package-lock.json`.

**Context first, because it changes how this report should be read.** This codebase has
already been through several security passes and they were good ones. Client-only username
screening, the unconstrained `accepted` friend status, the `using (true)` policy that leaked
every `friend_code`, NaN scores taking permanent first place, unbounded `saves.state`,
verdict content-injection on `/r/{id}` — all found, all fixed, all documented in place. Most
of the obvious classes are closed. Everything below is what survived that, and the two
leading items are consequences of decisions the repo already wrote down as open.

Nothing here is a remote-code-execution or data-exfiltration hole. There are no hardcoded
secrets, no injection sinks (`dangerouslySetInnerHTML`, `eval`, `new Function`, `innerHTML`
appear nowhere outside a comment), no unparameterised SQL, and every `addEventListener` in
the tree has a matching removal in its cleanup.

> Note: `npm run typecheck` currently reports ~20 errors, all of the form
> `Cannot find module 'react'`. `node_modules` is not installed in this environment; these
> are environmental, not defects. The audit below is from source and the lockfile.

---

## 1. Critical / High — Security

### 1.1 Friend requests bypass the friend-code capability entirely

**Files:** `supabase/schema.sql` (~L154–160 `profiles_public`, ~L395–404 `friends` policies),
`lib/cloud/friends.ts:90` (`addByCode`)

Two facts combine into a bypass:

```sql
-- schema.sql ~L154: every row, every caller, no filter
create or replace view public.profiles_public
  with (security_invoker = off) as
  select id, username, avatar_seed, created_at from public.profiles;
grant select on public.profiles_public to anon, authenticated;

-- schema.sql ~L397: knowledge of a friend code is never asserted
create policy "friends - write own side" on public.friends
  for insert with check (
    auth.uid() = user_id
    and (status = 'pending' or public.has_incoming_request(friend_id))
  );
```

`profiles_public` is ungated, so `GET /rest/v1/profiles_public?select=*` with the publishable
key returns the entire player roster — every `id` and `username`. The insert policy then
constrains *whose side* of the edge you write and *what status*, but never that you knew the
target's code. So an authenticated caller can harvest uuids from the view and POST
`{user_id: me, friend_id: <any harvested uuid>, status: 'pending'}` straight at PostgREST,
never touching `profile_by_friend_code`.

The stated posture — "added by code, never by search", named in `schema.sql`, in migration 02
and in `lib/cloud/friends.ts`'s own header — is at this point enforced only by
`addByCode()` in the browser choosing to call `getByFriendCode` first. That is precisely the
shape of the two bugs this repo already fixed: username screening that "ran in the browser and
nowhere else", and the `accepted` status that "constrained WHOSE SIDE of an edge you wrote and
never the STATUS".

**Impact.** Bounded but real: unsolicited friend-request spam addressed at any player by uuid,
and the privacy model the feature rests on is not actually enforced. It does *not* yield an
`accepted` edge — `has_incoming_request` is not forgeable — and it leaks nothing beyond what
`profiles_public` already hands out. Rate this High, not Critical.

**Fix.** Move the insert behind a definer function that resolves the code itself, so the
capability is proven server-side:

```sql
create or replace function public.request_friend(code text)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare target uuid;
begin
  select p.id into target from public.profiles p
   where p.friend_code = upper(trim(code)) limit 1;
  if target is null or target = auth.uid() then return false; end if;
  insert into public.friends (user_id, friend_id, status)
  values (auth.uid(), target, 'pending')
  on conflict do nothing;
  return true;
end; $$;

revoke all on function public.request_friend(text) from public, anon;
grant execute on function public.request_friend(text) to authenticated;

-- and take the direct write away, the same move migration 05 made for `profiles`
revoke insert on public.friends from authenticated, anon;
grant insert (user_id, friend_id, status) on public.friends to authenticated; -- accept path only
```

Note the accept path still needs a direct insert (accepting writes the reciprocal edge), so
either keep a narrowed grant guarded by `has_incoming_request`, or route accept through its own
RPC too. Ship the RPC before revoking, as migration 05's header does for the `profile` function.

**Secondary, same area:** `getProfiles` only ever calls `.in("id", unique)` — the app never
needs a full roster read. Narrowing `profiles_public` (a definer function taking an id array,
or an RLS-scoped view) would remove the harvesting step even if the insert stays as-is.

---

### 1.2 `profile_by_friend_code` has no rate limit — the repo's own TODO, now due

**Files:** `supabase/schema.sql:167-182`, `supabase/migrations/2026-08-27_01_security_additive.sql:69`

The migration that created this function says it outright:

> `Codes are 6 chars over a 31-glyph alphabet (~887M); consider a Supabase rate limit if the friends UI ever ships.`

The friends UI has shipped — `components/social/FriendsSheet.tsx`, `lib/cloud/friends.ts`,
`?friend=` deep links in `lib/deepLink.ts`. The rate limit did not.

The keyspace argument is weaker than the 887M figure suggests, because an attacker is not
guessing *one* player's code. With N players enrolled, a random guess hits *someone* with
probability N/887,503,681 — at 100k players that is roughly one hit per 8,900 requests, which
is minutes of unthrottled PostgREST traffic. Each hit returns `id, username, avatar_seed` and
enables a friend request.

The uncomfortable part is that the project already built exactly the right control for a
*strictly weaker* oracle. `spend_rename_attempt` (migration 09) bounds rename attempts at five
an hour, in the database, atomically, because — per the `profile` function's own header — "two
distinguishable answers plus unlimited attempts is an oracle: one account can walk the username
space a request at a time and learn who exists." Friend-code lookup is the same oracle over a
more sensitive token, with no counter at all.

**Fix.** Mirror the mechanism that already exists. Either add a per-caller counter inside the
function (columns alongside `rename_window_start` / `rename_attempts`), or move the lookup into
the `profile` Edge Function where `spendRenameAttempt`'s pattern can be reused directly:

```sql
create or replace function public.profile_by_friend_code(code text)
returns table (id uuid, username text, avatar_seed text)
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.spend_lookup_attempt(auth.uid()) then
    raise exception 'rate limited' using errcode = '53400';
  end if;
  return query
    select p.id, p.username, p.avatar_seed
      from public.profiles p
     where p.friend_code = upper(trim(code))
     limit 1;
end; $$;
```

Also worth doing at the same time: `supabase/migrations/2026-08-27_03_rotate_friend_codes.sql`
is opt-in and its header warns it "gets more expensive" once the friends UI ships. It has.
If it has not been applied to the live project, apply it while the limiter lands.

---

### 1.3 `fflate@0.6.10` — moderate advisory in a production dependency

**File:** `package-lock.json` (`node_modules/fflate`, prod, via `three-stdlib@2.36.1`)

`npm audit --omit=dev` reports one issue: GHSA-px8p-9vwx-vf98 — `unzipSync` can enter an
infinite loop on a malformed ZIP64 archive (CVSS 7.5, availability). Fixed in `>=0.6.11`.

**Practically unreachable here.** `three-stdlib` pulls it for loaders the app does not use;
LifePatch unzips nothing, and the only `three` consumers are `DiceRollOverlay.tsx` and
`BillVortex.tsx`, both `next/dynamic`-split. Reported because it is a prod dep with a fix
available, not because it is exploitable in this app.

**Fix.** `npm audit fix`, or pin an override:

```json
"overrides": { "postcss": "$postcss", "fflate": "^0.8.2" }
```

(`qs` also appears at moderate, but it is dev-only via `express`/`body-parser` and does not
ship.)

---

## 2. Functional Bugs

### 2.1 CSP blocks Realtime websockets against a non-HTTPS Supabase URL

**File:** `next.config.ts:64` (`connectSrc`)

```ts
return `${SELF} ${origin} ${origin.replace(/^https:/, "wss:")}`;
```

The scheme swap is anchored to `^https:`. Against a local or self-hosted project —
`NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321`, which is what `supabase start` gives you —
the regex does not match, so the directive becomes:

```
connect-src 'self' http://localhost:54321 http://localhost:54321
```

No `ws:` entry at all. The REST calls work, so the app looks configured; the Realtime socket
is refused by CSP, and multiplayer rooms fail with a browser console violation rather than
anything the transport's own `onConnection`/offline path can diagnose. The failure mode is
"joining a room silently never connects", which is expensive to trace back to a header.

**Fix.** Derive the socket scheme from the origin's own:

```ts
const u = new URL(url);
const socket = `${u.protocol === "http:" ? "ws:" : "wss:"}//${u.host}`;
return `${SELF} ${u.origin} ${socket}`;
```

### 2.2 Dev-fallback auth trusts unvalidated localStorage as the user object

**File:** `hooks/useAuth.tsx:103-104`

```ts
const raw = localStorage.getItem(DEV_KEY);
if (raw) setUser(JSON.parse(raw));
```

Every other reader of player-writable storage in this codebase shape-guards —
`readChallenge` in `lib/challenge.ts` checks eleven fields and says why, `loadMatch` runs the
record back through `parseMatchConfig`/`parseRunState`, `getByFriendCode`'s local branch guards
against "a phantom Profile whose fields are undefined". This one casts.

A corrupted or hand-edited `lifepatch.devUser` yields `user.id === undefined`, which flows into
`localKey(userId, mode)` → save key `lifepatch.save.undefined.story`, and into
`isGuestId(undefined)` → `false`, so the run is treated as a real account.

Low severity — this branch only runs when `!isCloud`, i.e. dev builds, and the attacker is the
device owner. But it is one line to bring in line with the rest of the file:

```ts
const parsed: unknown = raw ? JSON.parse(raw) : null;
const ok = typeof parsed === "object" && parsed !== null
  && typeof (parsed as AuthUser).id === "string" && (parsed as AuthUser).id !== ""
  && typeof (parsed as AuthUser).email === "string";
setUser(ok ? (parsed as AuthUser) : storedGuest());
```

---

## 3. Code Quality / Performance

### 3.1 `/r/[id]` never got the abuse fix its OG partner did

**File:** `app/r/[id]/page.tsx:186,199` — `generateMetadata` and the page both call `getResult(id)`

`app/api/og/[id]/route.tsx` documents this problem at length and fixes it two ways: a
`UUID_RE.test(id)` gate before the fetch, and a 302 to `/opengraph-image` for unknown ids so
"the render happens once at the edge rather than once per id". The page it partners with has
neither. With `revalidate = 3600` and `generateStaticParams` returning `[]`, every distinct id
in a stream of random UUIDs is a fresh ISR render plus one (in fact two — metadata and body)
Supabase round trip.

Cheaper than the OG render it already fixed, but the same shape, and the same fix applies:

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_RE = /^local-[0-9a-z]+-[0-9a-z]+$/;
// in both entry points, before touching the network:
if (!UUID_RE.test(id) && !LOCAL_RE.test(id)) notFound();
```

### 3.2 `drawEvents` rebuilds the whole weighted deck on every draw

**File:** `lib/runEngine.ts:391`

```ts
const weighted = LIFE_EVENTS.flatMap((e) => Array(e.weight ?? 1).fill(e.id));
```

In the `sharedEvents` branch this expression depends on nothing but the module-level
`LIFE_EVENTS` constant, yet it is rebuilt per year, per player. It matters most exactly where
the engine runs hottest: ghost fast-forward and rejoin catch-up replay many years for several
peers in one pass (`hooks/useMatch.tsx`, `lib/mp/autoResolve.ts`).

Hoist it — the result is a constant:

```ts
const SHARED_DECK: string[] = LIFE_EVENTS.flatMap((e) => Array(e.weight ?? 1).fill(e.id));
```

The solo branch genuinely cannot be hoisted (`weightFor` reads `s.weakSpots`), and must not be
— `scripts/qa/golden-draws.json` pins that draw order. This change touches neither the stream
nor the order, so recorded runs stay valid.

### 3.3 Three dependency-hygiene items

**File:** `package.json`

1. **`@tonejs/midi` is imported nowhere.** No `from "@tonejs/midi"` exists in the tree. It is
   listed in `dependencies`. Remove it, or note in `CLAUDE.md` that it is reserved for the
   MIDI-first workflow the project instructions describe.
2. **`@types/howler` is in `dependencies`, not `devDependencies`.** Types-only package; it
   should not be a runtime dep.
3. **`howler` is a live value-import in a module nothing value-imports.**
   `src/audio/sfxBank.ts:3` is `import { Howl, Howler } from "howler"` at module scope, while
   `AudioEngine.ts`, `useAudio.tsx` and `lib/audioMap.ts` all take it as `import type`. So
   howler ships in no bundle *today* — but that holds only for as long as nobody value-imports
   the file, and the file's own header advertises it as the drop-in for recorded foley. The
   header is clear that this is deliberate; the import placement is what makes it fragile.
   Moving the import inside `SfxBank` (`const { Howl } = await import("howler")`) makes the
   property structural rather than incidental.

---

## What I checked and found clean

Worth recording, so the next pass does not re-tread it:

- **Injection / XSS.** No `dangerouslySetInnerHTML`, `eval`, `new Function`, `innerHTML`, or
  `document.write` anywhere in the tree. `safeVerdict` guards the one client-written string
  that reaches a public surface, at both readers (`lib/cloud/results.ts:fromRow` and the OG
  route's own copy).
- **Secrets.** No hardcoded keys. `.env*.local` is gitignored. `.env.local.example` explicitly
  warns against pasting a `sb_secret_` key into a `NEXT_PUBLIC_*` var. The `profile` function
  reads the service role key from the environment under both of Supabase's key regimes.
- **RLS.** Every table has RLS enabled with per-operation policies. The column-vs-row
  distinction is handled correctly, including the ordering trap (a table-level grant must be
  revoked before a column grant can narrow it) — called out in three separate places.
- **Untrusted input parsing.** `lib/mp/protocol.ts` rebuilds every wire value field by field
  and never passes anything through by reference; `parseRunState` cross-validates
  `year >= startYear`; `parsePresence` refuses a status claiming another player's id;
  `handleMessage` fences status and snapshot messages on the seated session id.
- **Listener and timer hygiene.** All 17 `addEventListener` sites have matching removals.
- **Storage failure paths.** Quota and private-mode failures are handled (not swallowed) in
  `saves.ts`, `results.ts`, `challenge.ts`, `matchStore.ts`.
- **PRNG.** Friend codes, room codes, usernames and avatar seeds all draw from
  `randomIndex`, which uses `crypto.getRandomValues` with correct modulo-bias rejection.

---

## Suggested order

| # | Item | Bucket | Effort |
|---|------|--------|--------|
| 1.2 | Rate-limit `profile_by_friend_code` | Security | Low — mirror `spend_rename_attempt` |
| 1.1 | Gate friend-request insert on the code | Security | Medium — one RPC + a grant change |
| 2.1 | CSP `ws:` scheme derivation | Bug | Trivial |
| 1.3 | `fflate` override | Security | Trivial |
| 3.1 | Id gate on `/r/[id]` | Perf | Trivial |
| 3.2 | Hoist the shared deck | Perf | Trivial |
| 2.2 | Shape-guard dev auth | Bug | Trivial |
| 3.3 | Dependency hygiene | Quality | Trivial |
