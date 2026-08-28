// deno-lint-ignore-file no-explicit-any
/**
 * The only writer of `public.profiles`.
 *
 * WHY THIS EXISTS. Username screening ran in the browser and nowhere else. The
 * browser is not where the write happens: `profiles` is written straight to
 * PostgREST under a policy that asserts `auth.uid() = id` and nothing about the
 * value, so one PATCH — or one INSERT at signup, which is the easier of the two —
 * put any string on the public leaderboard. The charset CHECK in migration 01 held
 * (no homoglyphs, no RTL overrides), but the word list did not exist server-side
 * at all.
 *
 * The fix is not a second copy of the filter in SQL. Two implementations of case
 * folding, leetspeak, separator stripping and the ALLOW list drift, and a server
 * that disagrees with the client refuses a name the player was just told was fine.
 * So there is ONE implementation, in `../_shared/username.ts`, and this function
 * and the browser both import it.
 *
 * DEPLOY ORDER — THIS MATTERS. This function must be live BEFORE
 * `2026-08-28_05_username_gate.sql` is applied; that migration is what takes the
 * direct write away, and until it runs the browser can still reach PostgREST and
 * this function is merely the polite path. Deploying this early is harmless.
 * Applying the migration early is not: new signups would have no way to get a
 * profile row. The migration's own header says the same thing from the other side.
 *
 *   supabase functions deploy profile --project-ref <ref>
 *   # verify a rename and a signup, THEN:
 *   # apply supabase/migrations/2026-08-28_05_username_gate.sql
 *
 * AUTH. `verify_jwt` is left at its default of true, so the platform rejects a
 * request with no valid JWT before this handler runs; `auth.getUser` then resolves
 * WHICH user, and every write below is keyed to that id. A caller cannot name the
 * row they are writing — the body carries a username and nothing else — so there is
 * no id to forge.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkUsername } from "../_shared/username.ts";
import { generateAvatarSeed, generateFriendCode, generateUsername } from "../_shared/generate.ts";

/**
 * Both key regimes.
 *
 * Supabase is midway through replacing `SUPABASE_SERVICE_ROLE_KEY` / `_ANON_KEY`
 * with the JSON `SUPABASE_SECRET_KEYS` / `SUPABASE_PUBLISHABLE_KEYS` maps. A
 * project on either one injects only its own pair, and this function has to run on
 * whichever the project happens to be on — so it reads the legacy name first and
 * falls back to the map rather than assuming.
 */
function key(legacy: string, mapName: string): string {
  const direct = Deno.env.get(legacy);
  if (direct) return direct;
  const raw = Deno.env.get(mapName);
  if (!raw) throw new Error(`missing ${legacy} and ${mapName}`);
  const map = JSON.parse(raw) as Record<string, string>;
  const picked = map.default ?? Object.values(map)[0];
  if (!picked) throw new Error(`${mapName} is empty`);
  return picked;
}

const URL_ = Deno.env.get("SUPABASE_URL")!;

/** CORS: the browser calls this cross-origin from the app's domain. */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

/** A profile row, in the shape `lib/cloud/profiles.ts` already parses. */
const COLUMNS = "id,username,avatar_seed,friend_code,created_at";

/** Retry budget for a unique-constraint collision on a generated name or code. */
const MAX_CREATE_ATTEMPTS = 5;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  let admin: any;
  let anonKey: string;
  try {
    admin = createClient(URL_, key("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    anonKey = key("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEYS");
  } catch {
    // A misconfigured function must not look like a rejected name.
    return json({ error: "Profile service is misconfigured." }, 500);
  }

  // WHO. `verify_jwt` has already refused anything unsigned; this resolves the id.
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer /i, "");
  const reader = createClient(URL_, anonKey, { auth: { persistSession: false } });
  const { data: got, error: authError } = await reader.auth.getUser(token);
  const user = got?.user;
  if (authError || !user) return json({ error: "Sign in to set a name." }, 401);

  let body: { action?: unknown; username?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected a JSON body." }, 400);
  }

  if (body.action === "ensure") return await ensure(admin, user.id);
  if (body.action === "rename") {
    if (typeof body.username !== "string") return json({ error: "Expected a username." }, 400);
    return await rename(admin, user.id, body.username);
  }
  return json({ error: "Unknown action." }, 400);
});

/**
 * Get-or-create. Idempotent, and the generated name never goes near the filter's
 * reject path — `generateUsername` draws from a curated list — but it is checked
 * anyway, because a list that grows and a generator that grows are edited by
 * different people on different days.
 */
async function ensure(admin: any, userId: string): Promise<Response> {
  const existing = await admin.from("profiles").select(COLUMNS).eq("id", userId).maybeSingle();
  if (existing.error) return json({ error: existing.error.message }, 500);
  if (existing.data) return json({ profile: existing.data }, 200);

  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
    const name = generateUsername();
    if (!checkUsername(name).ok) continue;
    const { data, error } = await admin
      .from("profiles")
      .insert({
        id: userId,
        username: name,
        avatar_seed: generateAvatarSeed(),
        friend_code: generateFriendCode(),
      })
      .select(COLUMNS)
      .single();
    if (!error && data) return json({ profile: data }, 200);
    // A concurrent call may have won the race — re-read before spending a retry.
    const reread = await admin.from("profiles").select(COLUMNS).eq("id", userId).maybeSingle();
    if (reread.data) return json({ profile: reread.data }, 200);
  }
  return json({ error: "Could not create a profile. Try again in a moment." }, 503);
}

/**
 * Rename, screened.
 *
 * The 400 here is the whole point of the function, so its message is the filter's
 * own — the player sees the same sentence whether the browser caught it or this
 * did, which is the property a second implementation would have destroyed.
 */
async function rename(admin: any, userId: string, raw: string): Promise<Response> {
  const checked = checkUsername(raw);
  if (!checked.ok) return json({ error: checked.message, reason: checked.reason }, 400);

  const { data, error } = await admin
    .from("profiles")
    .update({ username: checked.value })
    .eq("id", userId)
    .select(COLUMNS)
    .single();

  if (error) {
    // 23505 is the unique index on `username`. Everything else is ours, not theirs.
    const taken = (error as { code?: string }).code === "23505";
    return json(
      { error: taken ? "That name is taken." : "Could not save that name." },
      taken ? 409 : 500,
    );
  }
  if (!data) return json({ error: "No profile to rename." }, 404);
  return json({ profile: data }, 200);
}
