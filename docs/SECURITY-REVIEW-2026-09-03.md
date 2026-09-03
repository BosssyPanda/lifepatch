# Codebase review — 2026-09-03

Scope: the whole tree — app routes, `lib/`, `hooks/`, `components/`, `src/`,
`supabase/` (schema, migrations, Edge Functions), `scripts/`, build config and
dependencies. Looking for security defects, functional bugs, and performance
problems.

## Summary

**No critical security vulnerability was found.** The obvious classes are closed
and were closed deliberately: no `dangerouslySetInnerHTML` or `innerHTML`
anywhere in the tree, no `eval`/`new Function`, no hardcoded secrets (`.env*.local`
is gitignored and `.env.local.example` carries only variable names), every
client-written column is bounded by a CHECK, RLS is column-granular rather than
row-granular-only, the one query built by string concatenation
(`lib/cloud/friends.ts` `.or(...)`) is fenced behind a UUID test, and every
inbound multiplayer byte is rebuilt field by field in `lib/mp/protocol.ts` rather
than passed through.

Verification run for this review:

| Gate | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run qa:engine` | 34/34 |
| `npm run qa:rls` | 16 probes closed, 24 behaviours intact |
| `npm run qa:username` | 1728 generated + 22 innocent accepted, 24 refused |
| `npm run qa:rename` | 16/16 |
| `npm run qa:cloud` | 16/16 |
| `npm run qa:challenge` | 10/10 |
| `npm run qa:metrics` | 19/19 |
| `npm audit` | 1 moderate, dev-only transitive (see #4) |

(`npm run qa:audio` and the other Playwright gates need a running dev server and
were not exercised.)

Seven findings follow, most severe first. One is a security gap whose own
deferral condition has since been met; one is a confirmed functional bug; the
rest are robustness, cost and hygiene.

---

## 1. Friend-code lookup is an unrated guessing oracle, and the condition its own comment deferred on has been met

**Category:** Security · **Severity:** Medium
**Where:** `supabase/schema.sql` (`public.profile_by_friend_code`);
`supabase/migrations/2026-08-27_01_security_additive.sql:49-69`;
caller `lib/cloud/profiles.ts:232` → `lib/cloud/friends.ts:93` (`addByCode`)

### The risk

The function is a clean point query — one row in, at most one row out, no
`friend_code` in the projection, so a result cannot seed the next lookup. That
design closes *enumeration by walking*. It does not close *enumeration by
guessing*, and nothing else does either: any signed-in account can call the RPC
through PostgREST as fast as it likes.

The migration that created it says so in its own `comment on function`:

> Codes are 6 chars over a 31-glyph alphabet (~887M); consider a Supabase rate
> limit **if the friends UI ever ships**.

The friends UI has shipped. `FriendsSheet` is mounted from both
`components/AppShell.tsx:589` and `components/social/LeaderboardPage.tsx:80`,
`addByCode` is wired to its button, and `lib/deepLink.ts` accepts `?friend=CODE`
from a link. The precondition is met and the limit was never added.

Worth being precise about the magnitude, because it is the reason this is Medium
and not High: the keyspace is ~887M, so *full* enumeration is not the practical
threat. The practical threat is that a hit on **any** code costs roughly
`887M / (number of players)` guesses, which shrinks as the game grows, and that
the endpoint offers no resistance at all — the codebase already treats exactly
this shape as worth bounding one file away, in `spendRenameAttempt`, for a
weaker oracle (rename 409-vs-400).

### Fix

The mechanism already exists. Mirror `spend_rename_attempt`
(`supabase/migrations/2026-09-02_09_rename_limit_atomic.sql`) — durable, in the
database rather than in a stateless isolate, spent in one UPDATE so concurrent
callers serialise:

```sql
-- migration: bound friend-code guesses per caller.
alter table public.profiles
  add column if not exists code_window_start timestamptz,
  add column if not exists code_attempts int not null default 0;

create or replace function public.lookup_friend_code(code text)
returns table (id uuid, username text, avatar_seed text)
language plpgsql security definer stable
set search_path = public
as $$
declare
  limit_n  constant int := 20;
  window_i constant interval := interval '1 hour';
  allowed boolean;
begin
  update public.profiles p
     set code_window_start =
           case when p.code_window_start is null
                     or p.code_window_start < now() - window_i
                then now() else p.code_window_start end,
         code_attempts =
           case when p.code_window_start is null
                     or p.code_window_start < now() - window_i
                then 1 else p.code_attempts + 1 end
   where p.id = auth.uid()
     and (p.code_window_start is null
          or p.code_window_start < now() - window_i
          or p.code_attempts < limit_n)
  returning true into allowed;

  if not found then
    raise exception 'rate limited' using errcode = '53400';
  end if;

  return query
    select p.id, p.username, p.avatar_seed
      from public.profiles p
     where p.friend_code = upper(trim(code))
     limit 1;
end;
$$;

revoke all on function public.lookup_friend_code(text) from public, anon;
grant execute on function public.lookup_friend_code(text) to authenticated;
```

Then point `getByFriendCode` at it and give `addByCode` a
`reason: "rate-limited"` so the sheet can say "too many tries — wait a few
minutes" rather than the current undifferentiated `"failed"`. Add a
`scripts/qa/` gate alongside `rename-limit.mjs`, which already proves this exact
pattern including the concurrent-bypass control.

A per-project Supabase rate limit on the endpoint is a legitimate cheaper
alternative, but it lives outside the repo and nothing in the tree would show it
had lapsed.

---

## 2. The local result store's quota-recovery retry is a no-op for a realistic list

**Category:** Functional Bug · **Severity:** Low–Medium (confirmed by execution)
**Where:** `lib/cloud/results.ts:165-176` (`writeLocal`), calling `capLocal` at
`lib/cloud/results.ts:130-146`

### The risk

`writeLocal` exists to stop a full origin quota silently discarding a finished
run. Its comment states the contract:

> The list is newest-first, so halving it drops the oldest history and keeps the
> run that was being written.

It does not halve the list. `capLocal`'s `cap` is **per `(userId, mode)` group**,
and the retry passes `Math.ceil(rows.length / 2)` — half the *total* row count.
With the list spread over more than one mode, no group individually exceeds that
figure, so nothing is filtered and the retry writes byte-for-byte what just
threw. It throws again, the inner `catch {}` swallows it, and the finished run in
`rows[0]` is discarded exactly as it was before the retry was added.

Verified directly against the real `capLocal` body, with a realistic local list
(one device player, three modes, 100 runs each):

```
rows before retry : 300
rows after  retry : 300
shrank?           : false
single-mode       : 51 of 100
```

The single-mode row is why this reads as correct on inspection: the function does
halve a list that happens to sit in one group, which is the case the comment was
reasoned about. Every real list has story, infinite and cashflow in it.

### Fix

Halve the list, since that is what the comment promises and what the newest-first
ordering makes correct:

```ts
function writeLocal(rows: ResultRow[]): void {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(rows));
  } catch {
    try {
      // Halve the LIST, not the per-group cap. `capLocal`'s cap is per
      // (player, mode), so handing it half the TOTAL row count leaves a list
      // spread over three modes completely untouched — the retry then writes
      // exactly what just failed. The list is newest-first, so slicing the
      // head keeps the run being written and drops the oldest history.
      localStorage.setItem(LIST_KEY, JSON.stringify(rows.slice(0, Math.ceil(rows.length / 2))));
    } catch {}
  }
}
```

Worth a `scripts/qa/` assertion that the retry argument strictly shrinks a
multi-mode list — the defect is invisible to types and to every single-mode test.

---

## 3. `/opengraph-image` has no fallback for the font read that its sibling route documents as fallible

**Category:** Functional Bug / availability · **Severity:** Low
**Where:** `app/opengraph-image.tsx:33` — `const [anton, mono] = await loadFonts();`

### The risk

`app/api/og/[id]/route.tsx` treats a failed font read as a real event and handles
it in two places at once: `loadFonts().catch(() => null)` so a font fault cannot
discard an already-successful row lookup, and a `!anton || !plex` branch that
redirects rather than 500s, under a comment explaining that an unfurl must never
error. `app/opengraph-image.tsx` calls the same helper on the same bundled assets
with no catch at all, so the same fault throws the route.

That matters more than it looks, because of how the two routes are wired:
`/api/og/[id]` deliberately **sheds** traffic onto `/opengraph-image` — both the
missing-font branch and the unknown-id branch 302 there, the latter specifically
so a stream of random UUIDs renders once at the edge instead of once per id. So
`/opengraph-image` is the busiest and most abusable card in the app, and it is the
one with no fallback. If it throws, unknown-id unfurls become redirects to a 500.

`cachedFonts` memoises on success only (`app/api/og/_fonts/cache.ts`), so a
transient failure is not pinned for the isolate's life — this is a hiccup, not an
outage. But "rare" is the whole case the sibling route's fallback exists for.

### Fix

There is no third card to fall back to here, so the honest answer is to fail
without a stack trace and without caching the fault:

```ts
export default async function OgImage() {
  const ttf = await loadFonts().catch(() => null);
  // Without a typeface there is no card to draw. 404 rather than 500: a scraper
  // retries the former and gives up on the latter, and no cache-control, because
  // this is a fault and not a fact about this URL.
  if (!ttf) return new Response(null, { status: 404 });
  const [anton, mono] = ttf;
  ...
}
```

---

## 4. `qs` — two moderate advisories, reachable only from a dev CLI

**Category:** Dependency hygiene · **Severity:** Low
**Where:** `package.json` devDependencies → `shadcn@4.12.0` →
`@modelcontextprotocol/sdk@1.29.0` → `express@5.2.1` → `qs@6.15.3`

`npm audit` reports GHSA-x5fp-wj9c-mxmx (array-limit bypass, CVSS 3.7) and
GHSA-4mjr-xmp4-gh2g (DoS via attacker-controlled `isBuffer`, CVSS 5.3). Both are
moderate and both are unreachable from anything this project ships: `shadcn` is a
component-scaffolding CLI, the chain is dev-only, and no `express` server runs in
production. Nothing here is exposed to a player.

`npm audit fix` resolves it cleanly (the dry run confirms a fix is available and
in-range). Worth taking on general hygiene grounds so the audit output stays at
zero and a genuinely reachable advisory is not lost in the noise.

The production dependency tree is otherwise clean and current: Next 15.5.24,
React 19, `@supabase/supabase-js` 2.108.2.

---

## 5. `profiles_public` is fully walkable by `anon`

**Category:** Security / privacy · **Severity:** Low (informational)
**Where:** `supabase/schema.sql` — `grant select on public.profiles_public to anon, authenticated;`

The view is correctly built: `security_invoker = off` so leaderboards work,
`friend_code` deliberately absent, and `revoke all` before the `grant` so it
cannot inherit Supabase's stock table privileges (migration 08 exists for exactly
that). The remaining property is that the grant is unfiltered — anyone holding
the publishable key can page the whole view and export the complete player roster
(`id`, `username`, `avatar_seed`, `created_at`). The same is true of
`results`, whose `for select using (true)` policy exposes `user_id` on every row,
so the two join into a full id-to-username map.

This is pseudonymous by construction — no email, no real name, no free text, and
the charset CHECK plus the word list keep the usernames themselves in hand — so
the impact is genuinely low and the design intent is clear. It is listed because
the schema takes considerable care over `friend_code` enumerability, and the
roster itself is enumerable next to it; that asymmetry is worth being a decision
rather than a side effect.

If it is ever worth closing: the readers only ever resolve ids they already hold
(`getProfiles(top.map(r => r.userId))`), so the grant could be replaced with a
set-returning `profiles_by_ids(uuid[])` capped at, say, 100 ids. Note the real
cost first — guests are `anon`, and `topResults` reads the cloud for them, so
revoking the grant without that replacement blanks every guest's leaderboard.

---

## 6. Two write paths still throw the raw PostgREST message, against the rule the rest of the tree keeps

**Category:** Code quality · **Severity:** Low (latent — not currently rendered)
**Where:** `lib/saves.ts:66` and `lib/saves.ts:101`; `lib/cloud/streaks.ts:~100`
and `~150` — all four `throw new Error(error.message)`

The codebase states a house rule and keeps it in four places: `submitResult`
("Ours, not Postgres's"), `updateUsername`, and both handlers in
`supabase/functions/profile/index.ts`, where publishing `existing.error.message`
is called out as the one response in the directory that leaked column names,
relation names and constraint text to the player. `saves.ts` and `streaks.ts`
still rethrow the verbatim string.

Traced through, nothing renders it today: `useRun` turns the save failure into a
boolean `saveFailed` that `YearHud` prints as "Not saved", and `AuthGate`'s
`loadRunChecked` rejection sets `loadFailed` without reading the message. So this
is a latent inconsistency rather than a live disclosure — but it is one
`{err.message}` away from being live, and it is exactly the shape the Edge
Function comment describes having already been caught once.

### Fix

Log the detail, return the app's own voice:

```ts
if (error) {
  console.error("saveRun: upsert failed", error);
  throw new Error("Could not save your run. Try again in a moment.");
}
```

---

## 7. Smaller notes

**`markSubmitted` eviction is not reversible.** `lib/cloud/results.ts:428-435`
writes `[...set].slice(-SUBMITTED_CAP)`, so adding the 501st key silently evicts
the oldest; `unmarkSubmitted` on a failed post removes only the key it was given
and cannot restore the evicted one. A player would have to finish 500 further
runs before the gap could let an old run re-post, by which time its report is long
gone — consistent with the cap's own reasoning, and noted only because the
rollback is documented as complete and is not quite.

**Confirm migration 10 is applied in production.** `topResults`
(`lib/cloud/results.ts:246-320`) tries the `top_results` RPC and, on any error,
falls through to a client-side dedupe that walks up to **six sequential** pages of
`limit * 5` rows. The fallback is deliberate, bounded and correct, and the RPC is
documented as optional so no deploy ordering is required — but the failure is
silent, so a project that never applied migration 10 pays up to six serialised
round trips on every leaderboard view without anything saying so. Worth a
one-time check against the live project, and worth considering a
`console.warn` on the fallback path so the cost is visible.

**CSP has no `script-src`.** `next.config.ts` documents this at length and the
reasoning holds on today's premises — no user-supplied markup anywhere, the only
player-authored string reaching another screen is the username, and it is
charset-locked in three places. `connect-src` is present and correctly falls back
to `'self'` (rather than being omitted) when the Supabase env var is missing.
Flagged here only to keep the file's own reopen conditions visible: the day the
app renders user markup, adds a third-party script tag, or ships a free-text
field, this stops being defence-in-depth and becomes the door.

**Vercel preview deploys cannot rename or sign up.** `ALLOWED_ORIGINS` in
`supabase/functions/profile/index.ts` is a fixed list by design (a wildcard would
give back the `*` it replaced), so per-branch preview hosts get a CORS refusal.
Documented in the file; restated here because it is an operational footgun rather
than a defect.
