# LifePatch — codebase review, 2026-09-19

Scope: every file under `app/`, `components/`, `hooks/`, `lib/`, `src/`, `scripts/`
and `supabase/`, plus `next.config.ts`, `package.json` and the installed dependency
tree. Static gates were run rather than assumed.

## What the gates said

| Check | Result |
| --- | --- |
| `npm run typecheck` (`tsc --noEmit`) | clean |
| `npm run lint` (`eslint .`) | clean |
| `npm run qa:challenge` | 10/10 |
| `npm run qa:cloud` | 16/16 |
| `npm run qa:engine` | 34/34 |
| `npm run qa:metrics` | 19/19 |
| `npm run qa:rename` | 16/16 |
| `npm run qa:rls` | 16 probes closed, 24 behaviours intact |
| `npm run qa:transport` | 11/11 |
| `npm run qa:username` | 1728 generated + 22 innocent accepted, 24 refused |
| `npm run qa:audio`, `npm run qa:mp` | **did not run** — both need `next dev` on :3000; not a code defect |
| secret scan (`sb_secret`, `service_role` keys, JWTs, PEM, AWS keys) | no hardcoded secrets |
| `npm audit` | 2 moderate (1 reaches production) |

**There are no critical security vulnerabilities in this codebase.** The obvious
classes are closed and the closures are load-bearing rather than decorative: RLS is
column-grant-level as well as policy-level, the verdict column is a closed set with a
CHECK behind it, `score`/`metrics` are bounded, the username charset is enforced in
three places, friend codes come from the platform CSPRNG, the multiplayer wire is
rebuilt field by field, and there is no `dangerouslySetInnerHTML` anywhere in the
tree. What follows is what is genuinely still open, ranked honestly.

---

## 1. Security

### 1.1 `top_results` takes an unbounded row limit from any caller — **Medium**

`supabase/migrations/2026-09-02_10_top_results.sql:47, 87` (called from
`lib/cloud/results.ts:278`)

`p_limit` arrives straight from the browser and lands in `limit p_limit` with no
ceiling, and `execute` is granted to `anon` and `authenticated`. One request —

```
POST /rest/v1/rpc/top_results  { "p_mode": "story", "p_limit": 100000000 }
```

— makes the database run `distinct on (user_id)` across the whole `results` table
and stream every deduped row back, unauthenticated. `p_users uuid[]` is unbounded
the same way. `results` is public-read by policy, so this leaks nothing new; what it
buys an attacker is *amplification* — the client-side page-walk this function
replaced is capped at `MAX_PAGES × PAGE` (`lib/cloud/results.ts:307-308`), and the
RPC removed that ceiling without replacing it. A negative `p_limit` is also a raw
Postgres error rather than an empty board.

Clamp in the function, where the client cannot reach it:

```sql
   order by b.score desc, b.id asc
   limit least(greatest(coalesce(p_limit, 25), 1), 100);
```

and bound the id list in the same statement:

```sql
         and (p_users is null or (array_length(p_users, 1) <= 200
                                  and r.user_id = any (p_users)))
```

100 is already four times the board's `DEFAULT_LIMIT`; no honest caller notices.

### 1.2 `fflate@0.6.10` is in the production dependency tree — **Low/Medium**

`package-lock.json` — `@react-three/rapier@2.2.0 → three-stdlib@2.36.1 → fflate@0.6.10`

GHSA-px8p-9vwx-vf98 (moderate, CVSS 7.5 availability): `unzipSync` can enter an
infinite loop on a malformed ZIP64 archive. Reachable only through three-stdlib
loaders that unzip (FBX, 3DM, etc.), and this app loads no such assets — so the
practical risk today is ~nil and the finding is really about the fix being free. The
second advisory (`qs`, two moderates via `shadcn → @modelcontextprotocol/sdk →
express`) is `devDependencies` only and never ships.

```jsonc
// package.json — alongside the existing "postcss" override
"overrides": {
  "postcss": "$postcss",
  "fflate": "^0.8.3"   // the version @types/three already resolves
}
```

Then `npm install && npm run build` to confirm nothing in three-stdlib regressed.

### 1.3 Public projections are enumerable in one request — **Low (by design, worth a knob)**

`supabase/schema.sql:162` (`profiles_public`), `:235` (`results`), `:360` (`streaks`)

All three are readable by `anon`, and PostgREST puts no default ceiling on a select.
`GET /rest/v1/profiles_public?select=*` returns the entire player base — every
username, avatar seed and signup date — in a single unauthenticated call; `streaks`
and `results` behave the same way. This is the intended shape (the leaderboard needs
it, and the schema comments are explicit that `friend_code` must never join the
view, which is the part that would matter), so the finding is not "close the read"
but "cap the page":

- Supabase Dashboard → Settings → API → **Max rows**, set to e.g. `1000`.

`topResults` pages at `limit * 5` (125 by default) and `getProfiles` filters with
`.in(...)`, so nothing in the app asks for more than that. Do this *after* 1.1, or
the RPC's own `limit` will still outrank it.

### 1.4 `profile_by_friend_code` has no attempt ceiling — **Low**

`supabase/schema.sql:167-182`; `grant execute ... to authenticated`

The rename path got a durable, atomic limiter (migration 09) precisely because two
distinguishable answers plus unlimited attempts is an oracle. Friend-code lookup has
the same shape and no limiter: a signed-in account can call the RPC as fast as it
likes. The keyspace is 31⁶ ≈ 887M and a hit only buys the ability to *send* a
pending request the target still has to accept, so the expected value is very low —
noting it because the asymmetry with `spend_rename_attempt` looks like an oversight
rather than a decision. If it is a decision, one line in the schema comment saying
so would close the question for the next reader.

### 1.5 CSP — the absent `script-src` is argued; three cheap directives are simply missing — **Informational**

`next.config.ts:90-134`

The case for deferring `script-src` is stated at length and is sound (no
user-supplied markup anywhere, username charset-locked in three places, ISR on
`/r/{id}` is the thing a nonce would cost). No disagreement. But three directives
cost nothing, need no nonce, and are not there:

```ts
"img-src 'self' data: blob:",
"worker-src 'self' blob:",   // Tone.js / three may spin workers
"manifest-src 'self'",
```

`style-src` and `font-src` are deliberately left out of that list — Next's inline
critical CSS and `next/font` would need `'unsafe-inline'` and a data: allowance, at
which point the directive buys little. Also consider `Cross-Origin-Opener-Policy:
same-origin` next to the existing `X-Frame-Options`/`frame-ancestors` pair.

---

## 2. Functional bugs

### 2.1 The OG card can print `—` for a score `/r/{id}` prints in full — **Medium**

`app/api/og/[id]/route.tsx:69-70` and `:207`

`fetchRow` validates with `finiteColumn`, which — per its own docstring in
`lib/metrics.ts:84-105` — deliberately accepts a `numeric` column serialised as a
**string**, "which PostgREST is entitled to" do. It then returns `row` with `score`
*unconverted*:

```ts
if (!row || finiteColumn(row.score) === null) return null;
return row;                       // score may still be "412500.00"
```

The render path does not tolerate that. `currency` (`lib/format.ts:29`) guards with
`Number.isFinite`, which does **not** coerce:

```
finiteColumn("412500.00")  → 412500        (row accepted)
currency("412500.00")      → "—"           (OG card headline, 84px)
currency(Number(...))      → "$412,500"    (what /r/[id] prints)
```

`/r/[id]` is safe only because `fromRow` (`lib/cloud/results.ts:67`) does
`Number(row.score)`. So the two public renderings of one row disagree — exactly the
divergence the shared `money`/`plain`/`percent` helpers were introduced to make
unrepresentable ("`/r/[id]` and `/api/og/[id]` draw the SAME row, and they had
drifted"). `row.score >= 0` on line 206 happens to coerce, so the colour stays right
while the figure vanishes — the worst version of the failure.

Normalise once, at the boundary:

```ts
async function fetchRow(id: string): Promise<Row | null> {
  // ...
  const raw = rows[0] ?? null;
  if (!raw) return null;
  const score = finiteColumn(raw.score);
  if (score === null) return null;
  return { ...raw, score };        // every reader below gets a real number
}
```

### 2.2 The "an unfurl must never 500" fallback can itself 500 — **Medium**

`app/opengraph-image.tsx:34`

```ts
const [anton, mono] = await loadFonts();   // no catch
```

`/api/og/[id]` redirects to this route in **both** of its fallbacks — the
missing-font branch (line 152) and the unknown-run branch (line 176) — and its
comments describe it as "the one thing left that always renders". It does not always
render. `cachedFonts` (`app/api/og/_fonts/cache.ts`) exists in its
memoise-on-success-only form precisely because "that read can fail", and here a
failure propagates and Next serves a 500 — on the single URL every unknown-id unfurl
lands on, which is also the URL a stream of random UUIDs is deliberately funnelled
to.

```ts
export default async function OgImage() {
  const ttf = await loadFonts().catch(() => null);
  if (!ttf) {
    // A card we cannot draw is not a fact about this deployment; no cache-control,
    // same stance as the sibling route's font branch.
    return new Response(null, { status: 204 });
  }
  const [anton, mono] = ttf;
  // ...
}
```

A `204` (or a redirect to a committed static PNG, if one is added) keeps every
scraper on a non-error path. Whatever the chosen answer, it must not be a 302 back to
`/api/og/{id}`.

### 2.3 `retire()` and `quitRun()` can re-end an already-ended run — **Low/Medium**

`lib/runEngine.ts:956-961`

`advanceYear` carries this guard, with seven lines saying why (`:805-812`):

> A finished life does not keep aging. The engine is the only place this can be
> guaranteed: the year turns from several callers … and one of them can hold a stale
> copy of a run that has since ended (a screen mid-exit still owns its last rendered
> props).

`retire` and `quitRun` are reachable from the same screen — `YearLoop.tsx:186-187`
wires them straight to `run.retire` / `run.quit` — and have no such guard. They
always spread, so `useRun`'s `commit` (`hooks/useRun.ts:213-230`), which bails only
on `next === prev`, writes the new state and re-fires the end-of-run path. A stale
press after the run has already closed rewrites `endReason` — and that is not
cosmetic: `deriveVerdict` (`lib/verdict.ts`) keys `VERDICTS.estate` off
`endReason === "died"`, so an insolvency or a death silently becomes a net-worth
verdict on the report, in the recap and on the row posted to the leaderboard.

```ts
export function retire(s: RunState): RunState {
  if (s.status !== "playing") return s;   // see advanceYear
  return { ...s, status: "ended", endReason: "retired", journal: sealEnd(s, "retire") };
}
export function quitRun(s: RunState): RunState {
  if (s.status !== "playing") return s;
  return { ...s, status: "ended", endReason: "quit", journal: sealEnd(s, "quit") };
}
```

Returning `s` unchanged also makes `commit`'s `next === prev` bail do the right
thing for free — nothing is announced and nothing is persisted.

### 2.4 `MODE_LABEL[row.mode]` has no fallback on the OG card — **Low (latent)**

`app/api/og/[id]/route.tsx:232` vs `app/r/[id]/page.tsx` (`MODE_LABEL[row.mode] ?? row.mode`)

Unreachable today: `results.mode` carries a CHECK constraint. It is listed only
because it is the same file-pair asymmetry as 2.1, and one-character to close:

```tsx
RUN CLOSED · {MODE_LABEL[row.mode] ?? "RUN"} · FINAL VERDICT
```

---

## 3. Code quality / performance

### 3.1 Migration 10 is documented as optional; without it the board is 7 serial round trips

`lib/cloud/results.ts:288-316`

The page-walk fallback is correct and the "no deploy ordering required" reasoning is
right — but the fallback's cost is up to six **sequential** round trips plus a
seventh for profiles, and the migration header says a project that never applies the
file "keeps working exactly as it does today, just slower". On mobile at ~200ms RTT
that is over a second of spinner on the board a shared link points at. Recommend
treating 10 as optional-to-apply but **expected in production**: one line in
`README.md` next to the schema instructions, so a deploy does not silently inherit
the slow path forever.

### 3.2 The shared-deck draw spins 400 iterations it cannot use

`lib/runEngine.ts:394`

```ts
for (let i = 0; i < 400 && picks.length < want; i++) {
```

`want` can be 2 while this life can face only one card, in which case the loop runs
all 400 times and appends nothing after the first. The solo branch already fixed the
identical problem (`:370`, `Math.min(want, mine.length)`). The output is unchanged
either way — `picks` is append-only and the exit condition is the same — so
`scripts/qa/golden-draws.json` stays valid:

```ts
const target = Math.min(want, canFace.size);
for (let i = 0; i < 400 && picks.length < target; i++) {
```

Negligible cost per year; listed for consistency with the branch above it, not for
the microseconds.

### 3.3 `ensure()` spends its whole retry budget on a non-collision error

`supabase/functions/profile/index.ts` — `ensure`, the create loop

The loop is there to dodge a unique-constraint collision on a generated name or
code. Any *other* insert error — a permission fault, a bad JWT, a transient
connection failure — takes the same path: five attempts × two round trips = ten
queries before the caller sees a 503, on the get-or-create every session hits at
sign-in. The rename handler already reads `error.code` (`23505`); do the same here:

```ts
if (!error && data) return json({ profile: data }, 200, cors);
const reread = await admin.from("profiles").select(COLUMNS).eq("id", userId).maybeSingle();
if (reread.data) return json({ profile: reread.data }, 200, cors);
// A collision is what the retries are for. Anything else will not get better.
if ((error as { code?: string } | null)?.code !== "23505") {
  console.error("profile.ensure: insert failed", error);
  break;
}
```

### 3.4 Two QA scripts fail with an uncaught exception instead of a diagnosis

`scripts/qa/harness.mjs:94`

`npm run qa:audio` and `npm run qa:mp` need `next dev` on :3000. Without it they die
on `page.goto: net::ERR_CONNECTION_REFUSED` and a Node stack trace, which reads like
a broken test rather than a missing prerequisite. A guard in `Run.open` —

```js
catch (e) {
  if (String(e).includes("ERR_CONNECTION_REFUSED")) {
    console.error(`No server at ${BASE}. Start it first:  npm run dev`);
    process.exit(1);
  }
  throw e;
}
```

— would save the next person the detour. (This is the only reason those two rows in
the gate table are blank; nothing suggests either script is failing on merit.)

### 3.5 Dependency drift

All patch/minor, none security-driven beyond 1.2:

| Package | Current | Available | Note |
| --- | --- | --- | --- |
| `next` | 15.5.24 | 15.5.25 | patch |
| `react` / `react-dom` | 19.2.7 | 19.3.0 | minor |
| `@supabase/supabase-js` | 2.108.2 | 2.116.0 | minor |
| `three` / `@types/three` | 0.185.1 | 0.186.0 | minor |
| `framer-motion` | 11.18.2 | 13.4.0 | **two majors behind** — not urgent, but the gap only widens |
| `eslint` | 9.39.5 | 10.11.0 | 9.x is EOL per the install warning |

Also: `package.json` declares `"engines": { "node": "24.x" }` and this container runs
22.22.2 (`EBADENGINE` on install). Everything built and ran, but CI and local
environments should be pinned to one of them.

---

## Appendix — what was checked and found sound

Recorded so the next review does not re-walk it: the multiplayer wire parser
(`lib/mp/protocol.ts` — every field rebuilt, `year < startYear` closed, roster
deduped and capped, session fences fail closed once presence seats an owner); the
username filter and its three-list Scunthorpe handling; `randomIndex`'s CSPRNG with
modulo-bias rejection; the rename limiter's atomic single-statement spend and its
documented fail-open; the `results` insert grant narrowed to five columns; the
`profiles` write surface revoked down to nothing; `profiles_public` revoked before
granted (auto-updatable-view bypass closed); `safeVerdict` as the second half of the
verdict CHECK; `finiteNumber`/`wholeSeries` as the all-or-nothing readers of
client-written jsonb; the Supabase Realtime reconnect generation counter and its
discarded-channel identity guard; `fastForward`'s purity and 500-year guard; the
cent-quantised cashflow settlement that killed the phantom $1,000 loan; and the
absence of any `dangerouslySetInnerHTML`, `eval`, `new Function` or `innerHTML` in
application code.
