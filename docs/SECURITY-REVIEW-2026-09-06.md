# LifePatch — codebase review, 2026-09-06

Scope: whole repository at `583b02d` (branch `claude/eager-cori-2udgdh`) — Next.js app,
`lib/` engine and cloud layer, `supabase/` schema + migrations + Edge Function, and the
dependency tree.

**State of the tree.** `npm run typecheck` and `npm run lint` are clean. Every offline QA
gate passes: `qa:challenge` 10/10, `qa:cloud` 16/16, `qa:engine` 34/34, `qa:metrics` 19/19,
`qa:transport` 11/11, `qa:rename` 16/16, `qa:rls` 16 probes closed / 24 behaviours intact,
`qa:username` 1728 generated + 22 innocent accepted / 24 abusive refused, `audio:meta` clean.
(`qa:audio` and `qa:mp` fail only because they drive Playwright against a dev server that is
not running here — not defects.)

**No critical vulnerability was found.** The obvious classes are genuinely closed: no
`dangerouslySetInnerHTML`, `eval`, `innerHTML` or `document.write` anywhere; no hardcoded
secrets (the only key in the tree is the publishable anon key, used as designed); the
`results` / `profiles` / `saves` write surfaces are column-granted rather than table-granted;
`verdict` is a closed set with a CHECK plus a `safeVerdict` reader guard; usernames are
charset-locked in three places; the multiplayer wire parser rebuilds every field and fences
`status`/`snapshot` on roster membership *and* session ownership.

What follows is what is still open, most severe first. Nothing here is a regression — items
1–3 are ceilings that were never built, item 4 is a rule that is stated but not enforced.

---

## 1. High · `top_results` takes an unbounded `p_limit` and is granted to `anon`

**Where:** `supabase/migrations/2026-09-02_10_top_results.sql:45-52`, grant at `:94-95`.

```sql
create or replace function public.top_results(
  p_mode text, p_limit int default 25, ...
)
...
grant execute on function public.top_results(text, int, timestamptz, text, text, uuid[])
  to anon, authenticated;
```

**Risk.** `p_limit` has a default but no ceiling, and the function is executable by `anon` —
i.e. by anyone holding the publishable key, which ships inside the JS bundle. The app itself
never passes a limit (`lib/cloud/results.ts:248`, `DEFAULT_LIMIT = 25`), so the clamp that
matters lives only in a client nobody is obliged to use. `top_results('story', 100000000)`
makes Postgres materialise `distinct on (user_id)` over every row for the mode and serialise
the lot back — a single unauthenticated request that costs a full sort plus arbitrary egress,
repeatable. This is precisely the class of hole the schema already closes elsewhere on
purpose (`results_metrics_small`, `results_metrics_history_bounded`, `results_score_sane`,
`saves_state_small`): every other client-controlled magnitude in this database is bounded,
and this one was missed because it arrived as a function argument rather than a column.

**Fix.** Clamp inside the function, so no caller can widen it:

```sql
create or replace function public.top_results(
  p_mode text, p_limit int default 25, ...
) returns table (...) language sql stable security invoker set search_path = public as $$
  select ...
   order by b.score desc, b.id asc
   limit least(greatest(coalesce(p_limit, 25), 1), 100);
$$;
```

`least(greatest(...))` also removes the "LIMIT must not be negative" error path a negative
argument currently produces. 100 is ~4× the largest board the UI draws.

---

## 2. Medium-High · `public.friends` has no per-player ceiling and no rate limit — and every target id is enumerable

**Where:** `supabase/schema.sql:368-423` (table + policies); the deferred note is at
`supabase/migrations/2026-08-27_01_security_additive.sql:69`.

**Risk.** Two things combine:

- `profiles_public` (`schema.sql:149-162`) is `grant select ... to anon, authenticated` over
  every row, and `results` is `for select using (true)` — so the complete set of player
  `uuid`s is downloadable by anyone. "Added by code, never by search" protects the *code*,
  not the *id*.
- `friends - write own side` permits any number of `{user_id: me, friend_id: <anyone>,
  status: 'pending'}` rows. There is no cap per player, no size bound, and no rate limit.
  `listIncoming` (`lib/cloud/friends.ts:196`) surfaces every one of them.

So one authenticated account can enumerate the player base and write a pending request to
every id in it — unbounded rows in a table nothing prunes, and a request notification on
every player's friends sheet. `results` got `results_cap_per_player` and `saves` got
`unique(user_id, mode)` + `saves_state_small` for exactly this reason; `friends` is the one
write surface that received neither.

Migration 01 already flagged the second half of this and deferred it — *"Codes are 6 chars
over a 31-glyph alphabet (~887M); consider a Supabase rate limit if the friends UI ever
ships."* The friends UI has shipped (`components/social/FriendsSheet.tsx`, mounted from
`components/AppShell.tsx:589` and `components/social/LeaderboardPage.tsx:80`), so the
condition on that note is now met and `profile_by_friend_code` (`schema.sql:167-182`) is an
unthrottled point-lookup oracle as well.

**Fix.** A cap trigger mirroring `results_cap_per_player`, refusing rather than pruning —
a friend edge is not something to silently delete:

```sql
create or replace function public.friends_cap_per_player()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cap constant int := 500;
  outgoing int;
begin
  select count(*) into outgoing
    from public.friends f
   where f.user_id = new.user_id and f.status = 'pending';
  if outgoing >= cap then
    raise exception 'friend request limit reached'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists friends_cap_per_player on public.friends;
create trigger friends_cap_per_player
  before insert on public.friends
  for each row execute function public.friends_cap_per_player();
```

And bound the code oracle the same way the rename oracle was bounded: reuse the
`spend_rename_attempt` pattern (`supabase/migrations/2026-09-02_09_rename_limit_atomic.sql`)
for `profile_by_friend_code`, or put a Supabase rate limit in front of it. Note the rename
limiter exists *specifically* because "two distinguishable answers plus unlimited attempts is
an oracle" — the friend-code lookup is the same shape with the same reasoning unapplied.

---

## 3. Medium · `public.mastery` accepts unbounded rows per player with a free-form key

**Where:** `supabase/schema.sql:426-446`.

```sql
concept_id text not null check (char_length(concept_id) <= 64),
...
primary key (user_id, concept_id)
create policy "mastery - insert own" on public.mastery for insert with check (auth.uid() = user_id);
```

**Risk.** `level` is bounded (0–5) and `concept_id` is length-bounded, but the *row count* is
not, and `concept_id` is arbitrary text rather than a member of a known set. One
authenticated account can insert millions of `(user_id, <random 64 chars>)` rows. The blast
radius is smaller than `friends` — the table is read-own-only, so nobody else ever sees them
— but it is still unmetered storage in the one table that got a value bound and no count
bound. The concept ids are a closed set in code (`lib/concepts.ts`); the database does not
know that.

**Fix.** Either a cap trigger as above (`cap constant int := 200`), or — better, since the
set really is closed — a CHECK against the enumerated ids, regenerated alongside
`lib/concepts.ts` the same way the verdict CHECK is kept beside `lib/verdict.ts`:

```sql
alter table public.mastery
  add constraint mastery_concept_known
  check (concept_id in ('cashFlow', 'passiveIncome', 'compounding', ...));  -- mirrors lib/concepts.ts
```

Add the same "CHANGING THIS NEEDS A MIGRATION" note the verdict constraint carries.

---

## 4. Medium · The Daily Ledger's "no private rehearsal" rule is stated but not enforceable

**Where:** `lib/challenge.ts:94-95`, `lib/daily.ts:85-94`, insert grant at
`supabase/schema.sql:262`.

`challengeableWorld` refuses to offer a daily row as a challengeable world, and says why:

> • A DAILY is not a practice range. Offering today's puzzle here would hand anyone a private
> rehearsal of it — same seed, same background, and the daily is dealt unbiased too — before
> they file the real attempt.

The intent is right; the mechanism does not hold. Three facts defeat it:

1. `dailySeed(date)` and `dailyBackgroundId(date)` are pure functions of a date string,
   shipped in the client bundle. Tomorrow's world is computable today by anyone.
2. `grant insert (user_id, mode, score, verdict, metrics) on public.results` lets an
   authenticated player write any `metrics` blob they like. `verdict` is CHECK-constrained;
   `metrics` is not.
3. A challenge run is dealt **unbiased** — `hooks/useRun.ts` sets
   `solo = matchCode == null && !daily && !challenge`, so `weakSpots` is `undefined` for a
   challenge, exactly as it is for a daily.

So: post a self-made row carrying `{seed: dailySeed('2026-09-07'), backgroundId:
dailyBackgroundId('2026-09-07'), shared: 0}` and no `daily` key, open `/?vs=<that row id>`,
and you are playing tomorrow's daily puzzle — bit-identical draws, unbiased deal — as many
times as you like before filing the real attempt. The gate at `lib/challenge.ts:95` only
refuses rows that *admit* to being dailies.

**Fix.** The seed derivation is the leak, and the honest fix is to stop the world being
predictable ahead of time. Either:

- **(a)** Refuse the challenge at the point that can actually tell: in
  `challengeableWorld`, reject any row whose `(seed, backgroundId)` pair matches
  `dailyFor(d)` for any `d` within, say, ±14 days of today. Cheap, no migration, closes the
  practical case:

  ```ts
  // lib/challenge.ts, after the backgroundId check
  for (let i = -14; i <= 14; i++) {
    const p = dailyFor(todayUTC(new Date(Date.now() + i * 86_400_000)));
    if (p && p.seed === Math.floor(seed) && p.backgroundId === backgroundId) return null;
  }
  ```

- **(b)** Derive the daily seed from a value the client cannot know in advance (a
  server-published per-day salt), which closes it completely at the cost of a network read
  the daily currently does not need.

(a) is the proportionate fix. Whichever is taken, the comment at `lib/challenge.ts:70-84`
should be amended to state what is actually guaranteed — the current wording claims a
property the code does not have.

---

## 5. Medium · `/r/[id]` accepts any id shape and queries the database twice per request

**Where:** `app/r/[id]/page.tsx:169-192`. Compare `app/api/og/[id]/route.tsx:28,47`.

Two distinct problems on the app's most-scraped page:

**No id validation.** The OG route guards `UUID_RE.test(id)` *before* fetching, with a
documented rationale about unknown ids being an abusable path. The page route does not:
`getResult(id)` (`lib/cloud/results.ts:412`) goes straight to PostgREST with whatever is in
the URL. A non-uuid raises a Postgres `22P02`, which `getResult` swallows (`const { data } =
...`), so the page 404s correctly — but only after a round trip. And because the route is ISR
(`revalidate = 3600` with an empty `generateStaticParams`), a stream of random ids mints an
unbounded set of cache entries. This is the same amplification the OG route routes around
with its 302-to-one-URL trick; the page inherited none of it.

**Two reads per render.** `generateMetadata` calls `getResult(id)`, then the page component
calls `getResult(id)` again. Next's fetch memoization *may* collapse them, but that depends
on supabase-js emitting byte-identical GET options — not something to rely on for the
project's hottest read.

**Fix.** Both are one small edit:

```tsx
import { cache } from "react";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const loadRow = cache(async (id: string) => {
  if (!UUID_RE.test(id)) return null;      // never reaches the database
  return getResult(id).catch(() => null);
});
```

then call `loadRow(id)` from both `generateMetadata` and the page. `cache()` makes the dedupe
explicit rather than incidental, and the regex makes a junk id free. Keep the OG route's own
copy of `UUID_RE` — or lift the one definition into `lib/deepLink.ts` beside `RESULT_ID_RE`,
which already has the "one owner for the rules" argument written on it.

---

## 6. Medium · No index supports the `distinct on` that `top_results` runs

**Where:** `supabase/schema.sql:229-230`; query at
`supabase/migrations/2026-09-02_10_top_results.sql:76-84`.

The only index on the hot path is `results_mode_score_idx (mode, score desc)`. The board's
query is:

```sql
select distinct on (r.user_id) r.*
  from public.results r
 where r.mode = p_mode and r.score > -1e15 and r.score < 1e15 ...
 order by r.user_id, r.score desc, r.id asc
```

`distinct on (user_id)` requires the rows ordered by `user_id` first, which the existing
index cannot provide — so every leaderboard load is a full scan of that mode's rows plus a
sort, and the outer `limit` cannot be pushed down. With the 500-rows-per-player cap this
grows linearly in the player base, and it grows on the page a cold visitor waits on.

**Fix.**

```sql
create index if not exists results_mode_user_score_idx
  on public.results (mode, user_id, score desc, id);
```

That matches the `distinct on` ordering exactly and lets Postgres skip-scan one row per
player. Worth adding at the same time, since the board already filters on them and the README
notes them as optional:

```sql
create index if not exists results_daily_idx
  on public.results (mode, (metrics->>'daily'), score desc);
create index if not exists results_background_idx
  on public.results (mode, (metrics->>'backgroundId'), score desc);
```

---

## 7. Low · Two moderate advisories in the dependency tree

`npm audit`: 2 moderate, 0 high, 0 critical.

| Package | Version | Advisory | Path | Reachable? |
| --- | --- | --- | --- | --- |
| `fflate` | 0.6.10 | [GHSA-px8p-9vwx-vf98](https://github.com/advisories/GHSA-px8p-9vwx-vf98) — infinite loop on malformed ZIP64 | `@react-three/rapier@2.2.0 → three-stdlib@2.36.1 → fflate` | **Production**, but only if a loader parses an untrusted archive. This app loads no user-supplied 3D assets, so it is not currently reachable. |
| `qs` | 6.15.3 | GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g — DoS / array-limit bypass | `shadcn@4.12.0 → @modelcontextprotocol/sdk → express` | **devDependency only.** Never in a deployed bundle. |

Neither is exploitable in this deployment today. Both are `fixAvailable: true`.

**Fix.** `npm audit fix`, then re-run `npm run typecheck && npm run lint && npm run qa:engine`.
If `@react-three/rapier` pins the old `three-stdlib`, an `overrides` entry alongside the
existing `postcss` one is the smaller change:

```json
"overrides": { "postcss": "$postcss", "fflate": "^0.8.2" }
```

Separately, `next` is at 15.5.24 with 15.5.25 available — worth taking on the same pass.

---

## 8. Low · `saveRun` / `loadRun` still throw raw PostgREST error text

**Where:** `lib/saves.ts:65` and `lib/saves.ts:99`.

```ts
if (error) throw new Error(error.message);
```

Every other write path in this codebase deliberately stopped doing this, each with the
reasoning written out: `submitResult` (`lib/cloud/results.ts:228`), `updateUsername`
(`lib/cloud/profiles.ts:203`), and the Edge Function's `ensure` handler
(`supabase/functions/profile/index.ts:190`) all log the Postgres string and throw the app's
own sentence. `lib/saves.ts` is the one file left on the old footing.

It is Low rather than Medium because nothing renders the message today — `AuthGate` catches
into a `loadFailed` boolean (`components/screens/AuthGate.tsx:196-200`) and `useRun.persist`
into a `saveFailed` flag (`hooks/useRun.ts:171-176`). But the value is thrown as a
user-facing `Error`, so the next caller that prints one publishes column names, relation
names and RLS text to a player.

**Fix.** Match the established pattern:

```ts
if (error) {
  console.error("saveRun: cloud write failed", error);
  throw new Error("Could not save your run. Try again in a moment.");
}
```

and the same for `loadRun`.

---

## Deliberately not reported

Things that look like findings and are not:

- **No `script-src` in the CSP.** Documented at length in `next.config.ts:3-56` as a costed
  decision with stated reopen conditions, and the premises still hold: no
  `dangerouslySetInnerHTML` anywhere in the tree, no third-party script in the document, and
  the only player-authored string reaching another player's screen (the username) is
  charset-locked in three places.
- **No anti-cheat in multiplayer.** `docs/MULTIPLAYER.md:377-381` states the trust model
  explicitly ("the room code is the secret"; "no server and no authority"). The wire parser
  is nonetheless strict, and the `status` / `snapshot` handlers in `hooks/useMatch.tsx`
  fence on roster membership *and* session ownership, so the cheap spoofs are already closed.
- **Client-computed scores.** `results.score` is written by the browser. This is bounded
  (`results_score_sane`), replay-checked on-device (`verified`), and the page that shows the
  flag says plainly it "is not a proof against a determined forger"
  (`app/r/[id]/page.tsx:289-293`). Honest, and correctly scoped.
- **`streaks` public read.** Deliberate so friends can see each other's streaks, and bounded
  by `streaks_sane`.
