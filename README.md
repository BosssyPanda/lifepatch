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

- **Story** — 1990 → 2010. A finite run through the dot-com boom/bust and the 2008 crash, ending in a report.
- **Infinite** — 1957 → today. Live a whole lifetime until you retire, quit, or your number comes up. Autosaves every year.

## Optional: real cloud saves (Supabase)

Cloud login + cross-device saves are off by default and require zero code changes to enable:

1. Create a free project at [supabase.com](https://supabase.com).
2. SQL editor → run [`supabase/schema.sql`](supabase/schema.sql).
3. Authentication → enable **Email** (magic link), and add your site URL as a redirect.
4. Copy `.env.local.example` → `.env.local` and paste your `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Notes

Historical returns are curated and approximate (easy to refine in `lib/markets.ts`); individual stocks are era-tuned and brand-free. Not financial advice — it's a game.
