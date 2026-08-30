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
 * AND ONE THE OTHER WAY ROUND, WHICH IS SOFT. `2026-08-30_07_rename_rate_limit.sql`
 * adds the two columns `spendRenameAttempt` reads, so that migration wants to go
 * first. It is not an outage if it does not: the limiter fails open by design, so on
 * a project without 07 the select errors, the attempt is allowed, and renaming works
 * exactly as it did before. What you get is no limit rather than no feature — which
 * is the right failure for this control and the wrong thing to leave in place, so
 * apply 07 and the counter starts working with no further deploy.
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

/**
 * CORS: the browser calls this cross-origin from the app's domain.
 *
 * This used to answer `*`. That was not exploitable — `verify_jwt` refuses anything
 * unsigned, and the token travels as an Authorization header rather than a cookie,
 * so no browser attaches it to a cross-origin request on its own — but naming the
 * origin is strictly better and no harder. `*` is a standing invitation for the day
 * one of those two facts stops being true.
 *
 * An origin that is not on the list gets the canonical one back, which its browser
 * will not match, so the refusal happens in the browser — which is where a CORS
 * refusal belongs. `Vary: Origin` so no cache can hand one origin's answer to
 * another.
 *
 * THE FIRST ENTRY IS THE ONE PRODUCTION ACTUALLY SERVES FROM, and it is the
 * per-deploy Vercel host rather than a custom domain: `app/layout.tsx` names it as
 * the canonical origin for every absolute URL a crawler is given, and it is what
 * answers on the internet today. `lifepatch.app` is on the list because
 * `components/share/useShareUrl.ts` names it as the intended domain — it has no DNS
 * record yet, so it costs nothing here and stops the day it is pointed at this app
 * from being the day renaming breaks.
 *
 * A VERCEL PREVIEW DEPLOYMENT IS STILL NOT ON THIS LIST. Preview builds get a
 * per-branch *.vercel.app host and sign in against this same Supabase project, so a
 * signup or a rename will fail there until that exact origin is added below.
 * Guessing a wildcard would give back the `*` this list exists to remove.
 */
const ALLOWED_ORIGINS = [
  "https://lifepatch-nine.vercel.app",
  "https://lifepatch.app",
  "http://localhost:3000",
];
const CANONICAL_ORIGIN = ALLOWED_ORIGINS[0];

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : CANONICAL_ORIGIN,
    Vary: "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(body: unknown, status: number, cors: Record<string, string>, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, ...extra, "content-type": "application/json" },
  });
}

/** A profile row, in the shape `lib/cloud/profiles.ts` already parses. */
const COLUMNS = "id,username,avatar_seed,friend_code,created_at";

/** Retry budget for a unique-constraint collision on a generated name or code. */
const MAX_CREATE_ATTEMPTS = 5;

/** Rename attempts allowed per account per window. See `spendRenameAttempt`. */
const RENAME_LIMIT = 5;
const RENAME_WINDOW_MS = 60 * 60 * 1000;

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405, cors);

  let admin: any;
  let anonKey: string;
  try {
    admin = createClient(URL_, key("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    anonKey = key("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEYS");
  } catch {
    // A misconfigured function must not look like a rejected name.
    return json({ error: "Profile service is misconfigured." }, 500, cors);
  }

  // WHO. `verify_jwt` has already refused anything unsigned; this resolves the id.
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer /i, "");
  const reader = createClient(URL_, anonKey, { auth: { persistSession: false } });
  const { data: got, error: authError } = await reader.auth.getUser(token);
  const user = got?.user;
  if (authError || !user) return json({ error: "Sign in to set a name." }, 401, cors);

  let body: { action?: unknown; username?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected a JSON body." }, 400, cors);
  }

  if (body.action === "ensure") return await ensure(admin, user.id, cors);
  if (body.action === "rename") {
    if (typeof body.username !== "string") {
      return json({ error: "Expected a username." }, 400, cors);
    }
    return await rename(admin, user.id, body.username, cors);
  }
  return json({ error: "Unknown action." }, 400, cors);
});

/**
 * Get-or-create. Idempotent, and the generated name never goes near the filter's
 * reject path — `generateUsername` draws from a curated list — but it is checked
 * anyway, because a list that grows and a generator that grows are edited by
 * different people on different days.
 */
async function ensure(admin: any, userId: string, cors: Record<string, string>): Promise<Response> {
  const existing = await admin.from("profiles").select(COLUMNS).eq("id", userId).maybeSingle();
  if (existing.error) return json({ error: existing.error.message }, 500, cors);
  if (existing.data) return json({ profile: existing.data }, 200, cors);

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
    if (!error && data) return json({ profile: data }, 200, cors);
    // A concurrent call may have won the race — re-read before spending a retry.
    const reread = await admin.from("profiles").select(COLUMNS).eq("id", userId).maybeSingle();
    if (reread.data) return json({ profile: reread.data }, 200, cors);
  }
  return json({ error: "Could not create a profile. Try again in a moment." }, 503, cors);
}

/**
 * Spend one rename attempt, or report how long until the next one.
 *
 * WHY A LIMITER AT ALL. `rename` answers 409 for "that name is taken" and 400 for
 * "the filter refuses that name". Two distinguishable answers plus unlimited
 * attempts is an oracle: one account can walk the username space a request at a
 * time and learn who exists. The alternative fix — collapsing the 409 into the 400
 * — closes the oracle by lying to the player, who then cannot tell "already taken"
 * from "your name is offensive". So the answers stay honest and the attempts get
 * bounded.
 *
 * BEFORE THE UNIQUENESS CHECK, NOT AFTER A SUCCESS. Probing for a taken name is the
 * attack and it returns 409, so a counter that only counted completed renames would
 * count none of it. A name the word filter refuses does NOT spend an attempt: it is
 * rejected before this runs and reveals nothing about who exists.
 *
 * IN THE DATABASE, NOT IN MEMORY. This function is stateless and horizontally
 * scaled; a module-level counter would enforce "five per hour per isolate you
 * happen to land on", which is not a limit. `rename_window_start` and
 * `rename_attempts` (migration 2026-08-30_07) are the durable place, written by the
 * service role only.
 *
 * FAILS OPEN. A limiter that cannot read its own counter must not become an outage
 * on a feature that works: the cost of letting one extra attempt through is one
 * guess, and the cost of refusing is a player who cannot rename at all.
 */
async function spendRenameAttempt(
  admin: any,
  userId: string,
): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const { data, error } = await admin
    .from("profiles")
    .select("rename_window_start,rename_attempts")
    .eq("id", userId)
    .maybeSingle();
  // No row is not this function's 404 to give — `rename` below already has one.
  if (error || !data) return { ok: true };

  const now = Date.now();
  const startedAt = data.rename_window_start ? Date.parse(data.rename_window_start) : NaN;
  const fresh = !Number.isFinite(startedAt) || now - startedAt >= RENAME_WINDOW_MS;
  const spent = fresh ? 0 : Number(data.rename_attempts ?? 0);

  if (spent >= RENAME_LIMIT) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((startedAt + RENAME_WINDOW_MS - now) / 1000)) };
  }

  await admin
    .from("profiles")
    .update({
      rename_window_start: fresh ? new Date(now).toISOString() : data.rename_window_start,
      rename_attempts: spent + 1,
    })
    .eq("id", userId);

  return { ok: true };
}

/**
 * Rename, screened.
 *
 * The 400 here is the whole point of the function, so its message is the filter's
 * own — the player sees the same sentence whether the browser caught it or this
 * did, which is the property a second implementation would have destroyed.
 */
async function rename(
  admin: any,
  userId: string,
  raw: string,
  cors: Record<string, string>,
): Promise<Response> {
  const checked = checkUsername(raw);
  if (!checked.ok) return json({ error: checked.message, reason: checked.reason }, 400, cors);

  const gate = await spendRenameAttempt(admin, userId);
  if (!gate.ok) {
    const minutes = Math.max(1, Math.round(gate.retryAfter / 60));
    return json(
      { error: `Too many name changes. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.` },
      429,
      cors,
      { "retry-after": String(gate.retryAfter) },
    );
  }

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
      cors,
    );
  }
  if (!data) return json({ error: "No profile to rename." }, 404, cors);
  return json({ profile: data }, 200, cors);
}
