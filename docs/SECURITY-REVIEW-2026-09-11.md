# LifePatch — Codebase Review (2026-09-11)

Scope: whole repository at `claude/eager-cori-rwelcj` — app routes, `lib/`, `hooks/`,
`components/`, `src/audio/`, `supabase/` (schema, migrations, Edge Functions), build
config and dependencies.

## Headline

**No critical vulnerability was found.** The usual suspects are genuinely closed:
no hardcoded secrets, no `dangerouslySetInnerHTML` / `eval` / `innerHTML` anywhere
in the tree, parameterised SQL throughout, RLS on every table with column-level
`GRANT`s backing the policies, a single shared username filter enforced
server-side, a CSPRNG behind every capability token, and security headers set in
`next.config.ts`. Several classes of bug this review would normally report are
already documented as fixed in the source comments.

What follows is what is still open, ranked. Most of it is integrity and
correctness rather than exploitability; three items are genuine defects with
concrete failure cases.

| # | Finding | Bucket | Severity |
|---|---------|--------|----------|
| 1 | `metrics.verified` is client-written and renders as a leaderboard badge | Security (integrity) | Medium |
| 2 | Multiplayer rooms have no server-side authorization | Security (design) | Medium |
| 3 | Daily Ledger world is precomputable before the day opens | Security (integrity) | Medium |
| 4 | Friend-code lookup has no rate limit | Security | Low |
| 5 | Two moderate transitive dependency advisories | Security | Low |
| 6 | `writeLocal` quota recovery does not shrink a multi-group list | Functional Bug | Medium |
| 7 | Stock shocks collide across ticks — tickers move in lockstep with a lag | Functional Bug | Medium |
| 8 | `drawEvents` shared branch spins 400 iterations when the deck is short | Performance | Low |
| 9 | Audio boot failure can leak a partially built Tone graph | Performance | Low |
| 10 | Unvalidated shapes read back from `localStorage` (dev auth, journal acts) | Code Quality | Low |

---

## 1. `metrics.verified` is client-written but renders as a verification badge

**Files:** `lib/cloud/buildResult.ts:59` · `components/social/Leaderboard.tsx:352,411` ·
`supabase/schema.sql` (`results.metrics`)

**Bucket:** Critical Security Vulnerability → *downgraded to Medium*, see the note below.

`results.metrics` is unconstrained `jsonb` apart from a size cap and a
`history`-length bound. `verified: 1` is written by the client after a local
replay check:

```ts
...(ticket && verifyResult(ticket, nw) ? { verified: 1 } : {}),
```

and the public leaderboard renders a mark from it:

```tsx
{r.metrics.verified === 1 && (<span aria-hidden …>{VERIFIED_MARK}</span>…)}
```

Because `grant insert (user_id, mode, score, verdict, metrics)` lets an
authenticated caller name the whole `metrics` object, anyone posting straight at
PostgREST can attach `{"verified": 1}` to a row with a fabricated score and wear
the badge on a public board. The same is true of `seed`, `backgroundId`,
`engine`, `coached` and `shared`.

**Why Medium and not Critical:** the project already discloses this. The legend
under the board reads *"It is a self-check, not a proof"*, and
`app/r/[id]/page.tsx` says the check *"catches a corrupted or half-recorded run,
not a determined forger."* The score itself is client-authoritative by design and
bounded by `results_score_sane`. So this is an accepted posture, not an oversight —
but the badge is the one surface whose visual language asserts more than the
disclaimer walks back.

**Recommendation** — pick one:

* *Cheapest, no migration:* stop reading `verified` from `metrics` on the board.
  Keep it on `/r/{id}` where the disclaimer sits next to it.
* *Structural:* move the flag out of player-writable space. Add a generated
  column or a trigger that strips unknown `metrics` keys on insert:

```sql
create or replace function public.results_strip_metrics()
returns trigger language plpgsql as $$
begin
  -- the flag is not the client's to write
  new.metrics := new.metrics - 'verified';
  return new;
end;
$$;

create trigger results_strip_metrics
  before insert on public.results
  for each row execute function public.results_strip_metrics();
```

  and set it from a server-side replay if the badge is worth keeping at all.

---

## 2. Multiplayer rooms have no server-side authorization

**Files:** `lib/mp/transport.ts` · `lib/mp/protocol.ts` · no Realtime policy in
`supabase/migrations/`

No migration configures Supabase Realtime authorization (`realtime.messages` RLS
or channel policies). A room's channel topic is `lp-match-v{N}-{roomCode}`, so the
six-character room code is the only thing gating a room. Any holder of the
publishable key who learns or guesses a code can join, broadcast, and appear in
presence.

The client-side defence is genuinely good — `parseMessage` rebuilds every field,
`adoptConfig` requires host or roster membership, `tick` is bounded by the highest
year a roster member demonstrably reached, and `status` messages for other players
are refused. The code says so plainly: *"Airtight needs a server authority, which
is out of scope by contract."*

The residual risk is bounded but real: a stranger inside a room can still flood
presence, occupy roster slots in a lobby before it starts, and force the acting
host into repeated ghost-play bookkeeping. The code space (31⁶ ≈ 887M) makes blind
guessing impractical; a leaked screenshot of a lobby code does not.

**Recommendation:** add a Realtime authorization policy keyed on a room
membership table, or — much cheaper — accept the posture and document it in
`docs/MULTIPLAYER.md` as an explicit trust boundary so the next reader does not
have to reconstruct it from comments in `useMatch.tsx`.

---

## 3. The Daily Ledger's world is precomputable arbitrarily far in advance

**File:** `lib/daily.ts:85` (`dailySeed`), `dailyBackgroundId`

```ts
export function dailySeed(date: string): number {
  return Math.floor(mulberry32(strHash(`lifepatch.daily.${date}`))() * SEED_SPACE);
}
```

The seed, the background and the mode are pure functions of a date string, all
shipped in the client bundle. Anyone can compute *next month's* puzzle, run the
engine offline to find the optimal line, and play it back on the day for a top
daily-board placement. `challengeableWorld` correctly refuses to hand a daily row
over as a practice world (`lib/challenge.ts`), which closes the in-app rehearsal
path — but not the offline one, because the derivation needs no row at all.

This is inherent to a fully client-side deterministic daily and may be an accepted
trade. If the daily board is meant to be competitive:

**Recommendation:** derive the seed from a value not present in the bundle — e.g.
publish `dailySeed` from a tiny edge route that refuses future dates:

```ts
// app/api/daily/[date]/route.ts
if (date > todayUTC()) return new Response(null, { status: 404 });
return Response.json({ seed: hmac(process.env.DAILY_SECRET!, date) });
```

Note this only raises the cost — it does not make the board honest on its own,
because scores remain client-posted (see finding 1).

---

## 4. Friend-code lookup has no rate limit

**File:** `supabase/schema.sql:167-182`

```sql
create or replace function public.profile_by_friend_code(code text)
returns table (id uuid, username text, avatar_seed text) …
```

Granted to `authenticated`, correctly parameterised, correctly a point query
returning at most one row and never the code itself — so it cannot be walked with
offsets or used to seed the next lookup. But nothing bounds how many times one
account may call it.

The code space is 31⁶ ≈ 887M, so exhaustive enumeration is impractical (~100 days
at 100 req/s). The exposure is real but small, and materially smaller than before
migration 03 rotated the codes. Worth noting mainly because the *rename* path got
a carefully built limiter (`_shared/renameLimit.ts`) for the same class of
problem, and this one did not.

**Recommendation:** reuse the `spend_rename_attempt` pattern — a per-caller
counter in `profiles`, spent inside the function:

```sql
-- inside profile_by_friend_code, before the select
perform public.spend_lookup_attempt(auth.uid());
```

Or leave it and record the decision; the entropy is doing most of the work.

---

## 5. Two moderate transitive dependency advisories

**File:** `package-lock.json`

`npm audit` reports 2 moderate, 0 high, 0 critical:

| Package | Advisory | Path |
|---|---|---|
| `fflate` 0.6.0–0.6.10 | GHSA-px8p-9vwx-vf98 — infinite loop on malformed ZIP64 | transitive |
| `qs` 2.2.5–6.15.3 | GHSA-4mjr-xmp4-gh2g, GHSA-x5fp-wj9c-mxmx — DoS | transitive |

Neither is reachable from a request path in this app (no ZIP parsing, no
server-side query-string parsing outside Next's own). `next` is pinned at
`^15.5.24` with no advisory against it; `16.x` is available but is a major bump.

**Recommendation:** `npm audit fix` — both have fixes available and neither is a
direct dependency, so the lockfile change is contained.

---

## 6. `writeLocal` quota recovery silently fails when rows span several groups

**File:** `lib/cloud/results.ts:167-175`

**Bucket:** Functional Bug

```ts
function writeLocal(rows: ResultRow[]): void {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(rows));
  } catch {
    try {
      localStorage.setItem(LIST_KEY, JSON.stringify(capLocal(rows, Math.ceil(rows.length / 2))));
    } catch {}
  }
}
```

`capLocal`'s `cap` is **per `(userId, mode)` group**, but the retry passes half the
**total** row count. When rows are spread across groups, no group reaches the cap
and `capLocal` returns the list unchanged — so the retry re-writes the identical
payload and fails for exactly the same reason.

**Failure case:** 100 local rows across 4 `(user, mode)` groups of 25. Quota is
full. `cap = 50`; every group is under it; nothing is dropped; the second
`setItem` throws too. The finished run in `rows[0]` is discarded with no
leaderboard row, no share link, and nothing on screen saying so — which is the
precise outcome the comment above this function says it exists to prevent.

**Fix** — halve the list itself, then let `capLocal` do its per-group job:

```ts
function writeLocal(rows: ResultRow[]): void {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(rows));
  } catch {
    // Newest-first, so slicing the tail drops the oldest history and keeps the
    // run being written. `capLocal` is per-group and cannot shrink a list that is
    // already under cap in every group — the halving has to happen here.
    const half = rows.slice(0, Math.max(1, Math.ceil(rows.length / 2)));
    try {
      localStorage.setItem(LIST_KEY, JSON.stringify(half));
    } catch {}
  }
}
```

---

## 7. Stock shocks collide across ticks — tickers move in lockstep with a lag

**File:** `lib/cashflow/engine.ts:320-337`

**Bucket:** Functional Bug

```ts
STOCK_CATALOG.forEach((d, i) => {
  const shock = (rngAt(s.seed, s.rngCursor + 101 + i) - 0.5) * 0.14 * Math.min(volatility, 4);
  …
});
return { ...s, stockPrices: prices, rngCursor: s.rngCursor + 1 };
```

The draw is addressed by `cursor + 101 + i`, and the cursor advances by small
amounts between market ticks. So ticker `i` at cursor `c` and ticker `i + Δ` at
cursor `c − Δ` read the *same* random value. Verified empirically:

```
stock0 @ cursor 10 → 0.15136004984378815
stock2 @ cursor  8 → 0.15136004984378815   // identical
```

The consequence is that the catalogue does not contain independent tickers — each
one replays its neighbour's shock history at a lag set by how much the cursor
moved between ticks. A player who notices GRID's move predicts PLSE's next one.
That undercuts the same lesson `BAND_PULL` was introduced to protect: that a quote
is a bet, not an arbitrage.

`saleOffer` has the same shape (`cursor + 211 + uidNoise(uid)`, `uidNoise ∈ 0..96`,
so offsets 211–307) and is safe from `tickStockPrices` only because the catalogue
is shorter than 110 entries — an implicit constraint nothing enforces.

**Fix** — give each ticker its own stream rather than an offset into a shared one:

```ts
import { strHash } from "../rng";

const shock =
  (rngAt(s.seed + strHash(d.symbol), s.rngCursor) - 0.5) * 0.14 * Math.min(volatility, 4);
```

The symbol salt decorrelates the tickers from each other while keeping the draw a
pure function of `(seed, cursor)`, so replays stay exact. **Note this changes
every existing Rat Race replay** — it needs a `STATE_VERSION` bump alongside it,
the same way `RUN_VERSION` 6→7 was handled.

---

## 8. `drawEvents` shared branch spins 400 iterations when the deck is short

**File:** `lib/runEngine.ts:392-397`

**Bucket:** Code Quality / Performance

```ts
for (let i = 0; i < 400 && picks.length < want; i++) {
  const id = weighted[Math.floor(rng() * weighted.length)];
  if (!picks.includes(id) && canFace.has(id)) picks.push(id);
}
```

The solo branch directly above got this fixed — it clamps to
`target = Math.min(want, mine.length)` with a documented note about the 59 wasted
draws. The shared branch did not: when `want === 2` and the life can face only one
card, the loop runs all 400 iterations, each doing an `Array.includes` over the
weighted pool. This runs once per player per year on every client in a room, and
on the acting host it runs again for every ghost-played absent player.

**Fix** — mirror the solo branch's clamp:

```ts
const target = Math.min(want, canFace.size);
for (let i = 0; i < 400 && picks.length < target; i++) { … }
```

`canFace` is already built from `mine`, so this is free and cannot change the draw
in the common case (`canFace.size >= want`) — which keeps recorded runs valid.

---

## 9. Audio boot failure can leak a partially built Tone graph

**File:** `hooks/useAudio.tsx:152-160`

**Bucket:** Code Quality / Performance

```ts
.catch(() => {
  if (engineRef.current && !engineRef.current.isStarted) engineRef.current = null;
})
```

The success-but-superseded path correctly calls `void e.dispose()`. The failure
path only drops the reference. `AudioEngine.start()` awaits `Tone.start()` and
then builds ~40 Tone nodes (`src/audio/AudioEngine.ts:189-370`); a rejection
*after* `Tone.start()` resolves — a node constructor throwing, a sample decode
failing — leaves those nodes connected to the destination with nothing holding a
handle to them. The next gesture boots a second engine on top.

Narrow (the common rejection is `Tone.start()` itself, before any node exists),
but the fix is one line:

```ts
.catch(() => {
  const e = engineRef.current;
  if (e && !e.isStarted) {
    engineRef.current = null;
    void e.dispose();   // the half-built graph is still connected to destination
  }
})
```

---

## 10. Unvalidated shapes read back from `localStorage`

**Bucket:** Code Quality

Most storage readers in this codebase are exemplary — `lib/challenge.ts`,
`lib/metrics.ts` and `lib/mp/protocol.ts` all shape-guard field by field with
comments explaining what a malformed value would do downstream. Two readers do
not:

* **`hooks/useAuth.tsx:108`** — `if (raw) setUser(JSON.parse(raw))` on the dev
  fallback path. A corrupted `lifepatch.devUser` yields a user with
  `id: undefined`, which flows into `resolvePlayerId` and the save keys. Dev-path
  only (`cloudMisconfigured` blocks it in production), so impact is low.

  ```ts
  const u = raw ? JSON.parse(raw) : null;
  setUser(u && typeof u.id === "string" && u.id ? u : storedGuest());
  ```

* **`lib/replay.ts:154`** — `trade(s, act[1], act[2])` replays journal acts with no
  numeric guard. A tampered journal carrying `["t", "index", "abc"]` produces
  `NaN` holdings and a `NaN` net worth. Self-inflicted only (the journal never
  crosses the wire — `parseRunState` drops it), and the damage is contained
  because `verifyResult`'s `NaN === nw` is false so no `verified` flag is written.
  Still worth a guard, since `hasFullJournal` validates `y` and nothing else:

  ```ts
  } else if (act[0] === "t") {
    if (opts.allocate) continue;
    if (!Number.isFinite(act[2])) return null;   // a journal we cannot replay is not a journal
    s = trade(s, act[1], act[2]);
  }
  ```

---

## What was checked and found sound

Recorded so the next review does not re-derive it:

* **Secrets** — no hardcoded keys, tokens or service-role credentials anywhere in
  the tree. `.gitignore` covers `.env*.local`. `.env.local.example` explicitly
  warns against pasting a `sb_secret_*` key into a `NEXT_PUBLIC_*` var.
* **Injection** — no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new
  Function` or `document.write`. All SQL is parameterised; every `SECURITY
  DEFINER` function sets `search_path = public`.
* **RLS** — every table has RLS enabled with policies *and* matching column-level
  `GRANT`s. The schema comments correctly identify that "which row" is a policy
  question and "which column" is a grant question, and that a column-level
  `REVOKE` cannot carve an exception out of a table grant.
* **`profiles` lockdown** — `friend_code` is not on `profiles_public`, the view is
  `security_invoker = off` with `revoke all` before the `grant select` (so it
  cannot inherit auto-updatable write access), and the Edge Function is the only
  writer.
* **Username screening** — one shared implementation (`_shared/username.ts`) run
  by both browser and server, with a charset `CHECK` mirroring `USERNAME_RE` at
  the database. Allow-list handles the Scunthorpe class correctly.
* **CSPRNG** — `randomIndex` uses `crypto.getRandomValues` with modulo-bias
  rejection for friend codes, room codes, usernames and avatar seeds.
* **Rename limiter** — atomic via `spend_rename_attempt` (migration 09), durable,
  fails open deliberately, and the decision is a pure function with its own QA
  gate.
* **Score/verdict bounds** — `results_score_sane` (±1e15, which is what actually
  refuses `NaN` given `'NaN' = 'NaN'` is true for `numeric`),
  `results_verdict_known` as a closed set, `results_metrics_small`,
  `results_metrics_history_bounded`, `saves_state_small`, `streaks_sane`,
  `mastery_level_sane`.
* **Security headers** — `X-Frame-Options`, `nosniff`, HSTS (2y, no `preload`,
  deliberately), `Referrer-Policy`, `Permissions-Policy`, and a CSP covering
  `frame-ancestors`, `frame-src`, `form-action`, `object-src`, `base-uri` and
  `connect-src`. The absence of `script-src` is a documented, reasoned trade
  against losing ISR on `/r/{id}` — and the premises it rests on (no user-supplied
  markup, no third-party scripts, charset-locked usernames) all still hold.
* **OG route** — UUID-validated, 2.5s fetch timeout, unknown ids 302 to a single
  cacheable URL so a stream of random UUIDs cannot bill a Satori render each.
* **Wire protocol** — `parseRunState` rebuilds every field, clamps every number,
  and cross-checks `year >= startYear`. No prototype-pollution path: `flags` and
  `yearChoices` assign only numbers and strings to computed keys, which `__proto__`
  ignores.
* **Leaderboard queries** — `top_results` is `security invoker` so RLS still
  decides; the page-walk fallback projects columns rather than `select("*")`;
  profiles are batch-fetched (no N+1).

---

*Generated by [Claude Code](https://claude.ai/code)*
