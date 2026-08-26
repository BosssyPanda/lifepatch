# LifePatch — Survive the Internet Economy

A gritty, editorial **financial life simulator**. Live year-by-year through **real S&P 500 history**, build (or torch) a portfolio BuildYourStax-style, survive BitLife-style life events, and try not to get financially cooked. You don't see the calendar year while you play — the real timeline is revealed at the end.

Built with **Next.js (App Router) · TypeScript · Tailwind v4 · Framer Motion · Lenis**, with optional **Supabase** email login + cloud saves.

## Play

```bash
npm install
npm run dev      # http://localhost:3000
```

The game is fully playable out of the box — with no configuration it uses a local dev fallback (email sign-in is faked, saves go to your browser's `localStorage`).

## Modes

- **Daily Ledger** — one seeded world a day, the same one for everybody: same markets,
  same cards, same opening. One attempt, then a spoiler-free grid of how each of your
  years went against the index.
- **Story** — 1990 → 2010. A finite run through the dot-com boom/bust and the 2008 crash, ending in a report.
- **Infinite** — 1957 → today. Live a whole lifetime until you retire, quit, or your number comes up. Autosaves every year.

## Optional: cloud saves, leaderboards, and multiplayer (Supabase)

Cloud login, cross-device saves, and the **Play with friends** rooms in Story are
off by default and require zero code changes to enable:

1. Create a free project at [supabase.com](https://supabase.com).
2. SQL editor → run [`supabase/schema.sql`](supabase/schema.sql). Run **Part A**;
   the file is one document and tells you when Part B applies (step 7 below).
3. Authentication → Providers → enable **Email** (magic link).
4. Authentication → URL Configuration → add your site URL (and `http://localhost:3000`).
5. Settings → **API Keys** → copy the Project URL and the **publishable key**
   (`sb_publishable_…`, which replaced the legacy `anon` key).
6. Copy `.env.local.example` → `.env.local` and paste both values.

Multiplayer needs nothing beyond those two variables — Realtime ships inside the
Supabase client, rooms are guest-first on the publishable key, and there is no
rooms table. See [`docs/MULTIPLAYER.md`](docs/MULTIPLAYER.md).

On a hosted deploy, `NEXT_PUBLIC_*` values are inlined at **build** time — setting
them in your host's dashboard takes effect only on the next deploy.

### Making a posted score mean something

Everything above works without this. What it adds is the difference between the
"Replayed" mark being real and it being decoration.

A run records what the player actually did — every card answered, every trade,
every debt payment, the year the house was sold. That log plus the seed is enough
to re-simulate the run exactly, which is what `lib/replay.ts` has always done.
Until now it did it *in the browser*: the same program that computed the score
also replayed it, agreed with itself, and wrote its own `verified` flag. A
modified client writes both halves, so the mark attested to nothing.

`app/api/submit-result` moves the replay to the server. The browser sends the
run's **actions** and no score at all; the server replays them and derives the
score, the verdict and every metric from the state that replay lands on. There is
no number in the request to disagree with.

To turn it on:

7. Supabase → Settings → **API Keys** → copy the `sb_secret_…` (service_role)
   key. Set it as **`SUPABASE_SERVICE_ROLE_KEY`** in your host (Vercel → Project →
   Settings → Environment Variables), then redeploy.
   **No `NEXT_PUBLIC_` prefix.** That prefix inlines a value into the JavaScript
   every visitor downloads, and this key bypasses every row-level-security policy
   in your database.
8. Finish a run and confirm the row lands with **Replayed** beside it. That is the
   route answering; without the key it answers `503` and the browser quietly posts
   the row itself, exactly as before.
9. Only then, run **Part B** at the end of `supabase/schema.sql`. It closes the
   browser's ability to insert a Story or Infinite result at all, leaving the
   route as the only way one can be written. Run it earlier and finished runs stop
   reaching the board until the route is live — nothing is lost (the client parks
   them and retries), but nothing appears either.

Be precise about where the line falls. `scripts/qa/verify-route.mjs` measures both
sides of it:

- **Refused** — any journal the engine could not have produced: a choice whose
  outcome is not the one the seed rolls, a deal it did not deal (or the same cards
  reordered), the same actions under a different seed or background, a year
  appended, spliced out, or renumbered. 288 attempts, 288 refusals.
- **Not refused** — a journal that is *legal* but is not what happened: an extra
  trade the state could genuinely have funded. This cannot be caught, and no
  amount of server-side replay would change that. The journal is the only record
  of what the player did, so a legal journal is a legal run by definition. It is
  also not much of a lever: across 36 runs, one invented trade moved the score up
  on 7 of them and *down* on 14.

So it ends score **fabrication** — claiming a number, or a life the engine could
not produce. It does not end run **optimisation** by a determined player, which is
the same limit as someone scripting the real game. The share page and the board
legend say exactly this, in as many words.

The Rat Race is not covered and does not pretend to be. Its state records dice
rolls, not decisions, so there is no action log to replay; those rows keep posting
from the browser and never carry the flag. Their board is protected instead by the
score-version filter in `lib/cloud/comparability.ts`.

### Indexes

`schema.sql` creates the expression indexes the segmented boards need
(`metrics->>'backgroundId'`, `metrics->>'daily'`) and the unique index on
`(user_id, mode, metrics->>'seed')` that stops two tabs posting the same run
twice. Nothing further is required.

Safe to run at any time on a live table.

## Dependency advisories

`npm audit` is part of the gate. As of the last pass it reports **2 residual** findings, both for
`postcss` — and both live in `node_modules/next/node_modules/postcss`, the copy Next.js vendors for
its own build pipeline rather than one this project installs. They are reachable only by a
`sourceMappingURL` comment in CSS that Next compiles, i.e. by this repo's own stylesheets, and only
at build time; nothing is exposed at runtime.

`npm audit fix --force` would clear them by installing **`next@16`**, a breaking major. That is a
deliberate migration, not a patch, so the two are accepted and recorded here instead. Everything
else — including all 8 `next` advisories fixed in `15.5.21` — is resolved by a plain
`npm audit fix --package-lock-only`, which stays inside the declared `^15.1.6` range and leaves
`package.json` untouched.

(Related, and also deferred to that migration: `next lint` is deprecated and is removed in Next 16,
so `npm run lint` will need to move to the ESLint CLI at the same time.)

## Notes

Historical returns are curated and approximate (easy to refine in `lib/markets.ts`); individual stocks are era-tuned and brand-free. Not financial advice — it's a game.
