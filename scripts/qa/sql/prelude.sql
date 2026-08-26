-- Enough of Supabase for `supabase/schema.sql` to be run VERBATIM.
--
-- Nothing here is part of the app. It stands in for the pieces a Supabase
-- project already has when you open its SQL editor — the `auth` schema, the
-- three API roles, and the default privileges the project was created with —
-- so that what gets tested is the schema file itself rather than an edited
-- version of it that happens to run.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

grant usage on schema public, auth to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;

-- `auth.uid()` reads a request-scoped JWT claim in Supabase. A session GUC has
-- the same shape: set per connection, read from inside a policy.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase configures these at project creation, which is why `schema.sql`
-- contains no GRANT of its own and the app still works.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
