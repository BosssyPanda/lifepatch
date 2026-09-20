# Codebase review — 2026-09-20

Full-repository pass for security vulnerabilities, functional bugs, and code
quality / performance problems. Findings are ordered by severity, most serious
first.

## Scope and method

- Read every file under `app/`, `lib/`, `hooks/`, `src/`, `supabase/` and the
  configuration at the repository root; skimmed `components/` and `scripts/`.
- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm audit` — 2 moderate transitive advisories (finding S4).
- `qa:engine` (34/34), `qa:challenge` (10/10), `qa:metrics` (19/19),
  `qa:rename` (16/16), `qa:rls` (16 probes closed, 24 behaviours intact),
  `qa:username`, `qa:transport` (11/11), `qa:cloud` (16/16) — all pass.
  `qa:mp` and `qa:audio` drive a browser against `http://localhost:3000` and
  were not run (no dev server in this environment); their failures here are
  environmental, not defects.
- Secret scan across the working tree and tracked files — nothing hardcoded;
  `.env*.local` is correctly ignored and only `.env.local.example` is tracked.

**There are no Critical findings.** The security posture of this codebase is
unusually strong: RLS is column-grant-aware, the public projection is a
read-only view, the username filter has one implementation shared by client and
Edge Function, the wire protocol rebuilds every inbound field rather than
spreading it, and `results` is constrained on score, verdict and payload size.
The report says so rather than inflating what is actually there. The items
below are genuine, but the top one is High and the rest are Medium and lower.

---

## 1. Security

### S1 — High · A room peer can forge the life a rejoining player resumes, and therefore their leaderboard score

**Where:** `hooks/useMatch.tsx:1142-1151` (`case "snapshotReply"`),
`hooks/useMatch.tsx:1577-1595` (`requestSnapshot`),
`hooks/useMatch.tsx:1765-1776` (the rejoin's use of it),
`lib/mp/protocol.ts:504-512` (the parser).

**Risk.** Every other inbound game-state message is attested. A `status` is
refused unless its author is on the frozen roster *and* holds the presence
session that currently seats that player (`useMatch.tsx:1050-1071`); a
`snapshot` is refused on the same two tests plus `sameWorld` and a freshness
check (`useMatch.tsx:1073-1141`). `snapshotReply` has neither test. Its only
gates are `msg.playerId === selfId`, `sameWorld(msg.state)` (mode, seed and
`backgroundId` — all three are public, printed on the share card), and the
existence of a waiter.

`requestSnapshot` then takes the **first** reply that arrives and does not
corroborate it against any other. The state it accepts becomes `base` in the
rejoin, is fast-forwarded, written to `matchStore`, reported to the room as the
player's own status, and — when the match ends — posted to `results` under the
*victim's* `user_id`. `parseRunState` bounds the values but the attacker
chooses them freely inside those bounds: `cash` up to `MONEY_LIMIT` (1e12),
each holding up to 1e12, `salary`, `homeValue` and so on. `results_score_sane`
admits anything under 1e15, so a forged score of 1e12 lands on the public board
attributed to a player who never played it.

The room's own "no server, no authority" caveat does not cover this. That
caveat is about a client reporting *its own* score, which the game already
accepts. This is one player writing another player's score, which is exactly
the property `lib/mp/protocol.ts:459-461` states the protocol enforces ("A
member may only speak for itself — a presence row claiming someone else's
status is the cheap way to fake a leaderboard, so it is dropped").

**Precondition, stated honestly.** The reply path is only reached when the
rejoining client has *no* local record for the room
(`const local = loadMatch(cfg.roomCode, selfId)?.state ?? null`, then
`if (!local && turned)`). That means rejoining from a different browser or
device, after clearing site data, or from a private window — not the common
same-tab reconnect. The attacker must also be in the room, which requires the
six-character code. It is narrower than S2's reach but far more damaging when
it lands.

**Recommendation.** Corroborate the reply against what the room has already
been showing for that seat. The rejoining client holds a `MatchPeer` row for
its own `playerId` built from broadcast statuses, so the check costs nothing.
`netWorth` and `yearIndex` are already imported in this file, so the only new
name is the drift band:

```ts
// hooks/useMatch.tsx — case "snapshotReply"
case "snapshotReply": {
  if (msg.playerId !== selfIdRef.current) return;
  if (!sameWorld(msg.state)) return;
  // The room has been ranking this seat all match. A life that does not match
  // the figure the standings already carry for it was not handed back, it was
  // invented — refuse it and let the rejoin fall through to the seed rebuild,
  // which is the same `initRun` the room's own ghost-play used for this seat.
  const seat = peersRef.current[selfIdRef.current];
  if (seat?.reported) {
    const claimed = netWorth(msg.state);
    // Ghost fast-forwards move the figure, so this is a sanity band, not equality.
    if (!Number.isFinite(claimed) || Math.abs(claimed - seat.netWorth) > SNAPSHOT_DRIFT) return;
    if (yearIndex(msg.state) > seat.yearIndex + 1) return;
  }
  const waiter = snapshotWaiterRef.current;
  if (!waiter) return;
  snapshotWaiterRef.current = null;
  waiter(msg.state, msg.selfYear ?? null);
  return;
}
```

A stricter variant, if the extra round trip is acceptable: keep collecting
replies for the whole `SNAPSHOT_WAIT_MS` window and take a state only if two
distinct senders agree on it byte for byte. That works because the file already
states the invariant it rests on — "a snapshot for a player is either their own
report or a byte-identical deterministic fast-forward of it"
(`useMatch.tsx:1118-1122`) — but it needs a sender id added to
`SnapshotReplyMsg`, which the wire does not currently carry.

### S2 — Medium · `profile_by_friend_code` is unrate-limited, and the precondition its own author set has now been met

**Where:** `supabase/schema.sql:167-182`,
`supabase/migrations/2026-08-27_01_security_additive.sql:49-69`,
`lib/cloud/profiles.ts:436-445`.

**Risk.** The RPC is a point lookup by design — one row in, at most one row
out, no code in the result — and that correctly removes the *paging* attack
that migration 02 closed. It does not remove the *guessing* attack, and nothing
else does either. Any signed-in account may call it as fast as PostgREST will
answer. Codes are six characters over a 31-glyph alphabet (887M), so the cost
of finding a live one is `887M / (number of players)` calls: at 10,000 players
that is roughly 89,000 requests to hit one, and the whole directory —
`id`, `username`, `avatar_seed` for every player — falls out of a full walk.
That voids "added by code, never by search", which `supabase/schema.sql:93-95`
names as the one property the friends feature rests on, and it enables
unsolicited friend requests at scale.

The migration that created the function says so in its own `comment on`:

> Codes are 6 chars over a 31-glyph alphabet (~887M); **consider a Supabase
> rate limit if the friends UI ever ships.**

The friends UI has shipped — `components/social/FriendsSheet.tsx` is the way to
add one, and `components/social/Leaderboard.tsx:44-56` restores the Friends tab
explicitly because of it. The condition was met; the limiter was not added.

**Recommendation.** The project already has the right pattern for this: the
rename limiter (`spend_rename_attempt`, migration `2026-09-02_09`) spends an
attempt in a single `UPDATE` so concurrent callers serialise. Mirror it. Add
`code_window_start timestamptz` / `code_attempts int not null default 0` to
`profiles`, and make the lookup spend one:

```sql
create or replace function public.profile_by_friend_code(code text)
returns table (id uuid, username text, avatar_seed text)
language plpgsql security definer stable
set search_path = public
as $$
declare spent int;
begin
  -- One statement, so the row lock serialises concurrent callers. 20/hour is
  -- generous for a human typing a code off a friend's screen and useless for a
  -- walk of the namespace.
  update public.profiles p
     set code_window_start = case
           when p.code_window_start is null or now() - p.code_window_start > interval '1 hour'
           then now() else p.code_window_start end,
         code_attempts = case
           when p.code_window_start is null or now() - p.code_window_start > interval '1 hour'
           then 1 else p.code_attempts + 1 end
   where p.id = auth.uid()
   returning p.code_attempts into spent;

  if spent is null or spent > 20 then return; end if;

  return query
    select q.id, q.username, q.avatar_seed
      from public.profiles q
     where q.friend_code = upper(trim(code))
     limit 1;
end;
$$;
```

Note this changes the function to `volatile` in practice (it writes), so drop
`stable` when you apply it. If a schema change is unwanted, the cheaper stopgap
is to move the lookup behind the existing `profile` Edge Function, which
already owns a per-user limiter and a `429` response shape.

### S3 — Low · The browser-configured Supabase singleton is reused inside server components

**Where:** `lib/supabase.ts:7-8`, consumed on the server by
`app/r/[id]/page.tsx:191` and `:171` through `lib/cloud/results.ts:412-424`.

**Risk.** The one exported client is built with
`{ auth: { persistSession: true, detectSessionInUrl: true } }` — both are
browser settings — and `/r/[id]` is a Server Component that imports
`getResult`, which uses it. In the Node runtime that singleton is shared across
*every* request the process serves. Nothing exploits it today: no code path
signs in on the server, so no session is ever written into the shared client's
memory storage, and the anon key reads a table that is public by RLS. It is
latent rather than live. But it is the standard shape of a cross-request
session-leak bug, and the OG route already sidesteps it by fetching over raw
REST.

**Recommendation.** Export a second, explicitly server-shaped client and have
the server readers use it:

```ts
// lib/supabase.ts
/** Server-side reads only. No session, ever — this instance is shared across
 *  every request the Node process serves. */
export const supabaseServer: SupabaseClient | null =
  url && anon
    ? createClient(url, anon, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
    : null;
```

### S4 — Low · Two moderate transitive dependency advisories

**Where:** `package.json` / `package-lock.json`.

| Package | Path | Severity | Ships to users? |
|---|---|---|---|
| `fflate@0.6.10` | `@react-three/rapier` → `three-stdlib` | moderate — infinite loop on malformed ZIP64 in `unzipSync` | only if a `three-stdlib` loader is reached; no code here calls one |
| `qs@6.15.3` | `shadcn` → `@modelcontextprotocol/sdk` → `express` | moderate — array-limit bypass, DoS via `isBuffer` | no — `shadcn` is a devDependency |

Neither is reachable from user input in this app. `npm audit fix` resolves both
without a major bump.

---

## 2. Functional bugs

### F1 — High · A guest in a production build loses all Money Brain mastery the moment they sign in

**Where:** `lib/cloud/mastery.ts:52-66` (`mergeLocalMastery`),
`hooks/useAuth.tsx:65-69` and `:93-97` (the cloud sign-in paths),
`hooks/useAuth.tsx:171` (the only call site).

**Risk.** Two independent faults line up.

1. `mergeLocalMastery` starts with `if (isCloud || fromId === toId) return;`.
   The comment explains it as "Local-only: in cloud mode an anonymous player has
   no rows to carry." That premise is false. `resolveProgressId`
   (`lib/cloud/identity.ts:68-71`) deliberately returns the **device** id for a
   guest *even when `isCloud` is true* — the function's own docstring says why —
   and `cloudMasteryFor` then routes that id to the `localStorage` branch
   (`lib/cloud/mastery.ts:69-71`). A cloud guest therefore accumulates mastery
   rows under `lifepatch.mastery.device-…` on every run. There is plenty to
   carry; the guard refuses to carry it.

2. Even with the guard removed, the function would never fire on the path that
   matters. It is called from exactly one place — `hooks/useAuth.tsx:171` —
   which sits inside the **dev fallback** branch of `signIn`, after the
   `if (isCloud && supabase)` return at `:144-152`. The cloud magic-link
   handlers at `:65-69` and `:93-97` call `adoptGuestSaves` and nothing else.

So in production: play as a guest, earn concepts, sign in with an email. The
magic link lands, `useProfile` re-resolves to the auth uuid, `getMastery` reads
an empty `mastery` table, and the Money Brain reads 0% with every concept
locked — while `LifeReport` still announces the concepts the run sharpened.
That is precisely the failure `lib/cloud/identity.ts:58-66` describes as "the
bug the auth refactor was written to kill", and the promise
`lib/saves.ts:155-163` makes on the saves side ("Signing in must never read as
'my save vanished' — the same reasoning that made `signIn` merge local mastery
across"). Saves keep that promise on the cloud path. Mastery does not.

**Recommendation.** Give mastery the same treatment `adoptGuestSaves` gets: an
idempotent, best-effort, marker-guarded adoption that works in cloud mode, and
call it from both cloud handlers.

```ts
// lib/cloud/mastery.ts
/**
 * Carry a guest's device-filed mastery onto a real account, in the cloud.
 *
 * `mergeLocalMastery` is the local-to-local half and bails on `isCloud`. This is
 * the half that was missing: `resolveProgressId` hands a cloud GUEST the device
 * id on purpose, so there are always rows here to carry. Levels take the higher
 * of the two, so signing in can only ever add. Once per account, like
 * `adoptGuestSaves`, and best-effort — a failure leaves the guest copy where it
 * is and is retried on the next sign-in.
 */
export async function adoptGuestMastery(guestId: string, userId: string): Promise<void> {
  if (!guestId || !userId || guestId === userId || !isGuestId(guestId)) return;
  if (!cloudMasteryFor(userId)) return;
  const done = `lifepatch.masteryAdopted.${userId}`;
  try { if (localStorage.getItem(done) === "1") return; } catch {}

  const local = readLocal(guestId);
  if (local.length === 0) {
    try { localStorage.setItem(done, "1"); } catch {}
    return;
  }
  let cloud: MasteryRow[];
  try { cloud = await readMastery(userId); } catch { return; } // a wrong read is a confident write
  const byId = new Map(cloud.map((r) => [r.conceptId, r]));

  const rows = local
    .filter((r) => (byId.get(r.conceptId)?.level ?? 0) < r.level)
    .map((r) => ({
      user_id: userId,
      concept_id: r.conceptId,
      level: Math.min(r.level, MAX_MASTERY_LEVEL),
      updated_at: r.updatedAt,
    }));
  if (rows.length > 0) {
    const { error } = await supabase!.from("mastery").upsert(rows, { onConflict: "user_id,concept_id" });
    if (error) return; // leave the guest copy alone; retried next sign-in
  }
  try {
    localStorage.removeItem(localKey(guestId));
    localStorage.setItem(done, "1");
  } catch {}
}
```

and in `hooks/useAuth.tsx`, beside each existing `adoptGuestSaves` call:

```ts
if (u) {
  try {
    await adoptGuestSaves(localPlayerId(), u.id);
    await adoptGuestMastery(localPlayerId(), u.id);
  } catch {}
}
```

While fixing this, correct `mergeLocalMastery`'s comment — "in cloud mode an
anonymous player has no rows to carry" is the assumption that produced the bug.

### F2 — Medium · The Friends leaderboard tab can cache an empty board for the life of the mount

**Where:** `components/social/Leaderboard.tsx:244` (`cacheKey`),
`:247-250` (the clear-on-refresh effect), `:251-260` (the cache hit),
`:296` (the dependency list).

**Risk.** The per-mount result cache is keyed on
`` `${mode}|${scope}|${background}|${dailyKey ?? ""}` `` — `profileId` is in the
effect's *dependencies* but not in the *key*. `profileId` comes from
`useProfile()`, which resolves asynchronously (`hooks/useProfile.ts:39-72`, and
in cloud mode `ensureProfile` is an Edge Function round trip). So:

1. Board mounts with `profile === null` → `profileId === null`.
2. Player taps **Friends** before the profile lands.
3. `friendIds` is `[]` (`:267-268`), `topResults` short-circuits to `[]`
   (`lib/cloud/results.ts:254`), and `{ rows: [], profs: {} }` is written to
   `cache` under `story|friends|all|`.
4. `profileId` resolves, the effect re-runs — and hits that cached empty entry
   on line 253 before it ever reaches the fetch.

The player sees "No friends added yet" over a list of real friends, and no tab
change will clear it: only `retry` or `refreshSignal` clears the cache. On the
`/leaderboard` route, where `open` is hardcoded `true`, there is no toggle to
force a remount either.

**Recommendation.** The identity the rows were fetched *for* is part of what
makes them cacheable, so put it in the key. This also fixes the stale board
after a sign-in or sign-out inside one mount.

```ts
// components/social/Leaderboard.tsx
// `profileId` is part of the key, not just the deps: the friends scope resolves
// its row set from it, and it lands asynchronously (`useProfile`). Keyed without
// it, the empty board fetched before the profile arrived is served back to the
// fetch that finally has one.
const cacheKey = `${mode}|${scope}|${background}|${dailyKey ?? ""}|${profileId ?? ""}`;
```

Optionally also skip caching a friends-scope miss outright:
`if (!(scope === "friends" && !profileId)) cache.current.set(cacheKey, …)`.

### F3 — Low · `myBest`'s local branch can return an unrankable row; the cloud branch cannot

**Where:** `lib/cloud/results.ts:393-409`.

**Risk.** The cloud branch over-fetches five rows and takes
`.find(rankable)`, with a comment explaining exactly why one row is not enough:
an unrankable score sorts to the top. The local branch immediately below does
`rows.reduce((best, r) => (r.score > best.score ? r : best))` with no
`rankable` filter. Every comparison against `NaN` is false, so a `NaN` at
`rows[0]` — the newest row, since the list is stored newest-first — is returned
as the player's personal best and rendered by `PersonalBestRow`. `readLocal`
parses player-writable storage with a cast and no validation
(`:118-125`), so this is reachable.

**Recommendation.** Apply the same predicate the rest of the module applies:

```ts
const rows = readLocal().filter((r) => r.userId === userId && r.mode === mode && rankable(r));
if (rows.length === 0) return null;
return rows.reduce((best, r) => (r.score > best.score ? r : best));
```

### F4 — Low · `/r/[id]` queries the database for ids that cannot be result ids

**Where:** `app/r/[id]/page.tsx:171` and `:191`, via
`lib/cloud/results.ts:412-424`.

**Risk.** The OG route guards on `UUID_RE` *before* it fetches
(`app/api/og/[id]/route.tsx:28`, `:47`) and documents why. The page does not.
`getResult` passes the raw slug into `.eq("id", id)` against a `uuid` column, so
every junk id is a full round trip that errors in Postgres and returns `null`
via a discarded error. Because the route is ISR with `dynamicParams` on
(`:23`, `:35-37`), each distinct junk id is also its own cache entry, so a
stream of random slugs is a stream of origin renders and database reads — the
exact amplification the OG route's 302-to-`/opengraph-image` exists to remove
(`app/api/og/[id]/route.tsx:155-171`).

**Recommendation.** Shape-check first, in `getResult` so both readers benefit.
`lib/deepLink.ts:325` already owns a `RESULT_ID_RE` describing both forms
(`uuid` in cloud, `local-<ts>-<rand>` in dev) — export it and reuse it rather
than writing a fourth pattern:

```ts
// lib/cloud/results.ts
export async function getResult(id: string): Promise<ResultRow | null> {
  // Bounded before it reaches a query, the way the OG route bounds it. A slug that
  // cannot be an id is not a row that exists, and answering that without a round
  // trip keeps a stream of random slugs off the origin and off the database.
  if (!RESULT_ID_RE.test(id)) return null;
  …
}
```

---

## 3. Code quality / performance

### Q1 — `useProfile` is a plain hook with six independent call sites

**Where:** `hooks/useProfile.ts:17`, called from
`components/social/FriendsSheet.tsx:80`, `components/social/Leaderboard.tsx:146`,
`components/social/StreakChip.tsx:20`,
`components/cashflow/recap/CashflowReport.tsx:54`,
`components/learn/MasteryMap.tsx:32`, `components/screens/LifeReport.tsx:175`.

Each mount runs its own `Promise.all([ensureProfile, getStreak, getMastery])` —
three requests, and `ensureProfile` can be a `profile` Edge Function invocation
on a first sign-in. Any screen with two of these mounted (`LifeReport` +
`StreakChip`, or the leaderboard dialog over a run) pays for the same three
reads twice, with two copies of the state that can disagree while they are in
flight.

This is the identical shape of the bug `AuthProvider`'s docstring describes and
solves for auth (`hooks/useAuth.tsx:202-215`: "This used to be a bare hook, so
every caller got its OWN `user`"). Apply the same remedy: wrap the state in a
`ProfileProvider` mounted above `MotionProvider`'s children in
`components/AppShell.tsx`, keep `useProfile()` as the context reader, and have
it throw outside the provider for the reason `useAuth` gives.

### Q2 — The share page's Supabase read has no timeout; the OG route's does

**Where:** `app/r/[id]/page.tsx:171`, `:191`; contrast
`app/api/og/[id]/route.tsx:59` (`signal: AbortSignal.timeout(2500)`).

The OG route's comment states the case precisely — an unfurl is a scraper
waiting on a socket, and an uncapped call lets a wedged Supabase hold the
invocation until the platform's own limit and bill the whole of it. `/r/[id]`
is the *same* surface reached by the *same* traffic, and `generateMetadata` and
the page body each make an uncapped call. supabase-js has no default timeout.

Add one. The cleanest place is `getResult`, since both callers want the same
answer on a timeout (render nothing):

```ts
const { data } = await supabase
  .from("results").select("*").eq("id", id)
  .abortSignal(AbortSignal.timeout(2500))
  .maybeSingle();
```

### Q3 — Three unused runtime dependencies, and one type package in the wrong section

**Where:** `package.json:31,35,43` and `:32`.

`@tonejs/midi`, `clsx` and `tailwind-merge` have no import anywhere in `app/`,
`components/`, `lib/`, `src/`, `hooks/` or `scripts/` — verified by search
across every extension. `CLAUDE.md` names `@tonejs/midi` as part of the audio
stack, so it may be intended for future MIDI-first composition; if so, a line in
`.claude/game-music-stack-audit.md` saying it is installed ahead of use would
stop the next reviewer filing this again. `clsx` and `tailwind-merge` appear to
be leftovers from `shadcn` init (`components.json` points `utils` at
`@/lib/utils`, which does not exist).

Separately, `@types/howler` is in `dependencies` rather than `devDependencies`,
unlike its sibling `@types/qrcode`.

### Q4 — `engines` and the QA scripts disagree with the toolchain

`package.json:5` pins `"node": "24.x"`. `qa:rename` and `qa:username` import
`.ts` files directly under a package with no `"type": "module"`, so every run
prints `MODULE_TYPELESS_PACKAGE_JSON` and re-parses the module — harmless, but
it is noise on top of two otherwise clean suites. Either add `"type": "module"`
(and check the `.mjs`/`.js` split still resolves) or load those two shared
modules through a tiny `.mjs` shim.

---

## Appendix — things checked and found sound

Recorded so the next pass does not re-derive them:

- **No XSS surface.** No `dangerouslySetInnerHTML`, `innerHTML`, `eval`,
  `new Function` or `document.write` anywhere in the tree. The only
  player-authored string that reaches another player's screen is `username`,
  which is charset-locked by `profiles_username_charset`, word-screened by the
  single shared `checkUsername`, and writable only by the service role. The
  `script-src` deferral argued in `next.config.ts:6-36` still rests on premises
  that hold.
- **No hardcoded secrets.** Nothing matching service-role keys, JWTs, private
  keys or cloud credentials in the working tree; only `.env.local.example` is
  tracked, and it warns against pasting a secret key.
- **RLS.** `profiles` is select-own-row with table-level INSERT/UPDATE revoked;
  `profiles_public` is `revoke all` then `grant select`, which is the correct
  order for an auto-updatable view; `results` grants INSERT on exactly the five
  columns the client writes; `friends` permits `accepted` only where the
  reciprocal edge exists; `top_results` is `security invoker` so RLS still
  decides. `qa:rls` closes 16 attack probes against both the migration path and
  a fresh `schema.sql`.
- **Wire validation.** `lib/mp/protocol.ts` rebuilds every field, checks
  `RUN_VERSION`, cross-validates `year >= startYear`, caps collections, and
  refuses rather than clamps where a clamp would still pin a row. Prototype
  pollution via `flags` / `yearChoices` is not reachable — the values assigned
  are numbers and strings, and `obj["__proto__"] = 5` is a silent no-op.
- **Untrusted-json reads.** `lib/metrics.ts` is the single correct reader, and
  `qa:metrics` has a gate asserting every consumer goes through it.
- **The `results` integrity work.** Score bounds that exclude `NaN` (upper bound
  only, because `'NaN' = 'NaN'` is true for `numeric`), a closed verdict set, an
  8 KiB metrics cap, a bounded history array, and a per-player row cap trigger
  that spares each group's best *rankable* row.
