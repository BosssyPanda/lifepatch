-- ===========================================================================
-- LifePatch — somewhere for the rename limiter to keep score.
--
--   RUN THIS BEFORE REDEPLOYING THE `profile` FUNCTION. The order is the
--   opposite of 05's and for the mirror-image reason: 05 took a write away from
--   the browser and had to wait for the function; this gives the function two
--   columns and has to go first, because the version that reads them cannot run
--   until they exist.
--
--     # apply this file
--     supabase functions deploy profile --project-ref <ref>
--
-- Running it early is free: both columns are nullable/defaulted, nothing reads
-- them until the new function is live, and no build references them. Running it
-- late breaks `rename` for everyone until it lands.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- The hole, which is a small one and was described rather than fixed.
--
-- `rename` has no rate limit, and it answers 409 for "that name is taken" and 400
-- for "the filter refuses that name". Two distinguishable answers plus unlimited
-- attempts is an oracle: one signed-in account can walk the username space a
-- request at a time and learn who exists.
--
-- WHY NOT JUST COLLAPSE THE 409 INTO THE 400. Because the 409 is doing honest work.
-- A player who picks a taken name needs to be told it is taken, or they are left
-- staring at a rejection that reads as "your name is offensive". Closing the oracle
-- by lying to the player trades a small leak for a real usability defect.
--
-- So the answers stay honest and the ATTEMPTS get bounded. Five per hour is past
-- anything a person does — renaming is a once-in-a-while act — and turns walking
-- the space into 120 guesses a day per account, which is not a walk.
--
-- WHY IN THE DATABASE. An Edge Function is stateless and horizontally scaled: an
-- in-memory counter is per-isolate, so the limit it enforces is "five per hour per
-- isolate you happen to land on", which is not a limit. These two columns are the
-- smallest durable place to put it, and `profiles` is already the row the function
-- reads and writes on this path.
--
-- The counter is bumped BEFORE the uniqueness check, not after a success — a probe
-- for a taken name IS the attack, and it returns 409, so a counter that only
-- counted successful renames would count none of it.
--
-- NOTHING NEW IS READABLE. `profiles` is `read own` since migration 02, so a player
-- sees these on their own row and nowhere else; `profiles_public` projects four
-- columns and neither is among them. Nothing is newly WRITABLE either: 04 and 05
-- between them left `authenticated` with no INSERT or UPDATE on this table at all,
-- so the service role the function uses is the only writer, which is the same
-- position `username` itself is in.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists rename_window_start timestamptz;

alter table public.profiles
  add column if not exists rename_attempts int not null default 0;

-- NO REVOKE HERE, deliberately, and it is worth saying why rather than leaving the
-- absence to be read as an oversight. The reflex is `revoke update (...) from
-- authenticated` as belt and braces. It would be theatre: 04 and 05 already left
-- both roles with no UPDATE on this table at all, so there is nothing to revoke —
-- PostgreSQL answers a column-level REVOKE against no grant with a warning and no
-- change — and a REVOKE is not a standing rule, so it would do nothing to protect
-- these columns from a future migration that re-grants UPDATE. The protection is
-- that the table grant is empty and 04 §2 documents how it has to be kept that way.
