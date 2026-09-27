-- Hosting: the web app connects with its own restricted database login (not the superuser).
-- The few steps that must read auth.users (sign-in, sign-up, invitation lookup) go through these
-- narrow SECURITY DEFINER functions, which only the app's server role may run — never the public API.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'ledgr_server') then create role ledgr_server nologin; end if;
end $$;

-- Returns the user's id if the email + password match, otherwise null. Timing is the same either way.
create or replace function public.app_sign_in(p_email text, p_password text) returns uuid
language sql stable security definer set search_path = public, extensions as $$
  select id from auth.users
  where lower(email) = lower(trim(p_email)) and encrypted_password = extensions.crypt(p_password, encrypted_password)
  limit 1
$$;

-- Creates a user with a bcrypt-hashed password and their profile. Works on local Postgres and on Supabase
-- (whose auth.users has extra columns such as aud and role).
create or replace function public.app_sign_up(p_email text, p_password text, p_name text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid := gen_random_uuid(); v_email text := lower(trim(p_email)); supa boolean;
begin
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'An account with this email already exists. Sign in instead.';
  end if;
  select exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'aud') into supa;
  if supa then
    execute 'insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
             values (''00000000-0000-0000-0000-000000000000'', $1, ''authenticated'', ''authenticated'', $2, extensions.crypt($3, extensions.gen_salt(''bf'')), now(),
                     ''{"provider":"email","providers":["email"]}'', jsonb_build_object(''full_name'', $4::text), now(), now())'
      using v_id, v_email, p_password, p_name;
  else
    insert into auth.users (id, email, encrypted_password, raw_user_meta_data)
    values (v_id, v_email, extensions.crypt(p_password, extensions.gen_salt('bf')), jsonb_build_object('full_name', p_name));
  end if;
  insert into public.profiles (user_id, full_name, display_name) values (v_id, p_name, split_part(p_name, ' ', 1)) on conflict do nothing;
  return v_id;
end $$;

-- What an invitation link shows before sign-in: business name, role, invited email, validity. The token is the secret.
create or replace function public.app_invite_info(p_token text)
returns table (email text, role text, expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz, business text)
language sql stable security definer set search_path = public as $$
  select i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at, b.name
  from invitations i join businesses b on b.id = i.business_id where i.token = p_token
$$;

create or replace function public.app_user_email(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select email from auth.users where id = p_user
$$;

revoke execute on function public.app_sign_in(text, text), public.app_sign_up(text, text, text),
  public.app_invite_info(text), public.app_user_email(uuid) from public, anon, authenticated;
grant execute on function public.app_sign_in(text, text), public.app_sign_up(text, text, text),
  public.app_invite_info(text), public.app_user_email(uuid) to ledgr_server;
