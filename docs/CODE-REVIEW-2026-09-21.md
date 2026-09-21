# LifePatch — codebase review, 2026-09-21

Scope: every file under `app/`, `lib/`, `src/`, `hooks/`, `components/`, `supabase/`
and `scripts/`, plus `next.config.ts`, `package.json` and the lockfile. Findings are
ordered most severe first and bucketed as **Critical Security Vulnerability**,
**Functional Bug**, or **Code Quality / Performance Issue**.

## What already holds

Stated up front so the list below is read for what it is — a short tail, not a
verdict on the codebase. Everything the repo's own gates cover is green on this
tree, and the classes of bug those gates were written for are genuinely closed:

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npx eslint .` | clean |
| `npm run build` | succeeds (6 routes, `/r/[id]` still SSG) |
| `qa:engine` (34), `qa:cloud` (16), `qa:rls` (16 probes), `qa:username`, `qa:rename` (16), `qa:challenge` (10), `qa:metrics` (19), `qa:transport` (11) | all pass |
| `qa:mp`, `qa:audio` | not run — they drive a browser against `localhost:3000` |

No hardcoded secrets anywhere in the tree (`sb_secret_*`, `service_role`, JWTs,
`-----BEGIN`); the only env reads in shipped code are `NEXT_PUBLIC_*`, `NODE_ENV`
and `VERCEL_URL`. No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or
`new Function`. Every PostgREST value is parameterised; the one place a filter
*expression* is concatenated (`lib/cloud/friends.ts:167`) is fenced behind a UUID
test on the line above it. Untrusted input paths — `results.metrics`, the
multiplayer wire, `localStorage` — are rebuilt field by field rather than cast.

---

# 1. Critical Security Vulnerabilities

## 1.1 Friend-code lookup is an unthrottled enumeration oracle

**`supabase/schema.sql:167-182`** (`public.profile_by_friend_code`)

The function is a point query and returns no code, which closes the *paging*
attack migration 02 was written for. It does not close the *guessing* attack: any
signed-in account may call it as fast as it likes, and the answer ("a player" vs
"null") is a clean yes/no oracle over a 31⁶ ≈ 887 M code space.

The relevant number is not the cost of hitting one *chosen* code — it is the cost
of hitting *any* code, which is `887M / players`. At a thousand players that is
~887 k calls for a first hit, i.e. a couple of hours at 100 req/s, and the hit
rate rises linearly as the game grows. A hit is a capability: `addByCode` then
puts a pending request on a stranger who was never told their code had leaked.

This is the same shape as the rename oracle, which the project already judged
worth a durable, atomic, five-per-hour ceiling (migrations 07 and 09) — and that
one leaked strictly less (whether a *name* exists, not a capability token).

**Fix.** Reuse the pattern that is already in the repo. Add a counter keyed on the
caller and spend it inside the same statement that does the lookup, so concurrent
callers serialise on the row lock exactly as `spend_rename_attempt` makes them:

```sql
-- migration: bound friend-code guesses the way renames are bounded
create table if not exists public.friend_code_probes (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  window_start timestamptz not null default now(),
  attempts     int not null default 0
);
alter table public.friend_code_probes enable row level security;  -- no client policy: definer-only

create or replace function public.profile_by_friend_code(code text)
returns table (id uuid, username text, avatar_seed text)
language plpgsql security definer stable set search_path = public as $$
declare
  limit_n  constant int := 20;                      -- generous for a human, useless for a walk
  window_i constant interval := interval '1 hour';
  uid uuid := auth.uid();
begin
  if uid is null then return; end if;
  insert into public.friend_code_probes as p (user_id, window_start, attempts)
       values (uid, now(), 1)
  on conflict (user_id) do update
     set window_start = case when now() - p.window_start >= window_i then now() else p.window_start end,
         attempts     = case when now() - p.window_start >= window_i then 1 else p.attempts + 1 end
   where p.attempts < limit_n or now() - p.window_start >= window_i;
  if not found then
    raise exception 'too many lookups' using errcode = 'P0001';
  end if;
  return query
    select pr.id, pr.username, pr.avatar_seed
      from public.profiles pr
     where pr.friend_code = upper(trim(code))
     limit 1;
end $$;
```

`getByFriendCode` (`lib/cloud/profiles.ts:236-240`) already returns `null` on
`error`, so a throttled caller degrades to "not found" with no client change; give
the sheet a distinct message for `P0001` if you want to be kind about it.

## 1.2 `top_results` is an anon-callable amplifier

**`supabase/migrations/2026-09-02_10_top_results.sql:45-95`**

```sql
create or replace function public.top_results(
  p_mode text, p_limit int default 25, ..., p_users uuid[] default null)
...
grant execute on function public.top_results(...) to anon, authenticated;
```

Three things compound here, and the grant to `anon` means the caller needs nothing
but the publishable key that ships in the bundle:

1. **`p_limit` is never clamped.** `limit 2000000000` is a legal call.
2. **`p_users` is unbounded.** A megabyte-long uuid array is a legal call.
3. **The inner `distinct on (r.user_id) ... order by r.user_id, r.score desc` has
   no limit of its own**, so *every* call reads and sorts every row for that mode
   before the outer `limit` throws the rest away. The cost is independent of
   `p_limit` and grows linearly with the table forever.

So one request costs a full scan + sort of `results`, and the response size is
attacker-chosen. That is a cheap way to spend someone else's database.

**Fix.** Clamp both inputs in the signature body and bound the work:

```sql
    ) b
   order by b.score desc, b.id asc
   limit least(greatest(coalesce(p_limit, 25), 1), 100);
```

and, in the inner query, refuse an oversized roster rather than scanning for it:

```sql
         and (p_users is null or (array_length(p_users, 1) <= 64 and r.user_id = any (p_users)))
```

Pair it with the index in §3.1, which is what makes the remaining scan cheap.
`topResults` (`lib/cloud/results.ts:276-283`) passes `opts.limit` straight
through, so the server-side clamp is the only one that counts.

## 1.3 The whole `results` table is exportable with the publishable key

**`supabase/schema.sql:232-236`**

```sql
create policy "results - public read" on public.results for select using (true);
```

Public read is the intended design for a leaderboard, and the row-level answer is
right. The missing half is a *volume* bound: nothing in the repo sets PostgREST's
`db-max-rows` (there is no `supabase/config.toml`), and `results` keeps its
default table-wide SELECT grant — so
`GET /rest/v1/results?select=*&limit=100000&offset=…` walks the entire table,
`metrics` blobs included, at up to 8 KiB a row. Every `user_id` is in there too,
and `profiles_public` maps `id → username`, so the export is attributable.

Note the asymmetry with the table next door: `profiles` got an explicit
`revoke select ... from anon` *and* a projection view. `results` got neither,
because the board needs the rows — but the board needs *25* of them.

**Fix.** Set a server-side row ceiling, which costs nothing and breaks nothing
here (the deepest legitimate read is `topResults`' six pages of `limit * 5`, and
`getResult` reads one row by id):

```toml
# supabase/config.toml
[api]
max_rows = 1000
```

If you would rather keep it in SQL, the equivalent is to revoke the table grant
and re-grant only the columns the board draws, leaving `metrics` to `top_results`
and `getResult` — but that is a bigger change, and `max_rows` gets most of it.

## 1.4 Two moderate advisories in the dependency tree

**`package-lock.json`** — `npm audit --package-lock-only`:

| Package | Version | Advisory | Path | Ships to browsers? |
| --- | --- | --- | --- | --- |
| `fflate` | 0.6.10 | [GHSA-px8p-9vwx-vf98](https://github.com/advisories/GHSA-px8p-9vwx-vf98) — infinite loop on malformed ZIP64 in `unzipSync` | `@react-three/rapier → three-stdlib` | **yes** |
| `qs` | 6.15.3 | GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g | `shadcn → @modelcontextprotocol/sdk → express` | no (devDependency) |

`fflate` is the one that matters: it is a runtime dependency reachable from the
3D board. The app only ever unzips its own `public/board3d/` assets today, so
there is no live exploit path — but "the loader only sees our own files" is a
premise, and premises are what this repo is good at writing down and then
re-checking. `qs` is dev-only and can wait for the next `shadcn` bump.

**Fix.** `three-stdlib` already accepts the patched line, so an override is enough:

```jsonc
// package.json
"overrides": {
  "postcss": "$postcss",
  "fflate": "^0.8.2"
}
```

then `npm install && npm audit`.

---

# 2. Functional Bugs

## 2.1 A dropped friends request renders as "you have no friends"

**`lib/cloud/friends.ts:155-171`**

```ts
    const { data } = await supabase
      .from("friends")
      .select("*")
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`);
    return (data ?? []).map(fromRow);
```

`error` goes in the bin. supabase-js resolves rather than rejects, so an offline
moment, an expired session or an RLS refusal all return `[]` — the same value a
player with no friends returns.

This is the exact defect the repo has already written up twice, in
`lib/cloud/results.ts:339-367` ("A DROPPED REQUEST IS NOT AN EMPTY BOARD") and in
`getProfiles`. `listEdges` is the one reader that still has it, and it feeds three
things:

- `listFriendIds` → `[]` → `Leaderboard`'s effect
  (`components/social/Leaderboard.tsx:268-273`) calls
  `topResults(mode, { scope: "friends", friendIds: [] })`, which **returns early
  at `results.ts:254`** before it can throw. `failed` stays `false`, so the reader
  gets the empty state instead of `FailedState` and its Retry button — a network
  fault diagnosed as a social one, which is the same sentence the results fix
  called "a lie".
- `listIncoming` → pending friend requests silently disappear from the sheet.
- `accept`'s local branch → an accept is refused because the incoming edge it
  checks for "does not exist".

**Fix.** Read the error and throw; every caller is already built for it.

```ts
    const { data, error } = await supabase
      .from("friends")
      .select("*")
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`);
    // A dropped request is not an empty friends list — same rule as `topResults`.
    if (error) throw new Error("Could not load your friends.");
    return (data ?? []).map(fromRow);
```

`Leaderboard`'s `catch` (line 283) already sets `failed`; `FriendsSheet` needs the
same treatment its cloud siblings have.

## 2.2 `myBest`'s local branch can return an unrankable row

**`lib/cloud/results.ts:393-410`**

The cloud branch deliberately over-fetches and then takes `.find(rankable)`,
with a comment explaining that an unrankable score sorts to the top. The local
branch immediately below does not apply the same test:

```ts
  const rows = readLocal().filter((r) => r.userId === userId && r.mode === mode);
  if (rows.length === 0) return null;
  return rows.reduce((best, r) => (r.score > best.score ? r : best));
```

With one corrupted row (`score: NaN`, or an `Infinity` round-tripped through
`JSON.parse`), every `r.score > best.score` comparison against it is `false` in
both directions, so the reduce simply keeps whichever bad row it started on and
`PersonalBestRow` prints the player's best run as `NaN`. It is the *local* store,
so this needs a corrupted `lifepatch.results` rather than a hostile peer — but the
store is player-writable, `capLocal` and `bestPerUser` twelve lines up both guard
for exactly this, and the two halves of one function disagreeing is how the next
reader gets it wrong too.

**Fix.**

```ts
  const rows = readLocal().filter((r) => r.userId === userId && r.mode === mode && rankable(r));
  if (rows.length === 0) return null;
  return rows.reduce((best, r) => (r.score > best.score ? r : best));
```

## 2.3 `listSaves` swallows its error — and nothing calls it

**`lib/saves.ts:127-143`**

```ts
    const { data } = await supabase!.from("saves").select("mode, updated_at").eq("user_id", userId);
    return (data ?? []).map(...);
```

The file's own header is three paragraphs on why discarding `{ error }` here is
the bug that "costs a player their run", and `saveRun` / `loadRun` both throw. The
third function in the same file still returns `[]` on failure, which would read as
"no saved runs" — over a save that is still there.

It is currently unreachable (`grep` finds no caller outside the definition), which
is why nobody has hit it, and which also makes the fix free.

**Fix.** Delete it, or bring it in line with its neighbours:

```ts
    const { data, error } = await supabase!
      .from("saves").select("mode, updated_at").eq("user_id", userId);
    if (error) throw new Error(error.message);
```

Deleting is the better answer while it has no caller — dead code that is wrong is
a trap for whoever wires it up.

---

# 3. Code Quality / Performance Issues

## 3.1 The leaderboard's index does not match the leaderboard's query

**`supabase/schema.sql:229-230`** vs **`migrations/…10_top_results.sql:76-84`**

The table carries `results_mode_score_idx (mode, score desc)` and
`results_user_idx (user_id)`. The query that now draws every board is:

```sql
select distinct on (r.user_id) r.*
  from public.results r
 where r.mode = p_mode ...
 order by r.user_id, r.score desc
```

Neither index serves that ordering, so the planner reads every row for the mode
and sorts it — on every leaderboard open that misses the client-side cache, for
anonymous readers included. The `distinct on` was added to turn six sequential
round trips into one; it is worth making that one round trip cheap.

**Fix.**

```sql
create index if not exists results_mode_user_score_idx
  on public.results (mode, user_id, score desc);
```

That converts the `distinct on` into an index skip/scan and removes the sort.
Keep `results_mode_score_idx` — the page-walk fallback at `results.ts:289-316`
still orders by `(score desc, id)` and is still the path on a project that has not
applied migration 10. If you also run the `week` and `daily` scopes hot, the
expression index the README already mentions for `metrics->>backgroundId` wants a
sibling for `metrics->>daily`.

## 3.2 The CSP is missing the directives that *don't* need a nonce

**`next.config.ts:113-127`**

The absent `script-src` is a documented, costed decision and I am not reopening
it. The observation is narrower: the policy names six directives and there is no
`default-src`, so `img-src`, `style-src`, `font-src`, `media-src`, `worker-src`,
`manifest-src` and `child-src` are all unrestricted. None of those interacts with
hydration, so none of them costs the nonce pipeline the header comment is
protecting the app from.

**The trap to avoid:** do *not* fix this with `default-src 'self'`. `script-src`
falls back to `default-src`, so adding it would start policing script execution —
which is exactly the change the comment argues against, and it would break Next's
inline bootstrap on the spot. Name the directives individually instead:

```ts
      "frame-ancestors 'none'",
      "frame-src 'none'",
      "form-action 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      // Added individually, NOT via `default-src`: script-src falls back to
      // default-src, and policing script execution is the nonce pipeline this
      // policy is deliberately not paying for. See the header note above.
      "img-src 'self' data: blob:",
      "media-src 'self'",
      // next/font self-hosts, so no Google origin is needed here.
      "font-src 'self' data:",
      // Next and framer-motion both write inline styles.
      "style-src 'self' 'unsafe-inline'",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      connectSrc(),
```

Verify against the 3D board and the audio engine before shipping — `blob:` on
`worker-src` and `img-src` is there for three.js and canvas readback.

## 3.3 Raw PostgREST text is thrown as a user-facing message

**`lib/saves.ts:65`** and **`lib/saves.ts:99`**

```ts
    if (error) throw new Error(error.message);
```

The house rule is written down in at least three places — `updateUsername`
("The message is ours, not Postgres's"), `submitResult`, and the `profile`
function's `ensure` handler, which was changed for precisely this. `saves.ts` is
the exception: `error.message` is the verbatim PostgREST/Postgres string, with
column names, relation names and constraint or RLS text in it.

It is not currently rendered — `useRun` maps the rejection to a boolean
(`saveFailed`) and `AuthGate` catches it and shows its own copy — so this is a
latent leak rather than a live one. It becomes live the first time somebody writes
`catch (e) { setError(e.message) }`.

**Fix.** Same shape as every other writer:

```ts
    if (error) {
      console.error("saveRun: upsert failed", error);
      throw new Error("Could not save your run. Try again in a moment.");
    }
```

## 3.4 `getProfile` reports an unreachable row as a missing one

**`lib/cloud/profiles.ts:119-123`**

```ts
    const { data } = await supabase!.from("profiles").select("*").eq("id", userId).maybeSingle();
    return data ? fromRow(data) : null;
```

Same discarded `error` as §2.1, but with a much smaller blast radius today:
`ensureProfile` answers `null` by calling the `profile` Edge Function, whose
`ensure` is idempotent get-or-create, so a transient read failure self-heals. On a
project where that function is not deployed yet, the fallback loop at lines
142-154 spends up to five INSERT attempts per mount, each bouncing off the primary
key. Worth reading the error and distinguishing "no row" from "no answer".

## 3.5 `results_cap_per_player` aggregates on every insert

**`supabase/schema.sql:284-333`**

The trigger opens with `select count(*) ... where user_id = new.user_id and mode = new.mode`
on every single insert, to discover — almost always — that the player is nowhere
near 500. `results_user_idx` is on `(user_id)` alone, so the `mode` predicate is a
recheck.

It is genuinely cheap at ≤500 rows per group and the pruning logic is correct; this
is housekeeping, not a defect. If it ever shows up, the counting index is
`(user_id, mode)` and the aggregate can short-circuit with an
`offset (cap - 1) limit 1` existence probe instead of a full count.

## 3.6 Smaller notes

- **`src/motion/useSpotlight.ts:48`** — the element-argument variant stores
  `next.current = { el, … }`, and nothing clears it. After the last pointer move
  the hook holds a strong reference to that DOM node for the life of the
  component's closure; the cleanup at line 38 cancels the frame but not the ref.
  One line: `next.current = null` in the same effect's cleanup.
- **`package.json:5`** declares `"node": "24.x"` with no `.nvmrc` or
  `engine-strict`. The tree builds fine on 22, so the declaration is currently
  advisory; either pin it or relax it.
- **`scripts/qa/*.mjs`** emit `MODULE_TYPELESS_PACKAGE_JSON` warnings when they
  import `supabase/functions/_shared/*.ts`. Cosmetic, and the fix the warning
  suggests (`"type": "module"` in `package.json`) would affect the Next build —
  leave it, or move the shim into the QA script.

---

# Not findings — reviewed and standing

Recorded so a future pass does not re-litigate them:

- **No `script-src`** (`next.config.ts:6-56`). Costed decision with a stated
  re-open condition. The premises still hold on this tree: no
  `dangerouslySetInnerHTML`, no third-party script tags, and the only
  player-authored string reaching another player's screen (`username`) is
  charset-locked in three places.
- **Multiplayer has no server authority.** Stated in-contract. Every inbound
  message is rebuilt field by field (`lib/mp/protocol.ts`), statuses and snapshots
  are fenced by roster membership *and* presence session
  (`hooks/useMatch.tsx:1050-1113`), the room clock cannot be pushed past what
  roster members demonstrably reached, and a snapshot from another world is
  refused (`sameWorld`). A peer holding the room code can still seed a
  config-less joiner — that is the rejoin design, and it is documented.
- **Realtime topics are open to anyone holding the publishable key.** True, and
  the room code (31⁶) is the only gate; the protocol parser is what makes that
  survivable. Worth revisiting only if Supabase Realtime Authorization
  (RLS on `realtime.messages`) is adopted, which would be the real fix.
- **`streaks` is public-read with client-written counters.** Bounded by
  `streaks_sane`, nothing ranks on it, and `bumpStreak` takes the strict read.
- **`randomIndex`** (`supabase/functions/_shared/generate.ts:39-52`) uses
  rejection sampling against `floor(0xffffffff / bound) * bound`. Accepting
  `[0, limit)` where `limit` is a multiple of `bound` is uniform; the `0xffffffff`
  vs `0x100000000` bound only discards a few extra values.
- **`flags` / `yearChoices` rebuild in `parseRunState`** assign attacker-chosen
  keys onto object literals. `obj["__proto__"] = <number|string>` is a silent
  no-op (the setter ignores non-objects), so there is no prototype-pollution path.
