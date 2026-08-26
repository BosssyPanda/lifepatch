import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The server's Supabase clients. This module must never be imported from a
 * component.
 *
 * `lib/supabase.ts` is the browser client and holds the publishable key, which is
 * the correct key to ship: it is public by design and every table behind it is
 * row-level-secured. What it cannot do is write a row the player is not allowed to
 * write — and that is exactly what verification needs, because the whole point is
 * that the score is derived by something the player does not control.
 *
 * So the secret key lives here, in a module Next.js only ever bundles into the
 * server. `SUPABASE_SERVICE_ROLE_KEY` has NO `NEXT_PUBLIC_` prefix, which is what
 * keeps it out of the client bundle: a `NEXT_PUBLIC_*` value is inlined into the
 * JavaScript every visitor downloads, and pasting a `sb_secret_…` key into one
 * would hand every player the ability to write any row in the database. The
 * warning in `.env.local.example` says the same thing from the other direction.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Writes as the service role, bypassing RLS entirely.
 *
 * Null when the key is not configured, which is the deployment the app is designed
 * to keep working: `app/api/submit-result` answers 503, the client falls back to
 * its own insert, and the run still reaches the board — it simply arrives without
 * the flag that says a server derived it. See the route for the full ladder.
 */
export const supabaseAdmin: SupabaseClient | null =
  url && secret
    ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;

/**
 * Who is calling, according to Supabase — not according to the request body.
 *
 * The access token is verified against the auth server rather than decoded here.
 * A JWT's payload is readable by anyone holding it and forgeable by anyone willing
 * to write one, so "the body says user_id X" and "a decoded token claims sub X"
 * are the same worthless statement. This returns the id Supabase itself vouches
 * for, and the route uses that as `user_id` and ignores whatever was sent.
 */
export async function userIdFromToken(token: string): Promise<string | null> {
  if (!url || !anon || !token) return null;
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}
