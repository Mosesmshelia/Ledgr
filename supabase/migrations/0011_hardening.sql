-- Hardening flagged by Supabase's security advisor.
-- 1. Ledgr never uses Supabase's public REST API: the web app talks to Postgres directly. Signed-out
--    visitors (anon) get no access to any function, now or in future migrations. (Every function already
--    refused anonymous callers with "Please sign in"; this removes the door entirely.)
revoke execute on all functions in schema public from anon, public;
alter default privileges in schema public revoke execute on functions from anon, public;

-- 2. Pin search_path on the remaining helper functions so they can't be redirected.
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('app_share','app_touch','app_block_change','app_block_delete','app_cum','app_naira','app_sale_lines','app_alert_reset')
  loop execute format('alter function %s set search_path = public', f); end loop;
end $$;

-- 3. Server-only functions stay executable only by the app's server role (re-stated after the blanket revoke).
grant execute on function public.app_sign_in(text, text), public.app_sign_up(text, text, text),
  public.app_invite_info(text), public.app_user_email(uuid) to ledgr_server;

-- Note: v_sale_items_public is intentionally a definer view — it is how the Sales role sees sale lines
-- WITHOUT cost columns; it filters to the viewer's own business (app_is_member).
