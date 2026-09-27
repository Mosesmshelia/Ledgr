-- Read functions: fast period aggregates. All money in kobo. The TypeScript engine (/lib/finance)
-- turns these into metrics (margins, comparisons, statuses). Voided records are always excluded.

create or replace function public.app_require_reader(b uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin perform app_require(b, array['owner','admin','accountant','viewer']); end $$;

-- Daily accrual of recurring expenses (Rule 7).
-- Monthly/quarterly/annual: converted to a month amount (cumulative split), then spread over the month's days.
-- Weekly: spread over 7 days from the start date. Daily: full amount each day. Every split is exact to the kobo.
create or replace function public.app_recurring_daily(b uuid, p_from date, p_to date)
returns table (recurring_expense_id uuid, category_id uuid, day date, amount bigint)
language sql stable security definer set search_path = public as $$
  with d as (
    select re.id, re.category_id, re.amount, re.frequency, re.start_date, gs::date as day
    from recurring_expenses re
    cross join lateral generate_series(greatest(p_from, re.start_date), least(p_to, coalesce(re.end_date, p_to)), interval '1 day') gs
    where re.business_id = b
  ), m as (
    select d.*,
      ((extract(year from day) * 12 + extract(month from day)) - (extract(year from start_date) * 12 + extract(month from start_date)))::int as k,
      extract(day from (date_trunc('month', day) + interval '1 month - 1 day'))::int as dim,
      extract(day from day)::int as dom
    from d
  )
  select id, category_id, day,
    case frequency
      when 'daily' then amount
      when 'weekly' then app_share(amount, ((day - start_date) % 7) + 1, 1, 7)
      when 'monthly' then app_share(amount, dom, 1, dim)
      when 'quarterly' then app_share(app_share(amount, (k % 3) + 1, 1, 3), dom, 1, dim)
      when 'annual' then app_share(app_share(amount, (k % 12) + 1, 1, 12), dom, 1, dim)
    end::bigint
  from m
$$;

create or replace function public.fin_recurring_accrual(b uuid, p_from date, p_to date)
returns table (recurring_expense_id uuid, category_id uuid, amount bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app_require_reader(b);
  return query select x.recurring_expense_id, x.category_id, sum(x.amount)::bigint
    from app_recurring_daily(b, p_from, p_to) x group by 1, 2;
end $$;

-- Profit & loss building blocks for a period.
create or replace function public.fin_pnl(b uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  perform app_require_reader(b);
  with s as (
    select si.* from sale_items si join sales sa on sa.id = si.sale_id
    where sa.business_id = b and sa.voided_at is null and sa.date between p_from and p_to
  ), rt as (
    select ri.* from sale_return_items ri join sale_returns r on r.id = ri.return_id join sales sa on sa.id = r.sale_id
    where r.business_id = b and r.voided_at is null and sa.voided_at is null and r.date between p_from and p_to
  ), ex as (
    select ec.kind, sum(e.amount) amt from expenses e join expense_categories ec on ec.id = e.category_id
    where e.business_id = b and e.voided_at is null and e.date between p_from and p_to group by ec.kind
  ), rc as (
    select ec.kind, sum(x.amount) amt from app_recurring_daily(b, p_from, p_to) x
    join expense_categories ec on ec.id = x.category_id group by ec.kind
  ), oi as (
    select coalesce(sum(amount), 0) amt from cash_transactions
    where business_id = b and voided_at is null and kind = 'other_income' and date between p_from and p_to
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'sales_count', (select count(*) from sales where business_id = b and voided_at is null and date between p_from and p_to),
    'gross_sales', (select coalesce(sum(gross_amount), 0) from s),
    'discounts', (select coalesce(sum(discount_amount), 0) from s),
    'sales_net', (select coalesce(sum(net_amount), 0) from s),
    'returns', (select coalesce(sum(net_reversed), 0) from rt),
    'cogs_known', (select coalesce(sum(cogs), 0) from s where cogs is not null),
    'returns_cogs', (select coalesce(sum(cogs_reversed), 0) from rt where cogs_reversed is not null),
    'revenue_missing_cost', (select coalesce(sum(net_amount), 0) from s where cogs is null),
    'returns_missing_cost', (select coalesce(sum(net_reversed), 0) from rt where cogs_reversed is null),
    'lines_actual', (select count(*) from s where cost_status in ('actual','manual')),
    'lines_estimated', (select count(*) from s where cost_status = 'estimated'),
    'lines_missing', (select count(*) from s where cost_status = 'missing'),
    'sales_with_missing_cost', (select count(distinct sale_id) from s where cost_status = 'missing'),
    'opex_one_time', (select coalesce(sum(amt), 0) from ex where kind = 'operating'),
    'opex_recurring', (select coalesce(sum(amt), 0) from rc where kind = 'operating'),
    'other_expense', (select coalesce(sum(amt), 0) from ex where kind = 'other_expense') + (select coalesce(sum(amt), 0) from rc where kind = 'other_expense'),
    'income_tax', (select coalesce(sum(amt), 0) from ex where kind = 'income_tax') + (select coalesce(sum(amt), 0) from rc where kind = 'income_tax'),
    'other_income', (select amt from oi),
    'vat_collected', (select coalesce(sum(vat_amount), 0) from s) - (select coalesce(sum(vat_reversed), 0) from rt)
  ) into res;
  return res;
end $$;

-- Expenses by category (one-time + accrued recurring).
create or replace function public.fin_expense_breakdown(b uuid, p_from date, p_to date)
returns table (category_id uuid, name text, kind text, icon text, one_time bigint, recurring bigint, total bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app_require_reader(b);
  return query
  with ex as (select e.category_id, sum(e.amount) amt from expenses e
              where e.business_id = b and e.voided_at is null and e.date between p_from and p_to group by 1),
       rc as (select x.category_id, sum(x.amount) amt from app_recurring_daily(b, p_from, p_to) x group by 1)
  select ec.id, ec.name, ec.kind, ec.icon, coalesce(ex.amt, 0)::bigint, coalesce(rc.amt, 0)::bigint,
         (coalesce(ex.amt, 0) + coalesce(rc.amt, 0))::bigint
  from expense_categories ec
  left join ex on ex.category_id = ec.id
  left join rc on rc.category_id = ec.id
  where ec.business_id = b and (ex.amt is not null or rc.amt is not null)
  order by 7 desc;
end $$;

-- Cash per account for a period: opening, in, out, closing.
create or replace function public.fin_cash_accounts(b uuid, p_from date, p_to date)
returns table (account_id uuid, name text, type text, opening bigint, cash_in bigint, cash_out bigint, closing bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app_require_reader(b);
  return query
  select a.id, a.name, a.type,
    (a.opening_balance + coalesce(sum(case when ct.date < p_from and ct.date >= a.opening_date then case ct.direction when 'in' then ct.amount else -ct.amount end end), 0))::bigint,
    coalesce(sum(case when ct.date between p_from and p_to and ct.direction = 'in' then ct.amount end), 0)::bigint,
    coalesce(sum(case when ct.date between p_from and p_to and ct.direction = 'out' then ct.amount end), 0)::bigint,
    (a.opening_balance + coalesce(sum(case when ct.date <= p_to and ct.date >= a.opening_date then case ct.direction when 'in' then ct.amount else -ct.amount end end), 0))::bigint
  from cash_accounts a
  left join cash_transactions ct on ct.account_id = a.id and ct.voided_at is null
  where a.business_id = b
  group by a.id order by a.created_at;
end $$;

-- Cash movements by kind for a period (transfers excluded: they net to zero for the business).
create or replace function public.fin_cash_by_kind(b uuid, p_from date, p_to date)
returns table (kind text, direction text, amount bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app_require_reader(b);
  return query select ct.kind, ct.direction, sum(ct.amount)::bigint from cash_transactions ct
    where ct.business_id = b and ct.voided_at is null and ct.kind <> 'transfer' and ct.date between p_from and p_to
    group by 1, 2 order by 3 desc;
end $$;

-- Open customer invoices as of a date.
create or replace function public.fin_receivables(b uuid, p_as_of date)
returns table (sale_id uuid, invoice_no text, customer_id uuid, customer_name text, date date, due_date date,
               total bigint, paid bigint, returned bigint, outstanding bigint, days_overdue int, status text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app_require(b, array['owner','admin','accountant','viewer','sales']);
  return query
  select x.c1, x.c2, x.c3, x.c4, x.c5, x.c6, x.c7, x.c8, x.c9, x.c10, x.c11, x.c12 from (
    select s.id c1, s.invoice_no c2, s.customer_id c3, c.name c4, s.date c5, s.due_date c6, s.total c7,
      (app_sale_paid(s.id) - app_sale_refunded(s.id))::bigint c8, app_sale_returned(s.id) c9,
      app_sale_outstanding(s.id) c10,
      greatest(p_as_of - s.due_date, 0)::int c11,
      case when app_sale_outstanding(s.id) = 0 then 'paid'
           when p_as_of > s.due_date then 'overdue'
           when app_sale_paid(s.id) > 0 then 'partially_paid'
           else 'unpaid' end c12
    from sales s join customers c on c.id = s.customer_id
    where s.business_id = b and s.voided_at is null and s.date <= p_as_of
  ) x where x.c10 > 0
  order by x.c6;
end $$;

create or replace function public.fin_payables(b uuid, p_as_of date)
returns table (purchase_id uuid, supplier_invoice_no text, supplier_id uuid, supplier_name text, date date, due_date date,
               total bigint, paid bigint, outstanding bigint, days_overdue int, status text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app_require_reader(b);
  return query
  select x.c1, x.c2, x.c3, x.c4, x.c5, x.c6, x.c7, x.c8, x.c9, x.c10, x.c11 from (
    select p.id c1, p.supplier_invoice_no c2, p.supplier_id c3, coalesce(su.name, 'No supplier') c4, p.date c5, p.due_date c6, p.total c7,
      (p.total - app_purchase_outstanding(p.id))::bigint c8, app_purchase_outstanding(p.id) c9,
      greatest(p_as_of - p.due_date, 0)::int c10,
      case when app_purchase_outstanding(p.id) = 0 then 'paid'
           when p_as_of > p.due_date then 'overdue'
           when app_purchase_outstanding(p.id) < p.total then 'partially_paid'
           else 'unpaid' end c11
    from purchases p left join suppliers su on su.id = p.supplier_id
    where p.business_id = b and p.voided_at is null and p.date <= p_as_of
  ) x where x.c9 > 0
  order by x.c6;
end $$;

-- Stock on hand and its FIFO value, per product (current).
create or replace function public.fin_inventory(b uuid)
returns table (product_id uuid, name text, unit text, is_sellable boolean, on_hand numeric, value bigint,
               backordered numeric, min_stock numeric, low_stock boolean, avg_cost bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app_require_reader(b);
  return query
  with l as (select cl.product_id, sum(cl.qty_remaining) q, sum(cl.total_cost - cl.consumed_cost) v
             from cost_layers cl where cl.business_id = b and cl.voided_at is null group by 1),
       bo as (select si.product_id, sum(si.uncovered_qty) q from sale_items si join sales s on s.id = si.sale_id
              where si.business_id = b and s.voided_at is null and si.uncovered_qty > 0 group by 1)
  select p.id, p.name, p.unit, p.is_sellable,
         (coalesce(l.q, 0) - coalesce(bo.q, 0))::numeric, coalesce(l.v, 0)::bigint, coalesce(bo.q, 0)::numeric,
         p.min_stock, (coalesce(l.q, 0) - coalesce(bo.q, 0)) <= p.min_stock and p.min_stock > 0,
         case when coalesce(l.q, 0) > 0 then round(l.v / l.q)::bigint end
  from products p left join l on l.product_id = p.id left join bo on bo.product_id = p.id
  where p.business_id = b and p.is_active
  order by p.name;
end $$;

-- Product performance for a period (net of returns).
create or replace function public.fin_product_performance(b uuid, p_from date, p_to date)
returns table (product_id uuid, name text, units numeric, revenue bigint, cogs bigint, gross_profit bigint,
               missing_lines bigint, estimated_lines bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app_require_reader(b);
  return query
  with s as (
    select si.product_id, sum(si.qty) q, sum(si.net_amount) rev, sum(si.cogs) cogs,
           count(*) filter (where si.cost_status = 'missing') miss, count(*) filter (where si.cost_status = 'estimated') est,
           sum(si.net_amount) filter (where si.cogs is not null) rev_known
    from sale_items si join sales sa on sa.id = si.sale_id
    where sa.business_id = b and sa.voided_at is null and sa.date between p_from and p_to group by 1
  ), r as (
    select si.product_id, sum(ri.qty) q, sum(ri.net_reversed) rev, sum(ri.cogs_reversed) cogs,
           sum(ri.net_reversed) filter (where ri.cogs_reversed is not null) rev_known
    from sale_return_items ri join sale_returns rr on rr.id = ri.return_id join sale_items si on si.id = ri.sale_item_id
    join sales sa on sa.id = rr.sale_id
    where rr.business_id = b and rr.voided_at is null and sa.voided_at is null and rr.date between p_from and p_to group by 1
  )
  select p.id, p.name,
         (coalesce(s.q, 0) - coalesce(r.q, 0))::numeric,
         (coalesce(s.rev, 0) - coalesce(r.rev, 0))::bigint,
         (coalesce(s.cogs, 0) - coalesce(r.cogs, 0))::bigint,
         ((coalesce(s.rev_known, 0) - coalesce(r.rev_known, 0)) - (coalesce(s.cogs, 0) - coalesce(r.cogs, 0)))::bigint,
         coalesce(s.miss, 0)::bigint, coalesce(s.est, 0)::bigint
  from products p left join s on s.product_id = p.id left join r on r.product_id = p.id
  where p.business_id = b and (s.product_id is not null or r.product_id is not null)
  order by 4 desc;
end $$;

-- Day-by-day series for charts.
create or replace function public.fin_daily_series(b uuid, p_from date, p_to date)
returns table (day date, revenue bigint, cogs_known bigint, revenue_missing_cost bigint, opex bigint, cash_in bigint, cash_out bigint)
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
  ex as (select e.date d, sum(e.amount) amt from expenses e join expense_categories ec on ec.id = e.category_id
         where e.business_id = b and e.voided_at is null and ec.kind = 'operating' and e.date between p_from and p_to group by 1),
  rc as (select x.day d, sum(x.amount) amt from app_recurring_daily(b, p_from, p_to) x
         join expense_categories ec on ec.id = x.category_id where ec.kind = 'operating' group by 1),
  ca as (select ct.date d, sum(ct.amount) filter (where ct.direction = 'in') cin, sum(ct.amount) filter (where ct.direction = 'out') cout
         from cash_transactions ct where ct.business_id = b and ct.voided_at is null and ct.kind <> 'transfer'
         and ct.date between p_from and p_to group by 1)
  select days.d,
    (coalesce(sl.rev, 0) - coalesce(rt.rev, 0))::bigint,
    (coalesce(sl.cogs, 0) - coalesce(rt.cogs, 0))::bigint,
    (coalesce(sl.miss, 0) - coalesce(rt.miss, 0))::bigint,
    (coalesce(ex.amt, 0) + coalesce(rc.amt, 0))::bigint,
    coalesce(ca.cin, 0)::bigint, coalesce(ca.cout, 0)::bigint
  from days left join sl on sl.d = days.d left join rt on rt.d = days.d left join ex on ex.d = days.d
  left join rc on rc.d = days.d left join ca on ca.d = days.d
  order by 1;
end $$;

-- Recurring expenses: accrued vs paid to date → prepaid (+) or owed (−).
create or replace function public.fin_recurring_status(b uuid, p_as_of date)
returns table (recurring_expense_id uuid, name text, category text, amount bigint, frequency text, start_date date, end_date date,
               accrued_to_date bigint, paid_to_date bigint, balance bigint, monthly_equivalent bigint, weekly_equivalent bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform app_require_reader(b);
  return query
  select re.id, re.name, ec.name, re.amount, re.frequency, re.start_date, re.end_date,
    coalesce((select sum(x.amount) from app_recurring_daily(b, re.start_date, p_as_of) x where x.recurring_expense_id = re.id), 0)::bigint,
    coalesce((select sum(rp.amount) from recurring_expense_payments rp join cash_transactions ct on ct.id = rp.cash_transaction_id
              where rp.recurring_expense_id = re.id and ct.voided_at is null and rp.date <= p_as_of), 0)::bigint,
    (coalesce((select sum(rp.amount) from recurring_expense_payments rp join cash_transactions ct on ct.id = rp.cash_transaction_id
               where rp.recurring_expense_id = re.id and ct.voided_at is null and rp.date <= p_as_of), 0)
     - coalesce((select sum(x.amount) from app_recurring_daily(b, re.start_date, p_as_of) x where x.recurring_expense_id = re.id), 0))::bigint,
    (case re.frequency when 'daily' then round(re.amount * 365 / 12.0) when 'weekly' then round(re.amount * 52 / 12.0)
       when 'monthly' then re.amount when 'quarterly' then round(re.amount / 3.0) else round(re.amount / 12.0) end)::bigint,
    (case re.frequency when 'daily' then re.amount * 7 when 'weekly' then re.amount
       when 'monthly' then round(re.amount * 12 / 52.0) when 'quarterly' then round(re.amount * 4 / 52.0) else round(re.amount / 52.0) end)::bigint
  from recurring_expenses re join expense_categories ec on ec.id = re.category_id
  where re.business_id = b
  order by re.created_at;
end $$;

-- COGS reconciliation check: opening stock value + additions − closing stock value = COGS used.
-- (Stock values reconstructed from layers and allocations as at each date.)
create or replace function public.fin_inventory_value_at(b uuid, p_as_of date) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare v bigint;
begin
  perform app_require_reader(b);
  select coalesce(sum(cl.total_cost), 0)
       - coalesce((select sum(ca.cost) from cost_allocations ca
                   join cost_layers l2 on l2.id = ca.cost_layer_id
                   where l2.business_id = b and ca.reversed_at is null
                     and (case ca.consumer_type
                            when 'sale_item' then (select s.date from sale_items si join sales s on s.id = si.sale_id where si.id = ca.consumer_id)
                            else (select pb.date from production_costs pc join production_batches pb on pb.id = pc.batch_id where pc.id = ca.consumer_id)
                          end) <= p_as_of), 0)
  into v
  from cost_layers cl where cl.business_id = b and cl.voided_at is null and cl.layer_date <= p_as_of;
  return v;
end $$;

grant execute on all functions in schema public to authenticated, service_role;
revoke execute on all functions in schema public from anon;
