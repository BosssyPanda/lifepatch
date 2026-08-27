-- ===========================================================================
-- LifePatch security migration — PART 2 of 2: THE LOCKDOWN.
--
-- ⚠ RUN THIS ONLY AFTER THE NEW BUILD IS LIVE.
--
-- This is the file that actually closes the friend-code leak, and it is the only
-- one that can break a running client. Every build before this change reads the
-- leaderboard with `from("profiles").select("*")`, and the policy swap below
-- takes that away — an older client hits it as an empty leaderboard, not an
-- error message.
--
-- ORDER OF OPERATIONS
--   1. Run PART 1 (2026-08-27_01_security_additive.sql). Safe any time.
--   2. Deploy the build that reads `profiles_public` and `profile_by_friend_code`.
--      NEXT_PUBLIC_* values are inlined at build time, so "deployed" means a
--      finished deploy, not a dashboard edit.
--   3. Confirm the live leaderboard still renders names and avatars.
--   4. Run this file.
--   5. Optionally run PART 3 to rotate every friend code (see that file).
--
-- Idempotent: re-running it is a no-op.
--
-- TO ROLL BACK, if step 4 turns out to be premature:
--   drop policy if exists "profiles - read own" on public.profiles;
--   create policy "profiles - public read" on public.profiles for select using (true);
-- That restores today's behaviour, leak included.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- profiles: stop publishing whole rows.
--
-- The policy this replaces was commented "leaderboards show username + avatar
-- only" — an accurate description of the INTENT and of nothing the SQL did.
-- `using (true)` grants every column of every row, and RLS cannot project, so
-- `friend_code` went with it:
--
--     GET /rest/v1/profiles?select=username,friend_code
--     apikey: <the publishable key, which every browser has>
--
-- returned the entire player base and all of its codes. That voids the property
-- the friends feature is built on — "added by code, never by search" — because
-- every code is enumerable, and it hands out a full roster of who plays.
--
-- Public reads move to `profiles_public` (PART 1), which physically cannot carry
-- the code. What remains here is your own row, which you need in full: the
-- friend code shown back to you, and the row returned by ensureProfile()'s
-- insert and updateUsername()'s update.
-- ---------------------------------------------------------------------------
drop policy if exists "profiles - public read" on public.profiles;
drop policy if exists "profiles - read own" on public.profiles;
create policy "profiles - read own" on public.profiles
  for select using (auth.uid() = id);


-- ---------------------------------------------------------------------------
-- Belt and braces: the anon role has no business reading the base table at all.
-- RLS already refuses it (an anonymous caller has no auth.uid(), so "read own"
-- matches nothing), and this makes that a grant-level fact rather than a policy
-- outcome — so a future policy edit cannot quietly re-open it.
-- ---------------------------------------------------------------------------
revoke select on public.profiles from anon;


-- ===========================================================================
-- VERIFY — run these by hand after the swap.
--
-- 1. As an anonymous caller (the publishable key alone), this must now return
--    zero rows rather than the player base:
--
--      curl "$SUPABASE_URL/rest/v1/profiles?select=username,friend_code" \
--           -H "apikey: $SUPABASE_PUBLISHABLE_KEY"
--
-- 2. And this must still return the leaderboard's display data:
--
--      curl "$SUPABASE_URL/rest/v1/profiles_public?select=id,username,avatar_seed" \
--           -H "apikey: $SUPABASE_PUBLISHABLE_KEY"
--
-- 3. `friend_code` must be rejected as an unknown column on the view:
--
--      curl "$SUPABASE_URL/rest/v1/profiles_public?select=friend_code" \
--           -H "apikey: $SUPABASE_PUBLISHABLE_KEY"
-- ===========================================================================
