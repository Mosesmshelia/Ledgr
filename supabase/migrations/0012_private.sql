-- Private use: once the first account exists, only invited people can join; repeated wrong passwords are slowed down.

-- Failed sign-ins, kept for 15 minutes. Nobody can read it through the API (RLS on, no policies, no grants).
create table if not exists public.login_failures (
  email text not null,
  at timestamptz not null default now()
);
create index if not exists login_failures_email_at on public.login_failures (email, at);
alter table public.login_failures enable row level security;
revoke all on public.login_failures from anon, authenticated, public;

-- Sign-in with a lock-out: 8 wrong passwords for one email within 15 minutes → refused for the rest of that window.
create or replace function public.app_sign_in(p_email text, p_password text) returns uuid
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_email text := lower(trim(p_email)); v_id uuid;
begin
  delete from login_failures where at < now() - interval '1 day';
  if (select count(*) from login_failures where email = v_email and at > now() - interval '15 minutes') >= 8 then
    raise exception 'Too many wrong passwords. Please wait 15 minutes and try again.';
  end if;
  select id into v_id from auth.users
  where lower(email) = v_email and encrypted_password = extensions.crypt(p_password, encrypted_password) limit 1;
  if v_id is null then
    insert into login_failures (email) values (v_email);
  else
    delete from login_failures where email = v_email;
  end if;
  return v_id;
end $$;

-- A valid (unused, not cancelled, not expired) invitation exists for this email.
create or replace function public.app_has_invite(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from invitations where email = lower(trim(p_email))
                 and accepted_at is null and revoked_at is null and expires_at > now())
$$;

-- Nobody has an account yet (the very first person to sign up becomes the owner).
create or replace function public.app_is_fresh() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from auth.users)
$$;

-- May this user enter the app in invite-only mode? Members, people with a pending invitation,
-- and the first user while no business exists yet (finishing setup).
create or replace function public.app_user_has_access(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from business_members where user_id = p_user)
      or public.app_has_invite((select email from auth.users where id = p_user))
      or not exists (select 1 from businesses)
$$;

revoke execute on function public.app_sign_in(text, text), public.app_has_invite(text), public.app_is_fresh(), public.app_user_has_access(uuid)
  from public, anon, authenticated;
grant execute on function public.app_sign_in(text, text), public.app_has_invite(text), public.app_is_fresh(), public.app_user_has_access(uuid)
  to ledgr_server;
