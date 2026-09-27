-- Phase 2 read functions: customer & supplier statements, stock movements, FIFO layers, production list.

-- Customer statement: every invoice, payment, return and refund with a running balance.
-- Positive balance = the customer owes you. Negative = you hold their money (credit).
create or replace function public.fin_customer_statement(b uuid, p_customer uuid, p_from date, p_to date)
returns table (date date, kind text, ref text, description text, doc_id uuid, debit bigint, credit bigint, balance bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app_require(b, array['owner','admin','accountant','viewer','sales']);
  if not exists (select 1 from customers where id = p_customer and business_id = b) then raise exception 'Customer not found.'; end if;
  return query
  with ev as (
    select s.date d, 1 ord, 'invoice'::text k, s.invoice_no r,
           (select string_agg(p.name || ' ×' || trim(to_char(si.qty, 'FM999999990.###')), ', ') from sale_items si join products p on p.id = si.product_id where si.sale_id = s.id) descr,
           s.id doc, s.total dr, 0::bigint cr, s.created_at ts
    from sales s where s.business_id = b and s.customer_id = p_customer and s.voided_at is null
    union all
    select ct.date, 2, 'payment', coalesce(ct.reference, ''), 'Into ' || a.name, ct.id, 0, ct.amount, ct.created_at
    from cash_transactions ct join cash_accounts a on a.id = ct.account_id
    where ct.business_id = b and ct.customer_id = p_customer and ct.kind = 'customer_payment' and ct.voided_at is null
    union all
    select r.date, 3, 'return', s.invoice_no, r.reason, r.id, 0, r.total, r.created_at
    from sale_returns r join sales s on s.id = r.sale_id
    where r.business_id = b and s.customer_id = p_customer and r.voided_at is null and s.voided_at is null
    union all
    select ct.date, 4, 'refund', coalesce(ct.reference, ''), 'From ' || a.name, ct.id, ct.amount, 0, ct.created_at
    from cash_transactions ct join cash_accounts a on a.id = ct.account_id
    where ct.business_id = b and ct.customer_id = p_customer and ct.kind = 'refund' and ct.voided_at is null
  ), running as (
    select ev.*, sum(dr - cr) over (order by d, ord, ts rows unbounded preceding) bal from ev
  )
  select * from (
    select p_from, 'opening'::text, ''::text, 'Balance brought forward'::text, null::uuid, 0::bigint, 0::bigint,
           coalesce((select bal from running where d < p_from order by d desc, ord desc, ts desc limit 1), 0)::bigint
    union all
    select d, k, r, descr, doc, dr, cr, bal::bigint from running where d between p_from and p_to
  ) x;
end $$;

-- Supplier statement. Positive balance = you owe the supplier.
create or replace function public.fin_supplier_statement(b uuid, p_supplier uuid, p_from date, p_to date)
returns table (date date, kind text, ref text, description text, doc_id uuid, debit bigint, credit bigint, balance bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app_require_reader(b);
  if not exists (select 1 from suppliers where id = p_supplier and business_id = b) then raise exception 'Supplier not found.'; end if;
  return query
  with ev as (
    select p.date d, 1 ord, 'purchase'::text k, coalesce(p.supplier_invoice_no, '') r,
           (select string_agg(pr.name || ' ×' || trim(to_char(pi.qty, 'FM999999990.###')), ', ') from purchase_items pi join products pr on pr.id = pi.product_id where pi.purchase_id = p.id) descr,
           p.id doc, 0::bigint dr, p.total cr, p.created_at ts
    from purchases p where p.business_id = b and p.supplier_id = p_supplier and p.voided_at is null
    union all
    select ct.date, 2, 'payment', coalesce(ct.reference, ''), 'From ' || a.name, ct.id, ct.amount, 0, ct.created_at
    from cash_transactions ct join cash_accounts a on a.id = ct.account_id
    where ct.business_id = b and ct.supplier_id = p_supplier and ct.kind = 'supplier_payment' and ct.voided_at is null
  ), running as (
    select ev.*, sum(cr - dr) over (order by d, ord, ts rows unbounded preceding) bal from ev
  )
  select * from (
    select p_from, 'opening'::text, ''::text, 'Balance brought forward'::text, null::uuid, 0::bigint, 0::bigint,
           coalesce((select bal from running where d < p_from order by d desc, ord desc, ts desc limit 1), 0)::bigint
    union all
    select d, k, r, descr, doc, dr, cr, bal::bigint from running where d between p_from and p_to
  ) x;
end $$;

-- Stock movements for one product with a running quantity; `seq` gives the true order (newest = highest).
drop function if exists public.fin_stock_movements(uuid, uuid);
create or replace function public.fin_stock_movements(b uuid, p_product uuid)
returns table (seq bigint, id uuid, date date, kind text, qty_change numeric, cost_change bigint, balance numeric, ref text, doc_id uuid, doc_type text, note text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app_require_reader(b);
  return query
  select row_number() over (order by it.date, it.created_at, it.id), it.id, it.date, it.kind, it.qty_change, it.cost_change,
    sum(it.qty_change) over (order by it.date, it.created_at, it.id rows unbounded preceding),
    case it.source_type
      when 'sale_item' then (select s.invoice_no from sale_items si join sales s on s.id = si.sale_id where si.id = it.source_id)
      when 'purchase_item' then (select coalesce(su.name, 'Purchase') || coalesce(' · ' || p.supplier_invoice_no, '') from purchase_items pi join purchases p on p.id = pi.purchase_id left join suppliers su on su.id = p.supplier_id where pi.id = it.source_id)
      when 'production_batch' then (select pb.batch_no from production_batches pb where pb.id = it.source_id)
      when 'production_cost' then (select pb.batch_no || ' · ' || pr.name from production_costs pc join production_batches pb on pb.id = pc.batch_id join products pr on pr.id = pb.product_id where pc.id = it.source_id)
      when 'sale_return_item' then (select s.invoice_no from sale_return_items ri join sale_items si on si.id = ri.sale_item_id join sales s on s.id = si.sale_id where ri.id = it.source_id)
      else null end,
    case it.source_type
      when 'sale_item' then (select si.sale_id from sale_items si where si.id = it.source_id)
      when 'sale_return_item' then (select si.sale_id from sale_return_items ri join sale_items si on si.id = ri.sale_item_id where ri.id = it.source_id)
      when 'production_batch' then it.source_id
      when 'production_cost' then (select pc.batch_id from production_costs pc where pc.id = it.source_id)
      else null end,
    case it.source_type when 'sale_item' then 'sale' when 'sale_return_item' then 'sale' when 'production_batch' then 'production' when 'production_cost' then 'production' when 'purchase_item' then 'purchase' else it.source_type end,
    it.note
  from inventory_transactions it
  where it.business_id = b and it.product_id = p_product;
end $$;

-- The FIFO queue: stock layers still on hand for a product, oldest first (sold next).
create or replace function public.fin_cost_layers(b uuid, p_product uuid)
returns table (id uuid, source_type text, layer_date date, qty_in numeric, qty_remaining numeric, total_cost bigint, remaining_value bigint, unit_cost numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app_require_reader(b);
  return query
  select cl.id, cl.source_type, cl.layer_date, cl.qty_in, cl.qty_remaining, cl.total_cost, (cl.total_cost - cl.consumed_cost)::bigint,
         round(cl.total_cost / cl.qty_in, 2)
  from cost_layers cl
  where cl.business_id = b and cl.product_id = p_product and cl.voided_at is null and cl.qty_remaining > 0
  order by cl.layer_date, cl.created_at, cl.id;
end $$;

grant execute on all functions in schema public to authenticated, service_role;
revoke execute on all functions in schema public from anon;

-- Daily series now also carries "other items" (other income − other expenses − income tax) so the
-- net profit trend matches the P&L exactly.
drop function if exists public.fin_daily_series(uuid, date, date);
create or replace function public.fin_daily_series(b uuid, p_from date, p_to date)
returns table (day date, revenue bigint, cogs_known bigint, revenue_missing_cost bigint, opex bigint, other_net bigint, cash_in bigint, cash_out bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app_require_reader(b);
  return query
  with days as (select gs::date d from generate_series(p_from, p_to, interval '1 day') gs),
  sl as (select sa.date d, sum(si.net_amount) rev, sum(si.cogs) cogs, sum(si.net_amount) filter (where si.cogs is null) miss
         from sale_items si join sales sa on sa.id = si.sale_id
         where sa.business_id = b and sa.voided_at is null and sa.date between p_from and p_to group by 1),
  rt as (select r.date d, sum(ri.net_reversed) rev, sum(ri.cogs_reversed) cogs, sum(ri.net_reversed) filter (where ri.cogs_reversed is null) miss
         from sale_return_items ri join sale_returns r on r.id = ri.return_id join sales sa on sa.id = r.sale_id
         where r.business_id = b and r.voided_at is null and sa.voided_at is null and r.date between p_from and p_to group by 1),
  ex as (select e.date d, sum(e.amount) filter (where ec.kind = 'operating') op, sum(e.amount) filter (where ec.kind <> 'operating') other
         from expenses e join expense_categories ec on ec.id = e.category_id
         where e.business_id = b and e.voided_at is null and e.date between p_from and p_to group by 1),
  rc as (select x.day d, sum(x.amount) filter (where ec.kind = 'operating') op, sum(x.amount) filter (where ec.kind <> 'operating') other
         from app_recurring_daily(b, p_from, p_to) x join expense_categories ec on ec.id = x.category_id group by 1),
  ca as (select ct.date d, sum(ct.amount) filter (where ct.direction = 'in') cin, sum(ct.amount) filter (where ct.direction = 'out') cout,
                sum(ct.amount) filter (where ct.kind = 'other_income') oi
         from cash_transactions ct where ct.business_id = b and ct.voided_at is null and ct.kind <> 'transfer'
         and ct.date between p_from and p_to group by 1)
  select days.d,
    (coalesce(sl.rev, 0) - coalesce(rt.rev, 0))::bigint,
    (coalesce(sl.cogs, 0) - coalesce(rt.cogs, 0))::bigint,
    (coalesce(sl.miss, 0) - coalesce(rt.miss, 0))::bigint,
    (coalesce(ex.op, 0) + coalesce(rc.op, 0))::bigint,
    (coalesce(ca.oi, 0) - coalesce(ex.other, 0) - coalesce(rc.other, 0))::bigint,
    coalesce(ca.cin, 0)::bigint, coalesce(ca.cout, 0)::bigint
  from days left join sl on sl.d = days.d left join rt on rt.d = days.d left join ex on ex.d = days.d
  left join rc on rc.d = days.d left join ca on ca.d = days.d
  order by 1;
end $$;
grant execute on function public.fin_daily_series(uuid, date, date) to authenticated, service_role;
revoke execute on function public.fin_daily_series(uuid, date, date) from anon, public;
