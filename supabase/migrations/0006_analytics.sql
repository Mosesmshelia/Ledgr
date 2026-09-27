-- Phase 3: analytics breakdowns, inventory movement summary, budgets.

-- One budget per line per month.
create unique index if not exists budgets_one_per_line on public.budgets (business_id, month, line, category_id) nulls not distinct;

-- Sales broken down by a dimension. Revenue is net of discounts and of returns made in the period
-- (returns are credited back to the original sale's product/customer/salesperson) — so the total always equals P&L revenue.
drop function if exists public.fin_sales_breakdown(uuid, date, date, text);
create or replace function public.fin_sales_breakdown(b uuid, p_from date, p_to date, p_dim text)
returns table (key text, label text, sales_count bigint, units numeric, revenue bigint, cogs bigint, gross_profit bigint, missing_lines bigint, covered_revenue bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform app_require_reader(b);
  if p_dim not in ('product','category','customer','salesperson','day','week','month') then raise exception 'Unknown breakdown.'; end if;
  return query
  with lines as (
    select si.sale_id, s.date, s.customer_id, s.salesperson_id, si.product_id, si.qty, si.net_amount, si.cogs, (si.cogs is null) miss
    from sale_items si join sales s on s.id = si.sale_id
    where s.business_id = b and s.voided_at is null and s.date between p_from and p_to
    union all
    select si.sale_id, r.date, s.customer_id, s.salesperson_id, si.product_id, -ri.qty, -ri.net_reversed, -ri.cogs_reversed, (ri.cogs_reversed is null)
    from sale_return_items ri join sale_returns r on r.id = ri.return_id join sale_items si on si.id = ri.sale_item_id join sales s on s.id = si.sale_id
    where r.business_id = b and r.voided_at is null and s.voided_at is null and r.date between p_from and p_to
  ), keyed as (
    select l.*,
      case p_dim
        when 'product' then l.product_id::text
        when 'category' then coalesce(p.category_id::text, 'none')
        when 'customer' then l.customer_id::text
        when 'salesperson' then coalesce(l.salesperson_id::text, 'none')
        when 'day' then l.date::text
        when 'week' then (l.date - ((extract(isodow from l.date)::int - (select case when week_start = 0 then 7 else week_start end from businesses where id = b) + 7) % 7))::text
        when 'month' then to_char(l.date, 'YYYY-MM')
      end k,
      case p_dim
        when 'product' then p.name
        when 'category' then coalesce(pc.name, 'Uncategorised')
        when 'customer' then c.name
        when 'salesperson' then coalesce(pr.display_name, pr.full_name, u.email, 'Not recorded')
        else null
      end lbl
    from lines l
    join products p on p.id = l.product_id
    left join product_categories pc on pc.id = p.category_id
    join customers c on c.id = l.customer_id
    left join profiles pr on pr.user_id = l.salesperson_id
    left join auth.users u on u.id = l.salesperson_id
  )
  select k, coalesce(max(lbl), k), count(distinct sale_id) filter (where qty > 0), sum(qty), sum(net_amount)::bigint,
         coalesce(sum(cogs) filter (where not miss), 0)::bigint,
         (coalesce(sum(net_amount) filter (where not miss), 0) - coalesce(sum(cogs) filter (where not miss), 0))::bigint,
         count(*) filter (where miss and qty > 0),
         coalesce(sum(net_amount) filter (where not miss), 0)::bigint
  from keyed group by k
  order by case when p_dim in ('day','week','month') then k end, 5 desc;
end $$;

-- How sales in the period were paid: invoice totals (incl. VAT) split by the account payments went into,
-- plus what is still unpaid. Uses payments allocated to those invoices (any date) minus returns/refunds.
create or replace function public.fin_sales_by_payment(b uuid, p_from date, p_to date)
returns table (label text, account_type text, amount bigint, invoices bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform app_require_reader(b);
  return query
  with s as (
    select id from sales
    where business_id = b and voided_at is null and date between p_from and p_to
  ), paid as (
    select a.name, a.type, pa.target_id, sum(pa.amount) amt
    from payment_allocations pa join cash_transactions ct on ct.id = pa.cash_transaction_id join cash_accounts a on a.id = ct.account_id
    where pa.target_type = 'sale' and ct.voided_at is null and pa.target_id in (select id from s)
    group by 1, 2, 3
  )
  select name, type, sum(amt)::bigint, count(distinct target_id) from paid group by 1, 2
  union all
  select 'Not paid yet', 'unpaid', coalesce(sum(app_sale_outstanding(id)), 0)::bigint, count(*) filter (where app_sale_outstanding(id) > 0) from s
  order by 3 desc;
end $$;

-- Stock movement summary per product for a period (quantities), with closing value at the period end.
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
        and (case ca.consumer_type
               when 'sale_item' then (select s.date from sale_items si join sales s on s.id = si.sale_id where si.id = ca.consumer_id)
               else (select pb.date from production_costs pc join production_batches pb on pb.id = pc.batch_id where pc.id = ca.consumer_id) end) <= p_to)), 0) val
    from cost_layers cl where cl.business_id = b and cl.voided_at is null and cl.layer_date <= p_to group by 1
  )
  select p.id, p.name, p.unit, p.is_sellable,
    coalesce(t.op, 0), coalesce(t.pu, 0), coalesce(t.pr, 0), -coalesce(t.us, 0), -coalesce(t.so, 0), coalesce(t.re, 0), coalesce(t.ad, 0),
    coalesce(t.cl, 0), coalesce(v.val, 0)::bigint, p.min_stock
  from products p left join t on t.product_id = p.id left join v on v.product_id = p.id
  where p.business_id = b and p.is_active
  order by p.is_sellable desc, p.name;
end $$;

grant execute on all functions in schema public to authenticated, service_role;
revoke execute on all functions in schema public from anon;
