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
2. SQL editor → run [`supabase/schema.sql`](supabase/schema.sql).
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

### Optional index for the segmented boards

The leaderboard can narrow to one starting background or to today's Daily Ledger,
and a run's share link is found by its seed. All three filter inside `metrics`,
which PostgREST exposes as a real column (`metrics->>backgroundId`), so
**`schema.sql` covers everything and nothing here is required**. If the `results` table ever grows past the point where those
filters are comfortable, two expression indexes are the fix:

```sql
create index if not exists results_background_idx
  on public.results ((metrics->>'backgroundId'));
create index if not exists results_seed_idx
  on public.results (user_id, (metrics->>'seed'));
create index if not exists results_daily_idx
  on public.results ((metrics->>'daily'), score desc);
```

Safe to run at any time on a live table.

## Notes

Historical returns are curated and approximate (easy to refine in `lib/markets.ts`); individual stocks are era-tuned and brand-free. Not financial advice — it's a game.
