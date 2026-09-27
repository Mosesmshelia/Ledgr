-- LOCAL DEVELOPMENT ONLY. Do not run on Supabase (it already provides all of this).
-- Recreates the small part of Supabase's environment our migrations rely on:
-- roles (anon, authenticated, service_role), auth.users, auth.uid(), pgcrypto.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  encrypted_password text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Same contract as Supabase: the current user id comes from the JWT claims setting.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(coalesce(
    current_setting('request.jwt.claim.sub', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  ), '')::uuid
$$;

grant usage on schema public to anon, authenticated, service_role;
