-- Membership helpers, Row Level Security, audit trail, immutability.

create or replace function public.app_role(b uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from business_members where business_id = b and user_id = auth.uid()
$$;

create or replace function public.app_is_member(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from business_members where business_id = b and user_id = auth.uid())
$$;

create or replace function public.app_has_role(b uuid, roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from business_members
                 where business_id = b and user_id = auth.uid() and role = any(roles))
$$;

create or replace function public.app_can_see_costs(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from business_members
                 where business_id = b and user_id = auth.uid()
                   and (role in ('owner','admin','accountant','viewer') or can_see_costs))
$$;

create or replace function public.app_require(b uuid, roles text[]) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please sign in.' using errcode = '28000'; end if;
  if not app_has_role(b, roles) then
    raise exception 'You don''t have permission to do this.' using errcode = '42501';
  end if;
end $$;

-- ---------- RLS ----------
do $$ declare t text; begin
  for t in select unnest(array[
    'businesses','profiles','business_members','customers','suppliers','product_categories','products',
    'cash_accounts','expense_categories','purchases','purchase_items','purchase_costs','production_batches',
    'production_costs','cost_layers','inventory_transactions','sales','sale_items','sale_returns',
    'sale_return_items','cost_allocations','cash_transactions','payment_allocations','expenses',
    'recurring_expenses','recurring_expense_payments','budgets','targets','alert_rules','alerts',
    'audit_log','report_exports'])
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Businesses and people
create policy biz_select on public.businesses for select using (app_is_member(id));
create policy biz_update on public.businesses for update using (app_has_role(id, array['owner','admin']));
create policy prof_self on public.profiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy mem_select on public.business_members for select using (app_is_member(business_id));
create policy mem_manage on public.business_members for all
  using (app_has_role(business_id, array['owner','admin'])) with check (app_has_role(business_id, array['owner','admin']));

-- Read access: every member reads their business's rows...
do $$ declare t text; begin
  for t in select unnest(array[
    'customers','suppliers','product_categories','products','cash_accounts','expense_categories',
    'purchases','purchase_items','purchase_costs','production_batches','production_costs',
    'inventory_transactions','sales','sale_returns','cash_transactions','payment_allocations',
    'expenses','recurring_expenses','recurring_expense_payments','budgets','targets','alert_rules',
    'alerts','report_exports'])
  loop
    execute format('create policy member_select on public.%I for select using (app_is_member(business_id))', t);
  end loop;
end $$;

-- ...except cost-bearing tables, which need cost visibility (Sales role can't see costs).
create policy cost_select on public.sale_items for select using (app_can_see_costs(business_id));
create policy cost_select on public.sale_return_items for select using (app_can_see_costs(business_id));
create policy cost_select on public.cost_layers for select using (app_can_see_costs(business_id));
create policy cost_select on public.cost_allocations for select using (app_can_see_costs(business_id));
create policy audit_select on public.audit_log for select
  using (app_has_role(business_id, array['owner','admin','accountant']));

-- Direct writes are allowed only for master data. Documents go through posting functions.
do $$ declare t text; begin
  for t in select unnest(array['suppliers','product_categories','products','cash_accounts',
                               'expense_categories','recurring_expenses','budgets','targets','alert_rules'])
  loop
    execute format('create policy manage_ins on public.%I for insert with check (app_has_role(business_id, array[''owner'',''admin'',''accountant'']))', t);
    execute format('create policy manage_upd on public.%I for update using (app_has_role(business_id, array[''owner'',''admin'',''accountant'']))', t);
  end loop;
end $$;
create policy cust_ins on public.customers for insert with check (app_has_role(business_id, array['owner','admin','accountant','sales']));
create policy cust_upd on public.customers for update using (app_has_role(business_id, array['owner','admin','accountant','sales']));
create policy alerts_upd on public.alerts for update using (app_is_member(business_id));

-- Grants (Supabase grants broadly by default; we are explicit and never grant DELETE on money tables).
grant select on all tables in schema public to authenticated;
grant insert, update on public.profiles, public.business_members, public.customers, public.suppliers,
  public.product_categories, public.products, public.cash_accounts, public.expense_categories,
  public.recurring_expenses, public.budgets, public.targets, public.alert_rules, public.alerts,
  public.businesses to authenticated;
grant delete on public.business_members, public.budgets, public.targets, public.alert_rules to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- ---------- Immutability ----------
create or replace function public.app_block_change() returns trigger language plpgsql as $$
begin raise exception '% records can''t be edited or deleted. Record a correction instead.', tg_table_name; end $$;

create trigger inv_tx_immutable before update or delete on public.inventory_transactions
  for each row execute function public.app_block_change();

create or replace function public.app_block_delete() returns trigger language plpgsql as $$
begin raise exception 'Financial records are never deleted. Void it instead.'; end $$;

do $$ declare t text; begin
  for t in select unnest(array['purchases','purchase_items','purchase_costs','production_batches','production_costs',
    'cost_layers','sales','sale_items','sale_returns','sale_return_items','cost_allocations','cash_transactions',
    'payment_allocations','expenses','recurring_expense_payments','audit_log'])
  loop
    execute format('create trigger no_delete before delete on public.%I for each row execute function public.app_block_delete()', t);
  end loop;
end $$;

-- ---------- Audit ----------
create or replace function public.app_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_action text;
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
begin
  if tg_op = 'INSERT' then v_action := 'insert';
  elsif v_new ? 'voided_at' and (v_old ->> 'voided_at') is null and (v_new ->> 'voided_at') is not null then v_action := 'void';
  else v_action := 'update';
  end if;
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then return new; end if;
  insert into audit_log (business_id, table_name, record_id, action, user_id, old, new, reason)
  values (coalesce((v_new ->> 'business_id')::uuid, (v_old ->> 'business_id')::uuid),
          tg_table_name, coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid),
          v_action, auth.uid(), v_old, v_new, nullif(current_setting('app.reason', true), ''));
  return coalesce(new, old);
end $$;

do $$ declare t text; begin
  for t in select unnest(array['products','cash_accounts','recurring_expenses','purchases','production_batches',
    'sales','sale_items','sale_returns','cash_transactions','expenses','business_members','businesses'])
  loop
    execute format('create trigger audit after insert or update on public.%I for each row execute function public.app_audit()', t);
  end loop;
end $$;
