-- Phase 4b: settings go through a function (so invoice numbering can't be tampered with), categories can be
-- archived (never deleted), alerts are hidden from roles that can't see costs, and more tables are audited.

-- ============================================================ Business settings
revoke update on public.businesses from authenticated;
drop policy if exists biz_update on public.businesses;

create or replace function public.update_business_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_b uuid := (p->>'business_id')::uuid;
begin
  perform app_require(v_b, array['owner','admin']);
  if p ? 'name' and length(trim(coalesce(p->>'name', ''))) = 0 then raise exception 'Business name can''t be empty.'; end if;
  if p ? 'vat_rate_bp' and ((p->>'vat_rate_bp')::int < 0 or (p->>'vat_rate_bp')::int > 10000) then raise exception 'VAT rate must be between 0%% and 100%%.'; end if;
  perform set_config('app.reason', coalesce(nullif(p->>'reason', ''), 'Settings updated'), true);
  update businesses set
    name = case when p ? 'name' then trim(p->>'name') else name end,
    business_type = case when p ? 'business_type' then nullif(trim(p->>'business_type'), '') else business_type end,
    owner_name = case when p ? 'owner_name' then nullif(trim(p->>'owner_name'), '') else owner_name end,
    phone = case when p ? 'phone' then nullif(trim(p->>'phone'), '') else phone end,
    email = case when p ? 'email' then nullif(lower(trim(p->>'email')), '') else email end,
    address = case when p ? 'address' then nullif(trim(p->>'address'), '') else address end,
    week_start = coalesce((p->>'week_start')::smallint, week_start),
    fy_start_month = coalesce((p->>'fy_start_month')::smallint, fy_start_month),
    vat_registered = coalesce((p->>'vat_registered')::boolean, vat_registered),
    vat_rate_bp = coalesce((p->>'vat_rate_bp')::int, vat_rate_bp),
    prices_include_vat = coalesce((p->>'prices_include_vat')::boolean, prices_include_vat),
    default_payment_terms_days = coalesce((p->>'default_payment_terms_days')::int, default_payment_terms_days),
    onboarding_completed_at = case when coalesce((p->>'onboarding_complete')::boolean, false)
      then coalesce(onboarding_completed_at, now()) else onboarding_completed_at end,
    updated_at = now()
  where id = v_b;
end $$;

-- ============================================================ Categories: archive, never delete
alter table public.expense_categories add column if not exists is_active boolean not null default true;
alter table public.product_categories add column if not exists is_active boolean not null default true;

-- ============================================================ Alerts
drop policy if exists member_select on public.alerts;
drop policy if exists alerts_upd on public.alerts;
revoke insert, update on public.alerts from authenticated;
-- Alerts built from costs/profit (over budget, margin, loss) are only visible to people who can see costs.
create policy alerts_select on public.alerts for select using (
  app_is_member(business_id) and (coalesce((data->>'costs')::boolean, false) = false or app_can_see_costs(business_id)));

-- Only roles that can see the full picture refresh alerts, so no one can plant a fake alert.
create or replace function public.sync_alerts(b uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a jsonb; keys text[] := '{}';
begin
  perform app_require(b, array['owner','admin','accountant']);
  for a in select * from jsonb_array_elements(p) loop
    keys := keys || (a->>'key');
    insert into alerts (business_id, kind, severity, message, data, dedupe_key)
    values (b, a->>'kind', coalesce(a->>'severity', 'info'), a->>'message', coalesce(a->'data', '{}'::jsonb), a->>'key')
    on conflict (business_id, dedupe_key) do update set message = excluded.message, data = excluded.data, severity = excluded.severity,
      resolved_at = null, updated_at = now();
  end loop;
  update alerts set resolved_at = now(), updated_at = now()
  where business_id = b and resolved_at is null and not (dedupe_key = any(keys));
end $$;

-- Dismiss = mark read. It stays dismissed until the situation clears and comes back.
create or replace function public.dismiss_alert(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_a alerts;
begin
  select * into v_a from alerts where id = (p->>'id')::uuid;
  if not found or not app_is_member(v_a.business_id) then raise exception 'Alert not found.'; end if;
  update alerts set read_at = now(), updated_at = now() where id = v_a.id;
end $$;

-- When an alert resolves, clear its "dismissed" flag so a new occurrence shows again.
create or replace function public.app_alert_reset() returns trigger language plpgsql as $$
begin
  if old.resolved_at is null and new.resolved_at is not null then new.read_at := null; end if;
  return new;
end $$;
drop trigger if exists alert_reset on public.alerts;
create trigger alert_reset before update on public.alerts for each row execute function public.app_alert_reset();

-- ============================================================ Audit: more tables, and cost privacy in the log
do $$ declare t text; begin
  for t in select unnest(array['targets','alert_rules','budgets','customers','suppliers','expense_categories','product_categories'])
  loop
    execute format('drop trigger if exists audit on public.%I', t);
    execute format('create trigger audit after insert or update on public.%I for each row execute function public.app_audit()', t);
  end loop;
end $$;

drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select using (
  app_has_role(business_id, array['owner','admin','accountant'])
  and (table_name not in ('sale_items','stock_adjustments','cost_layers','purchases','production_batches') or app_can_see_costs(business_id)));

-- Audit viewer: rows with the person's name, newest first, filterable.
create or replace function public.audit_entries(b uuid, p jsonb default '{}'::jsonb)
returns table (id bigint, at timestamptz, table_name text, record_id uuid, action text, user_id uuid, user_name text,
               reason text, old jsonb, new jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app_require_reader(b);
  if not app_has_role(b, array['owner','admin','accountant']) then raise exception 'You don''t have permission to do this.' using errcode = '42501'; end if;
  return query
  select a.id, a.at, a.table_name, a.record_id, a.action, a.user_id,
    coalesce(pr.display_name, pr.full_name, u.raw_user_meta_data->>'full_name', u.email, 'System'),
    a.reason, a.old, a.new
  from audit_log a
  left join auth.users u on u.id = a.user_id
  left join profiles pr on pr.user_id = a.user_id
  where a.business_id = b
    and (p->>'table' is null or a.table_name = p->>'table')
    and (p->>'action' is null or a.action = p->>'action')
    and (p->>'user_id' is null or a.user_id = (p->>'user_id')::uuid)
    and (p->>'record_id' is null or a.record_id = (p->>'record_id')::uuid)
    and (p->>'from' is null or a.at >= ((p->>'from')::date::timestamp at time zone 'Africa/Lagos'))
    and (p->>'to' is null or a.at < (((p->>'to')::date + 1)::timestamp at time zone 'Africa/Lagos'))
    and (p->>'before' is null or a.id < (p->>'before')::bigint)
    and (a.table_name not in ('sale_items','stock_adjustments','cost_layers','purchases','production_batches') or app_can_see_costs(b))
  order by a.id desc
  limit least(coalesce((p->>'limit')::int, 50), 200);
end $$;

grant execute on all functions in schema public to authenticated, service_role;
revoke execute on all functions in schema public from anon;

-- Audit rows for the businesses table itself carry its own id as business_id (it has no business_id column).
create or replace function public.app_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_action text;
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_b uuid;
begin
  if tg_op = 'INSERT' then v_action := 'insert';
  elsif v_new ? 'voided_at' and (v_old ->> 'voided_at') is null and (v_new ->> 'voided_at') is not null then v_action := 'void';
  else v_action := 'update';
  end if;
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then return new; end if;
  v_b := case when tg_table_name = 'businesses' then coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid)
              else coalesce((v_new ->> 'business_id')::uuid, (v_old ->> 'business_id')::uuid) end;
  insert into audit_log (business_id, table_name, record_id, action, user_id, old, new, reason)
  values (v_b, tg_table_name, coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid),
          v_action, auth.uid(), v_old, v_new, nullif(current_setting('app.reason', true), ''));
  return coalesce(new, old);
end $$;
