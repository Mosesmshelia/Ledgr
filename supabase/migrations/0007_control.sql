-- Phase 4: roles & invitations, cost-safe views, stock adjustments, alert state.

-- ============================================================ Team: members & invitations
-- Members are only changed through functions that enforce the ownership rules.
drop policy if exists mem_manage on public.business_members;
revoke insert, update, delete on public.business_members from authenticated;

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  email text not null check (email = lower(trim(email)) and position('@' in email) > 1),
  role text not null check (role in ('admin','accountant','sales','viewer')),
  can_see_costs boolean not null default false,
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz, accepted_by uuid, revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);
create index on public.invitations (business_id);
alter table public.invitations enable row level security;
create policy inv_select on public.invitations for select using (app_has_role(business_id, array['owner','admin']));
grant select on public.invitations to authenticated;
create trigger touch_invitations before update on public.invitations for each row execute function public.app_touch();
create trigger audit after insert or update on public.invitations for each row execute function public.app_audit();

create or replace function public.create_invite(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare v_b uuid := (p->>'business_id')::uuid; v_email text := lower(trim(p->>'email')); v_role text := p->>'role'; v_token text;
begin
  perform app_require(v_b, array['owner','admin']);
  if v_email is null or position('@' in v_email) < 2 then raise exception 'Enter a valid email address.'; end if;
  if v_role not in ('admin','accountant','sales','viewer') then raise exception 'Choose a role.'; end if;
  if exists (select 1 from business_members m join auth.users u on u.id = m.user_id where m.business_id = v_b and lower(u.email) = v_email) then
    raise exception 'This person is already on your team.';
  end if;
  update invitations set revoked_at = now() where business_id = v_b and email = v_email and accepted_at is null and revoked_at is null;
  insert into invitations (business_id, email, role, can_see_costs, created_by)
  values (v_b, v_email, v_role, coalesce((p->>'can_see_costs')::boolean, false), auth.uid())
  returning token into v_token;
  return v_token;
end $$;

create or replace function public.revoke_invite(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_b uuid;
begin
  select business_id into v_b from invitations where id = (p->>'id')::uuid;
  if not found then raise exception 'Invitation not found.'; end if;
  perform app_require(v_b, array['owner','admin']);
  update invitations set revoked_at = now() where id = (p->>'id')::uuid and accepted_at is null;
end $$;

-- Accepting requires being signed in with the invited email address.
create or replace function public.accept_invite(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_inv invitations; v_email text;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  select * into v_inv from invitations where token = p->>'token' for update;
  if not found or v_inv.revoked_at is not null then raise exception 'This invitation is no longer valid.'; end if;
  if v_inv.accepted_at is not null then raise exception 'This invitation has already been used.'; end if;
  if v_inv.expires_at < now() then raise exception 'This invitation has expired. Ask for a new one.'; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email <> v_inv.email then raise exception 'This invitation is for %. Sign in with that email address.', v_inv.email; end if;
  if exists (select 1 from business_members where business_id = v_inv.business_id and user_id = auth.uid()) then
    raise exception 'You''re already on this team.';
  end if;
  insert into business_members (business_id, user_id, role, can_see_costs, created_by)
  values (v_inv.business_id, auth.uid(), v_inv.role, v_inv.can_see_costs, v_inv.created_by);
  update invitations set accepted_at = now(), accepted_by = auth.uid() where id = v_inv.id;
  return v_inv.business_id;
end $$;

-- Change a member's role. Rules: only an owner can make or change owners; the last owner can't be demoted.
create or replace function public.set_member_role(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare m business_members; v_new text := p->>'role'; v_me text;
begin
  select * into m from business_members where id = (p->>'member_id')::uuid for update;
  if not found then raise exception 'Team member not found.'; end if;
  perform app_require(m.business_id, array['owner','admin']);
  v_me := app_role(m.business_id);
  if v_new not in ('owner','admin','accountant','sales','viewer') then raise exception 'Choose a role.'; end if;
  if (m.role = 'owner' or v_new = 'owner') and v_me <> 'owner' then raise exception 'Only an owner can change ownership.'; end if;
  if m.role = 'owner' and v_new <> 'owner' and (select count(*) from business_members where business_id = m.business_id and role = 'owner') = 1 then
    raise exception 'A business needs at least one owner. Make someone else an owner first.';
  end if;
  update business_members set role = v_new, can_see_costs = coalesce((p->>'can_see_costs')::boolean, can_see_costs) where id = m.id;
end $$;

create or replace function public.remove_member(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare m business_members;
begin
  select * into m from business_members where id = (p->>'member_id')::uuid for update;
  if not found then raise exception 'Team member not found.'; end if;
  perform app_require(m.business_id, array['owner','admin']);
  if m.role = 'owner' and app_role(m.business_id) <> 'owner' then raise exception 'Only an owner can remove an owner.'; end if;
  if m.role = 'owner' and (select count(*) from business_members where business_id = m.business_id and role = 'owner') = 1 then
    raise exception 'You can''t remove the only owner.';
  end if;
  perform set_config('app.reason', coalesce(p->>'reason', 'Removed from team'), true);
  insert into audit_log (business_id, table_name, record_id, action, user_id, old, reason)
  values (m.business_id, 'business_members', m.id, 'remove', auth.uid(), to_jsonb(m), current_setting('app.reason', true));
  delete from business_members where id = m.id;
end $$;

-- Team list with emails (auth.users is not readable directly).
create or replace function public.team_members(b uuid)
returns table (member_id uuid, user_id uuid, email text, name text, role text, can_see_costs boolean, joined_at timestamptz, is_me boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app_is_member(b) then raise exception 'You don''t have permission to do this.'; end if;
  return query select m.id, m.user_id, u.email::text, coalesce(pr.full_name, pr.display_name, split_part(u.email, '@', 1))::text, m.role, m.can_see_costs, m.created_at, m.user_id = auth.uid()
    from business_members m join auth.users u on u.id = m.user_id left join profiles pr on pr.user_id = m.user_id
    where m.business_id = b order by case m.role when 'owner' then 1 when 'admin' then 2 when 'accountant' then 3 when 'sales' then 4 else 5 end, m.created_at;
end $$;

-- ============================================================ Cost-safe view for the Sales role
-- Sales staff can't read sale_items (it holds costs). This view exposes the same lines without any cost column.
create or replace view public.v_sale_items_public with (security_barrier = true) as
  select id, business_id, sale_id, product_id, qty, unit_price, line_discount, gross_amount, discount_amount, net_amount, vat_amount, created_at
  from public.sale_items where app_is_member(business_id);
grant select on public.v_sale_items_public to authenticated;

-- ============================================================ Stock adjustments (breakage, spoilage, counting errors)
alter table public.cost_allocations drop constraint cost_allocations_consumer_type_check;
alter table public.cost_allocations add constraint cost_allocations_consumer_type_check check (consumer_type in ('sale_item','production_cost','stock_adjustment'));

create table public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null references public.products(id),
  date date not null,
  qty_change numeric(14,3) not null check (qty_change <> 0),
  unit_cost bigint check (unit_cost >= 0),
  cost_effect bigint not null,                 -- > 0 = stock lost (a cost); < 0 = stock found (reduces cost)
  reason text not null check (length(trim(reason)) >= 3),
  voided_at timestamptz, voided_by uuid, void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);
create index on public.stock_adjustments (business_id, date);
alter table public.stock_adjustments enable row level security;
create policy cost_select on public.stock_adjustments for select using (app_can_see_costs(business_id));
grant select on public.stock_adjustments to authenticated;
create trigger touch_stock_adjustments before update on public.stock_adjustments for each row execute function public.app_touch();
create trigger audit after insert or update on public.stock_adjustments for each row execute function public.app_audit();
create trigger no_delete before delete on public.stock_adjustments for each row execute function public.app_block_delete();

create or replace function public.post_stock_adjustment(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_b uuid := (p->>'business_id')::uuid; v_prod products; v_q numeric := (p->>'qty_change')::numeric;
  v_date date := coalesce((p->>'date')::date, current_date); v_adj uuid; c record; v_cost bigint; v_avail numeric;
begin
  perform app_require(v_b, array['owner','admin','accountant']);
  select * into v_prod from products where id = (p->>'product_id')::uuid and business_id = v_b for update;
  if not found then raise exception 'Product not found.'; end if;
  if v_q is null or v_q = 0 then raise exception 'Enter how many to add or remove.'; end if;
  if length(trim(coalesce(p->>'reason', ''))) < 3 then raise exception 'Please give a reason (e.g. "3 bottles broke").'; end if;

  insert into stock_adjustments (business_id, product_id, date, qty_change, unit_cost, cost_effect, reason, created_by)
  values (v_b, v_prod.id, v_date, v_q, (p->>'unit_cost')::bigint, 0, trim(p->>'reason'), auth.uid()) returning id into v_adj;

  if v_q < 0 then
    v_avail := app_available_qty(v_prod.id);
    if -v_q > v_avail then raise exception 'You only have % % of % in stock.', trim(to_char(greatest(v_avail, 0), 'FM999999990.###')), v_prod.unit, v_prod.name; end if;
    select * into c from app_consume_fifo(v_b, v_prod.id, -v_q, 'stock_adjustment', v_adj);
    v_cost := c.cost;
    update stock_adjustments set cost_effect = v_cost where id = v_adj;
    insert into inventory_transactions (business_id, product_id, date, kind, qty_change, cost_change, source_type, source_id, note, created_by)
    values (v_b, v_prod.id, v_date, 'adjustment', v_q, -v_cost, 'stock_adjustment', v_adj, trim(p->>'reason'), auth.uid());
  else
    if (p->>'unit_cost')::bigint is null or (p->>'unit_cost')::bigint < 0 then raise exception 'Enter what each unit is worth (its cost).'; end if;
    v_cost := round(v_q * (p->>'unit_cost')::bigint)::bigint;
    update stock_adjustments set cost_effect = -v_cost where id = v_adj;
    insert into cost_layers (business_id, product_id, source_type, source_id, layer_date, qty_in, qty_remaining, total_cost, created_by)
    values (v_b, v_prod.id, 'adjustment', v_adj, v_date, v_q, v_q, v_cost, auth.uid());
    insert into inventory_transactions (business_id, product_id, date, kind, qty_change, cost_change, source_type, source_id, note, created_by)
    values (v_b, v_prod.id, v_date, 'adjustment', v_q, v_cost, 'stock_adjustment', v_adj, trim(p->>'reason'), auth.uid());
    perform app_settle_backorders(v_b, v_prod.id);
  end if;
  return v_adj;
end $$;

-- Extend void_document with stock adjustments (other types unchanged).
create or replace function public.void_stock_adjustment(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a stock_adjustments; v_reason text := trim(coalesce(p->>'reason', ''));
begin
  select * into a from stock_adjustments where id = (p->>'id')::uuid and voided_at is null for update;
  if not found then raise exception 'Adjustment not found or already voided.'; end if;
  perform app_require(a.business_id, array['owner','admin','accountant']);
  if length(v_reason) < 3 then raise exception 'Please give a reason for voiding.'; end if;
  perform set_config('app.reason', v_reason, true);
  perform 1 from products where id = a.product_id for update;
  if a.qty_change < 0 then
    perform app_restore_allocations('stock_adjustment', a.id);
    perform app_settle_backorders(a.business_id, a.product_id);
  else
    if exists (select 1 from cost_layers where source_type = 'adjustment' and source_id = a.id and qty_remaining < qty_in) then
      raise exception 'Some of this stock has already been sold, so the adjustment can''t be voided.';
    end if;
    update cost_layers set voided_at = now() where source_type = 'adjustment' and source_id = a.id;
  end if;
  insert into inventory_transactions (business_id, product_id, date, kind, qty_change, cost_change, source_type, source_id, note, created_by)
  values (a.business_id, a.product_id, current_date, 'void_reversal', -a.qty_change, a.cost_effect, 'stock_adjustment', a.id, v_reason, auth.uid());
  update stock_adjustments set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = a.id;
end $$;

-- ---------- Reports now include stock adjustments in cost of goods ----------
create or replace function public.fin_stock_adjustments_total(b uuid, p_from date, p_to date) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_effect), 0)::bigint from stock_adjustments
  where business_id = b and voided_at is null and date between p_from and p_to
$$;

-- Wrap fin_pnl: same output plus stock_adjustments.
alter function public.fin_pnl(uuid, date, date) rename to fin_pnl_base;
create or replace function public.fin_pnl(b uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return fin_pnl_base(b, p_from, p_to) || jsonb_build_object('stock_adjustments', fin_stock_adjustments_total(b, p_from, p_to));
end $$;

-- Daily series: adjustments count in cost of goods on their date.
alter function public.fin_daily_series(uuid, date, date) rename to fin_daily_series_base;
create or replace function public.fin_daily_series(b uuid, p_from date, p_to date)
returns table (day date, revenue bigint, cogs_known bigint, revenue_missing_cost bigint, opex bigint, other_net bigint, cash_in bigint, cash_out bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  select s.day, s.revenue, (s.cogs_known + coalesce(a.amt, 0))::bigint, s.revenue_missing_cost, s.opex, s.other_net, s.cash_in, s.cash_out
  from fin_daily_series_base(b, p_from, p_to) s
  left join (select date d, sum(cost_effect) amt from stock_adjustments where business_id = b and voided_at is null and date between p_from and p_to group by 1) a on a.d = s.day
  order by 1;
end $$;

-- Stock value at a date: adjustment write-offs are consumption too.
create or replace function public.app_consumer_date(p_type text, p_id uuid) returns date
language sql stable security definer set search_path = public as $$
  select case p_type
    when 'sale_item' then (select s.date from sale_items si join sales s on s.id = si.sale_id where si.id = p_id)
    when 'production_cost' then (select pb.date from production_costs pc join production_batches pb on pb.id = pc.batch_id where pc.id = p_id)
    when 'stock_adjustment' then (select date from stock_adjustments where id = p_id)
  end
$$;

create or replace function public.fin_inventory_value_at(b uuid, p_as_of date) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare v bigint;
begin
  perform app_require_reader(b);
  select coalesce(sum(cl.total_cost), 0)
       - coalesce((select sum(ca.cost) from cost_allocations ca join cost_layers l2 on l2.id = ca.cost_layer_id
                   where l2.business_id = b and l2.voided_at is null and ca.reversed_at is null and app_consumer_date(ca.consumer_type, ca.consumer_id) <= p_as_of), 0)
  into v from cost_layers cl where cl.business_id = b and cl.voided_at is null and cl.layer_date <= p_as_of;
  return v;
end $$;

create or replace function public.fin_inventory_summary(b uuid, p_from date, p_to date)
returns table (product_id uuid, name text, unit text, is_sellable boolean, opening numeric, purchased numeric, produced numeric,
               used numeric, sold numeric, returned numeric, adjusted numeric, closing numeric, closing_value bigint, min_stock numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform app_require_reader(b);
  return query
  with t as (
    select it.product_id,
      sum(it.qty_change) filter (where it.date < p_from) op,
      sum(it.qty_change) filter (where it.date between p_from and p_to and it.kind in ('purchase','opening')) pu,
      sum(it.qty_change) filter (where it.date between p_from and p_to and it.kind = 'production') pr,
      sum(it.qty_change) filter (where it.date between p_from and p_to and it.kind = 'production_use') us,
      sum(it.qty_change) filter (where it.date between p_from and p_to and it.kind = 'sale') so,
      sum(it.qty_change) filter (where it.date between p_from and p_to and it.kind = 'return') re,
      sum(it.qty_change) filter (where it.date between p_from and p_to and it.kind in ('adjustment','void_reversal')) ad,
      sum(it.qty_change) filter (where it.date <= p_to) cl
    from inventory_transactions it where it.business_id = b group by 1
  ), v as (
    select cl.product_id,
      sum(cl.total_cost) - coalesce(sum((select sum(ca.cost) from cost_allocations ca where ca.cost_layer_id = cl.id and ca.reversed_at is null
        and app_consumer_date(ca.consumer_type, ca.consumer_id) <= p_to)), 0) val
    from cost_layers cl where cl.business_id = b and cl.voided_at is null and cl.layer_date <= p_to group by 1
  )
  select p.id, p.name, p.unit, p.is_sellable,
    coalesce(t.op, 0), coalesce(t.pu, 0), coalesce(t.pr, 0), -coalesce(t.us, 0), -coalesce(t.so, 0), coalesce(t.re, 0), coalesce(t.ad, 0),
    coalesce(t.cl, 0), coalesce(v.val, 0)::bigint, p.min_stock
  from products p left join t on t.product_id = p.id left join v on v.product_id = p.id
  where p.business_id = b and p.is_active
  order by p.is_sellable desc, p.name;
end $$;

-- ============================================================ Alerts
alter table public.alerts add column if not exists dedupe_key text;
create unique index if not exists alerts_dedupe on public.alerts (business_id, dedupe_key);
create unique index if not exists alert_rules_kind on public.alert_rules (business_id, kind);

-- Store the current set of active alerts: new ones are added, ones no longer true are resolved.
create or replace function public.sync_alerts(b uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a jsonb; keys text[] := '{}';
begin
  if not app_is_member(b) then raise exception 'You don''t have permission to do this.'; end if;
  for a in select * from jsonb_array_elements(p) loop
    keys := keys || (a->>'key');
    insert into alerts (business_id, kind, severity, message, data, dedupe_key)
    values (b, a->>'kind', coalesce(a->>'severity', 'info'), a->>'message', coalesce(a->'data', '{}'::jsonb), a->>'key')
    on conflict (business_id, dedupe_key) do update set message = excluded.message, data = excluded.data, severity = excluded.severity,
      resolved_at = null;
  end loop;
  update alerts set resolved_at = now() where business_id = b and resolved_at is null and not (dedupe_key = any(keys));
end $$;

grant execute on all functions in schema public to authenticated, service_role;
revoke execute on all functions in schema public from anon;
