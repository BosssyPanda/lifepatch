import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Configured only when env keys are present. Null → app uses the local dev fallback. */
export const supabase: SupabaseClient | null =
  url && anon ? createClient(url, anon, { auth: { persistSession: true, detectSessionInUrl: true } }) : null;

export const isCloud = Boolean(supabase);

/**
 * A production build that came out without the Supabase keys.
 *
 * These are `NEXT_PUBLIC_*` values, inlined at build time, so setting them in a
 * host dashboard does nothing until a fresh deploy — which makes "a production
 * build cut before the vars landed" an ordinary accident rather than an exotic
 * one. Every consumer of `isCloud` then takes the DEV fallback, and one of those
 * consumers is `signIn`, which fabricates `{ id: "dev-<email>" }` and writes it to
 * localStorage with no verification of any kind. `isGuestId` only recognises the
 * `device-` prefix, so everything downstream treats that as a real account: typing
 * any address signs you in, saves go to the browser, the leaderboard is a local
 * list, and nothing on screen says so. It failed open and it failed quiet.
 *
 * A flag rather than a `throw`, deliberately. Throwing here fails the BUILD, which
 * is a fine place to find out — but it also means a momentarily missing variable
 * takes the whole site down rather than one feature, and the actual security
 * property wanted is narrower: never present a fake sign-in as a real one. So the
 * app still builds, still runs, and guests still play; `useAuth` refuses the
 * fabricated account and says why.
 */
export const cloudMisconfigured = process.env.NODE_ENV === "production" && !isCloud;
