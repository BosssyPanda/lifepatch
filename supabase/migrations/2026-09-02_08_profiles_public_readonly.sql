-- ===========================================================================
-- LifePatch — the public projection was writable.
--
--   APPLY THIS FIRST, ahead of any other pending work. It closes a live hole:
--   anyone holding the publishable key — which is every browser that loads the
--   game — could rename or delete ANY player's profile through
--   `public.profiles_public`, with row-level security bypassed entirely.
--
--   Privileges only. Nothing to deploy alongside it, no build depends on it,
--   and it cannot break a reader: `select` is exactly what it leaves behind.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- What went wrong, precisely.
--
-- `2026-08-27_01_security_additive.sql` created the view and granted exactly the
-- privilege it meant to grant:
--
--     grant select on public.profiles_public to anon, authenticated;
--
-- The mistake is that the line is ADDITIVE, and the view did not start empty.
-- Supabase's stock bootstrap carries `grant all on all tables in schema public
-- to anon, authenticated` plus matching default privileges, and a view created
-- in `public` inherits them — so `profiles_public` already held INSERT, UPDATE
-- and DELETE by the time that grant ran, and nothing has ever taken them away.
-- A `grant` cannot narrow; only a `revoke` can.
--
-- On its own that would still be survivable, because RLS gates the base table.
-- Three properties of THIS view compose it into a bypass instead:
--
--   1. `security_invoker = off`, which 01 chose deliberately and documented at
--      length — the view must see past the row policy to put every player's
--      username on a leaderboard. So it executes as its owner, `postgres`.
--   2. `postgres` holds `rolbypassrls`, and `profiles` has RLS enabled but NOT
--      forced (`relforcerowsecurity = false`) — so the owner is not subject to
--      it even in principle.
--   3. The view is a bare projection of one table: no join, no aggregate, no
--      DISTINCT. Postgres therefore treats it as AUTO-UPDATABLE and rewrites an
--      UPDATE or DELETE against the view straight through onto `profiles`.
--
-- Each is defensible alone. Together, with the write grants left on, they hand
-- the anon key the one capability `2026-08-27_02_profiles_lockdown.sql` was
-- written to remove. Observed against the live project, same key, same moment:
--
--     PATCH /rest/v1/profiles_public?id=eq.<any player>   ->  200  accepted
--     PATCH /rest/v1/profiles?id=eq.<any player>          ->  401  permission
--                                                              denied for table
--
-- The base table was bolted shut and the window beside it left open.
--
-- The fix is not to make the view `security_invoker = on`. That would be the
-- reflex reading of the linter's "security definer view" warning, and it would
-- break the feature: `anon` has no `select` on `profiles` (that is the whole
-- point of the lockdown), so an invoker-rights view would return zero rows and
-- every leaderboard would lose its names. The definer semantics are correct.
-- What was never correct is that a definer's-rights view — which is a hole
-- punched through RLS on purpose — was left writable.
-- ---------------------------------------------------------------------------

revoke all on public.profiles_public from anon, authenticated;

-- Re-granted narrowly, and this is now the ONLY privilege either role holds on
-- the view. `service_role` and `postgres` are untouched: they are server-side
-- keys that already hold everything, and nothing reaches them from a browser.
grant select on public.profiles_public to anon, authenticated;


-- ---------------------------------------------------------------------------
-- Stop it coming back.
--
-- The next `create or replace view` in this schema would inherit the same
-- default privileges and reopen the same hole silently. Default privileges are
-- per-owner, so this pins the owner that actually creates the objects.
-- ---------------------------------------------------------------------------

alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate on tables from anon, authenticated;


-- ---------------------------------------------------------------------------
-- Verify, from the outside, with the key a browser has:
--
--   # must answer 200 and change nothing (no row has this id)
--   curl -s -o /dev/null -w '%{http_code}\n' \
--     -X PATCH "$SUPABASE_URL/rest/v1/profiles_public?id=eq.00000000-0000-0000-0000-000000000000" \
--     -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--     -H 'Content-Type: application/json' -d '{"username":"x"}'
--   # BEFORE this migration: 200   AFTER: 401 (permission denied for view)
--
--   # and reads must keep working
--   curl -s "$SUPABASE_URL/rest/v1/profiles_public?select=id,username" -H "apikey: $ANON"
-- ---------------------------------------------------------------------------
