-- Minimal Supabase-shaped harness: the roles, the auth schema, and auth.uid()
-- reading the same request.jwt.claim.sub GUC that Supabase's PostgREST sets.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- Supabase's auth.uid(): the `sub` claim of the request's JWT, or NULL.
create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;

-- Act as a signed-in user / an anonymous visitor, the way PostgREST does.
create or replace function public.act_as(u uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, false);
  execute 'set role authenticated';
end $$;

create or replace function public.act_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'set role anon';
end $$;
