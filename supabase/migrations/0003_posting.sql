-- Posting functions. Every function runs in ONE transaction: all or nothing.
-- They are SECURITY DEFINER (bypass RLS for writes) and check the caller's role first.
-- Amounts are kobo integers. Errors are written for humans; the UI shows them as-is.

-- ---------- Arithmetic helpers ----------
-- floor(total * a / n) with exact numeric maths (no float).
create or replace function public.app_cum(total bigint, a numeric, n numeric) returns bigint
language sql immutable as $$
  select case when n = 0 then 0 else floor(total::numeric * a / n)::bigint end
$$;

-- Cumulative-floor share: part of `total` for an item of weight w whose running weight (incl. itself) is cw.
-- Summed over all items, shares equal `total` exactly.
create or replace function public.app_share(total bigint, cw numeric, w numeric, wsum numeric) returns bigint
language sql immutable as $$
  select public.app_cum(total, cw, wsum) - public.app_cum(total, cw - w, wsum)
$$;

create or replace function public.app_naira(k bigint) returns text
language sql immutable as $$
  select '₦' || to_char(k / 100.0, 'FM999,999,999,990.00')
$$;

-- ---------- FIFO ----------
-- Consume up to p_qty units of a product from its oldest cost layers.
-- Each piece costs floor(take * remaining_value / remaining_qty); the last unit of a layer takes the exact remainder,
-- so a fully used layer always adds up to its total cost.
create or replace function public.app_consume_fifo(
  p_business uuid, p_product uuid, p_qty numeric, p_consumer_type text, p_consumer_id uuid,
  out cost bigint, out covered numeric)
language plpgsql security definer set search_path = public as $$
declare
  r record; need numeric := p_qty; take numeric; piece bigint;
begin
  cost := 0;
  for r in
    select * from cost_layers
    where business_id = p_business and product_id = p_product and qty_remaining > 0 and voided_at is null
    order by layer_date, created_at, id
    for update
  loop
    exit when need <= 0;
    take := least(need, r.qty_remaining);
    if take = r.qty_remaining then
      piece := r.total_cost - r.consumed_cost;
    else
      piece := floor((r.total_cost - r.consumed_cost)::numeric * take / r.qty_remaining)::bigint;
    end if;
    update cost_layers set qty_remaining = qty_remaining - take, consumed_cost = consumed_cost + piece
      where id = r.id;
    insert into cost_allocations (business_id, consumer_type, consumer_id, cost_layer_id, qty, cost, created_by)
      values (p_business, p_consumer_type, p_consumer_id, r.id, take, piece, auth.uid());
    cost := cost + piece;
    need := need - take;
  end loop;
  covered := p_qty - need;
end $$;

-- Put consumed units back into their original layers (used by voids).
create or replace function public.app_restore_allocations(p_consumer_type text, p_consumer_id uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare r record; restored numeric := 0;
begin
  for r in select * from cost_allocations
           where consumer_type = p_consumer_type and consumer_id = p_consumer_id and reversed_at is null
           for update
  loop
    update cost_layers set qty_remaining = qty_remaining + r.qty, consumed_cost = consumed_cost - r.cost
      where id = r.cost_layer_id;
    update cost_allocations set reversed_at = now() where id = r.id;
    restored := restored + r.qty;
  end loop;
  return restored;
end $$;

-- Stock you can sell = units in layers − units already sold without stock (backorders).
create or replace function public.app_available_qty(p_product uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(qty_remaining) from cost_layers where product_id = p_product and voided_at is null), 0)
       - coalesce((select sum(si.uncovered_qty) from sale_items si join sales s on s.id = si.sale_id
                   where si.product_id = p_product and s.voided_at is null), 0)
$$;

-- Recompute a sale line's effective COGS and cost status.
create or replace function public.app_refresh_sale_item(p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
declare si sale_items;
begin
  select * into si from sale_items where id = p_item for update;
  if si.uncovered_qty = 0 then
    update sale_items set cogs = cogs_allocated, cost_status = 'actual' where id = p_item;
  elsif si.manual_unit_cost is not null then
    update sale_items set cogs = cogs_allocated + round(uncovered_qty * manual_unit_cost)::bigint, cost_status = 'manual' where id = p_item;
  elsif si.estimated_unit_cost is not null then
    update sale_items set cogs = cogs_allocated + round(uncovered_qty * estimated_unit_cost)::bigint, cost_status = 'estimated' where id = p_item;
  else
    update sale_items set cogs = null, cost_status = 'missing' where id = p_item;
  end if;
end $$;

-- When new stock arrives, first cover units that were sold before the stock existed (oldest first).
create or replace function public.app_settle_backorders(p_business uuid, p_product uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record; c record;
begin
  for r in
    select si.id, si.uncovered_qty from sale_items si join sales s on s.id = si.sale_id
    where si.product_id = p_product and si.uncovered_qty > 0 and s.voided_at is null
    order by s.date, si.created_at
    for update of si
  loop
    select * into c from app_consume_fifo(p_business, p_product, r.uncovered_qty, 'sale_item', r.id);
    exit when c.covered = 0;
    update sale_items set cogs_allocated = cogs_allocated + c.cost, uncovered_qty = uncovered_qty - c.covered where id = r.id;
    perform app_refresh_sale_item(r.id);
  end loop;
end $$;

-- ---------- Balances ----------
create or replace function public.app_sale_paid(p_sale uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(pa.amount), 0)::bigint from payment_allocations pa
  join cash_transactions ct on ct.id = pa.cash_transaction_id
  where pa.target_type = 'sale' and pa.target_id = p_sale and ct.voided_at is null
$$;

create or replace function public.app_sale_refunded(p_sale uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(ct.amount), 0)::bigint from cash_transactions ct
  join sale_returns r on ct.source_type = 'sale_return' and ct.source_id = r.id
  where r.sale_id = p_sale and ct.voided_at is null and ct.kind = 'refund'
$$;

create or replace function public.app_sale_returned(p_sale uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(total), 0)::bigint from sale_returns where sale_id = p_sale and voided_at is null
$$;

-- What the customer still owes on an invoice.
create or replace function public.app_sale_outstanding(p_sale uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select case when s.voided_at is not null then 0
    else s.total - app_sale_returned(s.id) - app_sale_paid(s.id) + app_sale_refunded(s.id) end
  from sales s where s.id = p_sale
$$;

create or replace function public.app_purchase_outstanding(p_purchase uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select case when p.voided_at is not null then 0
    else p.total - coalesce((select sum(pa.amount) from payment_allocations pa
                             join cash_transactions ct on ct.id = pa.cash_transaction_id
                             where pa.target_type = 'purchase' and pa.target_id = p.id and ct.voided_at is null), 0) end
  from purchases p where p.id = p_purchase
$$;

-- Money a customer has paid that isn't allocated to a live invoice.
create or replace function public.app_customer_credit(p_customer uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(ct.amount) from cash_transactions ct
                   where ct.customer_id = p_customer and ct.kind = 'customer_payment' and ct.voided_at is null), 0)::bigint
       - coalesce((select sum(pa.amount) from payment_allocations pa
                   join cash_transactions ct on ct.id = pa.cash_transaction_id
                   join sales s on s.id = pa.target_id and pa.target_type = 'sale'
                   where ct.customer_id = p_customer and ct.voided_at is null and s.voided_at is null), 0)::bigint
$$;

-- ---------- Business setup ----------
create or replace function public.create_business(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_b uuid; v_uid uuid := auth.uid(); a jsonb; c record;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Enter your business name.'; end if;

  insert into businesses (name, business_type, owner_name, phone, email, address, currency, timezone,
                          week_start, fy_start_month, vat_registered, vat_rate_bp, prices_include_vat,
                          default_payment_terms_days, created_by)
  values (trim(p->>'name'), p->>'business_type', p->>'owner_name', p->>'phone', p->>'email', p->>'address',
          coalesce(p->>'currency', 'NGN'), coalesce(p->>'timezone', 'Africa/Lagos'),
          coalesce((p->>'week_start')::smallint, 1), coalesce((p->>'fy_start_month')::smallint, 1),
          coalesce((p->>'vat_registered')::boolean, false), coalesce((p->>'vat_rate_bp')::int, 750),
          coalesce((p->>'prices_include_vat')::boolean, false),
          coalesce((p->>'default_payment_terms_days')::int, 7), v_uid)
  returning id into v_b;

  insert into business_members (business_id, user_id, role, can_see_costs, created_by)
  values (v_b, v_uid, 'owner', true, v_uid);

  insert into customers (business_id, name, is_walk_in, created_by) values (v_b, 'Walk-in customer', true, v_uid);

  for c in select * from (values
    ('Rent','operating','home',1), ('Electricity','operating','bolt',2), ('Generator & fuel','operating','fuel',3),
    ('Salaries','operating','users',4), ('Transport','operating','car',5), ('Logistics & delivery','operating','truck',6),
    ('Marketing','operating','megaphone',7), ('Internet','operating','wifi',8), ('Water','operating','droplet',9),
    ('Security','operating','shield',10), ('Repairs & maintenance','operating','wrench',11), ('Software','operating','app',12),
    ('Bank charges','operating','bank',13), ('Phone & data','operating','phone',14), ('Office supplies','operating','box',15),
    ('Insurance','operating','umbrella',16), ('Professional services','operating','briefcase',17),
    ('Taxes & levies','operating','receipt',18), ('Advertising','operating','sparkles',19), ('Miscellaneous','operating','dots',20),
    ('Loan interest','other_expense','percent',30), ('Income tax','income_tax','landmark',40)
  ) as t(name, kind, icon, sort_order)
  loop
    insert into expense_categories (business_id, name, kind, icon, is_system, sort_order, created_by)
    values (v_b, c.name, c.kind, c.icon, true, c.sort_order, v_uid);
  end loop;

  if jsonb_typeof(p->'accounts') = 'array' and jsonb_array_length(p->'accounts') > 0 then
    for a in select * from jsonb_array_elements(p->'accounts') loop
      insert into cash_accounts (business_id, name, type, opening_balance, opening_date, created_by)
      values (v_b, a->>'name', coalesce(a->>'type', 'cash'), coalesce((a->>'opening_balance')::bigint, 0),
              coalesce((a->>'opening_date')::date, current_date), v_uid);
    end loop;
  else
    insert into cash_accounts (business_id, name, type, created_by) values (v_b, 'Cash', 'cash', v_uid), (v_b, 'Bank', 'bank', v_uid);
  end if;

  insert into profiles (user_id, full_name, display_name)
  values (v_uid, p->>'owner_name', split_part(coalesce(p->>'owner_name', ''), ' ', 1))
  on conflict (user_id) do nothing;

  return v_b;
end $$;

-- Opening stock: what you already have when you start using Ledgr.
create or replace function public.set_opening_stock(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_b uuid := (p->>'business_id')::uuid; v_prod products; v_qty numeric := (p->>'qty')::numeric;
        v_cost bigint := (p->>'unit_cost')::bigint; v_date date := coalesce((p->>'date')::date, current_date); v_layer uuid;
begin
  perform app_require(v_b, array['owner','admin','accountant']);
  select * into v_prod from products where id = (p->>'product_id')::uuid and business_id = v_b for update;
  if not found then raise exception 'Product not found.'; end if;
  if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be more than 0.'; end if;
  if v_cost is null or v_cost < 0 then raise exception 'Enter what each unit cost you.'; end if;
  insert into cost_layers (business_id, product_id, source_type, layer_date, qty_in, qty_remaining, total_cost, created_by)
  values (v_b, v_prod.id, 'opening', v_date, v_qty, v_qty, round(v_qty * v_cost)::bigint, auth.uid()) returning id into v_layer;
  insert into inventory_transactions (business_id, product_id, date, kind, qty_change, cost_change, source_type, source_id, created_by)
  values (v_b, v_prod.id, v_date, 'opening', v_qty, round(v_qty * v_cost)::bigint, 'cost_layer', v_layer, auth.uid());
  perform app_settle_backorders(v_b, v_prod.id);
  return v_layer;
end $$;

-- ---------- Payments ----------
-- Records money received from a customer or paid to a supplier and settles invoices.
-- allocations: explicit [{target_id, amount}] or null = oldest open invoices first.
create or replace function public.record_payment(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_b uuid := (p->>'business_id')::uuid;
  v_party text := p->>'party';
  v_party_id uuid := (p->>'party_id')::uuid;
  v_amount bigint := (p->>'amount')::bigint;
  v_date date := coalesce((p->>'date')::date, current_date);
  v_left bigint; v_ct uuid; v_out bigint; v_take bigint; a jsonb; r record; v_acc cash_accounts;
begin
  if v_party = 'customer' then perform app_require(v_b, array['owner','admin','accountant','sales']);
  elsif v_party = 'supplier' then perform app_require(v_b, array['owner','admin','accountant']);
  else raise exception 'Unknown payment type.'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'Payment must be more than ₦0.'; end if;
  select * into v_acc from cash_accounts where id = (p->>'account_id')::uuid and business_id = v_b and is_active;
  if not found then raise exception 'Choose where the money went (cash, bank or POS).'; end if;

  if v_party = 'customer' then
    if not exists (select 1 from customers where id = v_party_id and business_id = v_b) then raise exception 'Customer not found.'; end if;
    insert into cash_transactions (business_id, account_id, date, direction, amount, kind, customer_id, reference, description,
                                   source_type, source_id, created_by)
    values (v_b, v_acc.id, v_date, 'in', v_amount, 'customer_payment', v_party_id, p->>'reference', p->>'description',
            p->>'source_type', (p->>'source_id')::uuid, auth.uid()) returning id into v_ct;
  else
    if not exists (select 1 from suppliers where id = v_party_id and business_id = v_b) then raise exception 'Supplier not found.'; end if;
    insert into cash_transactions (business_id, account_id, date, direction, amount, kind, supplier_id, reference, description,
                                   source_type, source_id, created_by)
    values (v_b, v_acc.id, v_date, 'out', v_amount, 'supplier_payment', v_party_id, p->>'reference', p->>'description',
            p->>'source_type', (p->>'source_id')::uuid, auth.uid()) returning id into v_ct;
  end if;

  v_left := v_amount;
  if jsonb_typeof(p->'allocations') = 'array' then
    for a in select * from jsonb_array_elements(p->'allocations') loop
      v_take := (a->>'amount')::bigint;
      if v_take is null or v_take <= 0 then continue; end if;
      if v_party = 'customer' then
        if not exists (select 1 from sales where id = (a->>'target_id')::uuid and business_id = v_b and customer_id = v_party_id and voided_at is null)
          then raise exception 'Invoice not found for this customer.'; end if;
        v_out := app_sale_outstanding((a->>'target_id')::uuid);
      else
        if not exists (select 1 from purchases where id = (a->>'target_id')::uuid and business_id = v_b and supplier_id = v_party_id and voided_at is null)
          then raise exception 'Purchase not found for this supplier.'; end if;
        v_out := app_purchase_outstanding((a->>'target_id')::uuid);
      end if;
      if v_take > v_out then raise exception 'That''s more than the % left on this invoice.', app_naira(v_out); end if;
      if v_take > v_left then raise exception 'Allocations add up to more than the payment.'; end if;
      insert into payment_allocations (business_id, cash_transaction_id, target_type, target_id, amount, created_by)
      values (v_b, v_ct, case when v_party = 'customer' then 'sale' else 'purchase' end, (a->>'target_id')::uuid, v_take, auth.uid());
      v_left := v_left - v_take;
    end loop;
  else
    if v_party = 'customer' then
      for r in select id, app_sale_outstanding(id) as out from sales
               where business_id = v_b and customer_id = v_party_id and voided_at is null
               order by due_date, date, created_at
      loop
        exit when v_left = 0;
        continue when r.out <= 0;
        v_take := least(v_left, r.out);
        insert into payment_allocations (business_id, cash_transaction_id, target_type, target_id, amount, created_by)
        values (v_b, v_ct, 'sale', r.id, v_take, auth.uid());
        v_left := v_left - v_take;
      end loop;
    else
      for r in select id, app_purchase_outstanding(id) as out from purchases
               where business_id = v_b and supplier_id = v_party_id and voided_at is null
               order by coalesce(due_date, date), date, created_at
      loop
        exit when v_left = 0;
        continue when r.out <= 0;
        v_take := least(v_left, r.out);
        insert into payment_allocations (business_id, cash_transaction_id, target_type, target_id, amount, created_by)
        values (v_b, v_ct, 'purchase', r.id, v_take, auth.uid());
        v_left := v_left - v_take;
      end loop;
    end if;
  end if;

  if v_left > 0 then
    if v_party = 'customer' and coalesce((p->>'allow_credit')::boolean, false) then
      null; -- kept as customer credit
    elsif v_party = 'customer' then
      raise exception 'This is % more than the customer owes. Turn on "keep extra as credit" to continue.', app_naira(v_left);
    else
      raise exception 'This is % more than you owe this supplier.', app_naira(v_left);
    end if;
  end if;
  return v_ct;
end $$;

-- ---------- Sales ----------
-- Pure line maths shared by post_sale and preview_sale.
create or replace function public.app_sale_lines(p_items jsonb, p_inv_disc bigint, p_bp int, p_incl boolean)
returns table (ord bigint, product_id uuid, qty numeric, unit_price bigint, line_discount bigint,
               gross_amount bigint, discount_amount bigint, net_amount bigint, vat_amount bigint)
language sql immutable as $$
  with l as (
    select t.ord, (t.e->>'product_id')::uuid pid, (t.e->>'qty')::numeric q, (t.e->>'unit_price')::bigint price,
           coalesce((t.e->>'line_discount')::bigint, 0) ld
    from jsonb_array_elements(p_items) with ordinality as t(e, ord)
  ), w as (
    select l.*, round(q * price)::bigint - ld as base from l
  ), s1 as (
    select w.*, sum(base) over (order by ord) as cw, sum(base) over () as wsum from w
  ), s2 as (
    select s1.*, base - app_share(p_inv_disc, cw, base, wsum) as e from s1
  ), s3 as (
    select s2.*, sum(e) over (order by ord) as ce, sum(e) over () as esum from s2
  ), s4 as (
    select s3.*,
      app_share(case when p_bp = 0 then 0
                     when p_incl then round(esum * p_bp / (10000.0 + p_bp))::bigint
                     else round(esum * p_bp / 10000.0)::bigint end, ce, e, esum) as vat
    from s3
  ), s5 as (
    select s4.*,
      case when p_incl then e - vat else e end as net,
      case when p_incl then round(round(q * price) * 10000.0 / (10000 + p_bp))::bigint else round(q * price)::bigint end as gross_raw
    from s4
  )
  select ord, pid, q, price, ld,
         case when gross_raw < net or (ld = 0 and e = base and p_incl) then net else gross_raw end,
         case when gross_raw < net or (ld = 0 and e = base and p_incl) then 0 else gross_raw - net end,
         net, vat
  from s5 order by ord
$$;

create or replace function public.post_sale(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_b uuid := (p->>'business_id')::uuid;
  v_biz businesses; v_cust customers; v_sale uuid; v_date date := coalesce((p->>'date')::date, current_date);
  v_bp int; v_incl boolean; v_inv_disc bigint := coalesce((p->>'invoice_discount')::bigint, 0);
  v_allow_neg boolean := coalesce((p->>'allow_negative_stock')::boolean, false);
  v_w bigint; r record; v_prod products; c record; v_item uuid; v_avail numeric; v_pay bigint;
  t_gross bigint; t_disc bigint; t_net bigint; t_vat bigint; v_invoice text;
begin
  perform app_require(v_b, array['owner','admin','accountant','sales']);
  select * into v_biz from businesses where id = v_b for update;

  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'Add at least one product to the sale.';
  end if;

  if nullif(p->>'customer_id', '') is null then
    select * into v_cust from customers where business_id = v_b and is_walk_in limit 1;
  else
    select * into v_cust from customers where id = (p->>'customer_id')::uuid and business_id = v_b;
  end if;
  if not found then raise exception 'Customer not found.'; end if;

  for r in select (e->>'product_id')::uuid pid, (e->>'qty')::numeric q, (e->>'unit_price')::bigint price,
                  coalesce((e->>'line_discount')::bigint, 0) ld
           from jsonb_array_elements(p->'items') e
  loop
    select * into v_prod from products where id = r.pid and business_id = v_b;
    if not found then raise exception 'Product not found.'; end if;
    if r.q is null or r.q <= 0 then raise exception 'Quantity for % must be more than 0.', v_prod.name; end if;
    if r.price is null or r.price < 0 then raise exception 'Price for % can''t be negative.', v_prod.name; end if;
    if r.ld < 0 or r.ld > round(r.q * r.price) then raise exception 'Discount on % can''t be more than the line amount.', v_prod.name; end if;
  end loop;

  select sum(round((e->>'qty')::numeric * (e->>'unit_price')::bigint)::bigint - coalesce((e->>'line_discount')::bigint, 0))
    into v_w from jsonb_array_elements(p->'items') e;
  if v_inv_disc < 0 or v_inv_disc > v_w then raise exception 'The discount can''t be more than the sale amount.'; end if;

  v_bp := case when v_biz.vat_registered then v_biz.vat_rate_bp else 0 end;
  v_incl := v_biz.prices_include_vat and v_bp > 0;

  select sum(gross_amount), sum(discount_amount), sum(net_amount), sum(vat_amount)
    into t_gross, t_disc, t_net, t_vat
  from app_sale_lines(p->'items', v_inv_disc, v_bp, v_incl);

  v_invoice := 'INV-' || lpad(v_biz.next_invoice_no::text, 6, '0');
  update businesses set next_invoice_no = next_invoice_no + 1 where id = v_b;

  insert into sales (business_id, invoice_no, customer_id, salesperson_id, date, due_date, currency, vat_rate_bp,
                     prices_include_vat, gross, discount_total, net, vat_amount, total, notes, created_by)
  values (v_b, v_invoice, v_cust.id, coalesce((p->>'salesperson_id')::uuid, auth.uid()), v_date,
          coalesce((p->>'due_date')::date, v_date + coalesce(v_cust.payment_terms_days, v_biz.default_payment_terms_days)),
          v_biz.currency, v_bp, v_incl, t_gross, t_disc, t_net, t_vat, t_net + t_vat, p->>'notes', auth.uid())
  returning id into v_sale;

  for r in select * from app_sale_lines(p->'items', v_inv_disc, v_bp, v_incl) loop
    select * into v_prod from products where id = r.product_id for update;  -- serialises stock per product
    v_avail := app_available_qty(r.product_id);
    if r.qty > v_avail and not v_allow_neg then
      raise exception 'Only % % of % in stock.', trim(to_char(greatest(v_avail, 0), 'FM999999990.###')), v_prod.unit, v_prod.name
        using hint = 'INSUFFICIENT_STOCK';
    end if;

    insert into sale_items (business_id, sale_id, product_id, qty, unit_price, line_discount, gross_amount,
                            discount_amount, net_amount, vat_amount, estimated_unit_cost, cost_status, created_by)
    values (v_b, v_sale, r.product_id, r.qty, r.unit_price, r.line_discount, r.gross_amount, r.discount_amount,
            r.net_amount, r.vat_amount, v_prod.standard_cost, 'missing', auth.uid())
    returning id into v_item;

    select * into c from app_consume_fifo(v_b, r.product_id, r.qty, 'sale_item', v_item);
    update sale_items set cogs_allocated = c.cost, uncovered_qty = r.qty - c.covered where id = v_item;
    perform app_refresh_sale_item(v_item);

    insert into inventory_transactions (business_id, product_id, date, kind, qty_change, cost_change, source_type, source_id, created_by)
    values (v_b, r.product_id, v_date, 'sale', -r.qty, -c.cost, 'sale_item', v_item, auth.uid());
  end loop;

  v_pay := coalesce((p->'payment'->>'amount')::bigint, 0);
  if v_pay > 0 then
    if v_pay > t_net + t_vat then raise exception 'Amount paid is more than the sale total.'; end if;
    perform record_payment(jsonb_build_object(
      'business_id', v_b, 'party', 'customer', 'party_id', v_cust.id, 'account_id', p->'payment'->>'account_id',
      'date', v_date, 'amount', v_pay, 'reference', v_invoice, 'source_type', 'sale', 'source_id', v_sale,
      'allocations', jsonb_build_array(jsonb_build_object('target_id', v_sale, 'amount', v_pay))));
  end if;

  return v_sale;
end $$;

-- Live preview for the sale form (nothing is saved).
create or replace function public.preview_sale(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_b uuid := (p->>'business_id')::uuid; v_biz businesses; v_bp int; v_incl boolean; res jsonb;
begin
  perform app_require(v_b, array['owner','admin','accountant','sales']);
  select * into v_biz from businesses where id = v_b;
  v_bp := case when v_biz.vat_registered then v_biz.vat_rate_bp else 0 end;
  v_incl := v_biz.prices_include_vat and v_bp > 0;
  select jsonb_agg(to_jsonb(l)) into res from app_sale_lines(p->'items', coalesce((p->>'invoice_discount')::bigint, 0), v_bp, v_incl) l;
  return res;
end $$;

-- "Fix missing cost": the owner tells us what a line's uncovered units cost.
create or replace function public.set_missing_cost(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare si sale_items;
begin
  select * into si from sale_items where id = (p->>'sale_item_id')::uuid;
  if not found then raise exception 'Sale line not found.'; end if;
  perform app_require(si.business_id, array['owner','admin','accountant']);
  if (p->>'unit_cost')::bigint is null or (p->>'unit_cost')::bigint < 0 then raise exception 'Enter a valid cost.'; end if;
  perform set_config('app.reason', coalesce(p->>'reason', 'Missing cost added'), true);
  update sale_items set manual_unit_cost = (p->>'unit_cost')::bigint where id = si.id;
  perform app_refresh_sale_item(si.id);
end $$;

-- ---------- Returns ----------
create or replace function public.post_return(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_sale sales; v_ret uuid; r record; si sale_items; v_before numeric; v_q numeric;
  v_net bigint; v_disc bigint; v_vat bigint; v_cogs bigint; v_status text; v_layer uuid; v_ri uuid;
  t_net bigint := 0; t_vat bigint := 0; v_total bigint; v_out bigint;
  v_date date := coalesce((p->>'date')::date, current_date);
  v_restock boolean := coalesce((p->>'restock')::boolean, true);
  v_method text := coalesce(p->>'refund_method', 'credit');
begin
  select * into v_sale from sales where id = (p->>'sale_id')::uuid for update;
  if not found then raise exception 'Sale not found.'; end if;
  perform app_require(v_sale.business_id, array['owner','admin','accountant']);
  if v_sale.voided_at is not null then raise exception 'This sale was voided.'; end if;
  if v_date < v_sale.date then raise exception 'A return can''t be dated before the sale.'; end if;
  if v_method not in ('cash','credit') then raise exception 'Choose how to refund the customer.'; end if;
  v_out := app_sale_outstanding(v_sale.id);

  insert into sale_returns (business_id, sale_id, date, reason, restock, refund_method, net_total, vat_total, total, created_by)
  values (v_sale.business_id, v_sale.id, v_date, p->>'reason', v_restock, v_method, 0, 0, 0, auth.uid())
  returning id into v_ret;

  for r in select (e->>'sale_item_id')::uuid sid, (e->>'qty')::numeric q from jsonb_array_elements(p->'items') e loop
    select * into si from sale_items where id = r.sid and sale_id = v_sale.id for update;
    if not found then raise exception 'That item isn''t on this sale.'; end if;
    v_q := r.q;
    if v_q is null or v_q <= 0 then continue; end if;
    select coalesce(sum(ri.qty), 0) into v_before from sale_return_items ri join sale_returns sr on sr.id = ri.return_id
      where ri.sale_item_id = si.id and sr.voided_at is null and sr.id <> v_ret;
    if v_before + v_q > si.qty then raise exception 'You can return at most % of this item.', si.qty - v_before; end if;

    v_net  := app_cum(si.net_amount, v_before + v_q, si.qty) - app_cum(si.net_amount, v_before, si.qty);
    v_disc := app_cum(si.discount_amount, v_before + v_q, si.qty) - app_cum(si.discount_amount, v_before, si.qty);
    v_vat  := app_cum(si.vat_amount, v_before + v_q, si.qty) - app_cum(si.vat_amount, v_before, si.qty);
    if not v_restock then
      v_cogs := 0; v_status := 'actual';          -- damaged goods: the cost stays as COGS (a loss)
    elsif si.cogs is null then
      raise exception 'Add the missing cost for this sale before returning items to stock.';
    else
      v_cogs := app_cum(si.cogs, v_before + v_q, si.qty) - app_cum(si.cogs, v_before, si.qty);
      v_status := si.cost_status;
    end if;

    insert into sale_return_items (business_id, return_id, sale_item_id, qty, gross_reversed, discount_reversed,
                                   net_reversed, vat_reversed, cogs_reversed, cost_status, created_by)
    values (si.business_id, v_ret, si.id, v_q, v_net + v_disc, v_disc, v_net, v_vat, v_cogs, v_status, auth.uid())
    returning id into v_ri;

    if v_restock then
      insert into cost_layers (business_id, product_id, source_type, source_id, layer_date, qty_in, qty_remaining, total_cost, created_by)
      values (si.business_id, si.product_id, 'return', v_ri, v_date, v_q, v_q, v_cogs, auth.uid()) returning id into v_layer;
      insert into inventory_transactions (business_id, product_id, date, kind, qty_change, cost_change, source_type, source_id, created_by)
      values (si.business_id, si.product_id, v_date, 'return', v_q, v_cogs, 'sale_return_item', v_ri, auth.uid());
      perform app_settle_backorders(si.business_id, si.product_id);
    end if;
    t_net := t_net + v_net; t_vat := t_vat + v_vat;
  end loop;

  v_total := t_net + t_vat;
  if v_total = 0 and t_net = 0 and not exists (select 1 from sale_return_items where return_id = v_ret) then
    raise exception 'Choose at least one item to return.';
  end if;
  update sale_returns set net_total = t_net, vat_total = t_vat, total = v_total where id = v_ret;

  if v_method = 'credit' then
    if v_total > v_out then
      raise exception 'The customer only owes % on this invoice. Refund the rest in cash instead.', app_naira(v_out);
    end if;
  else
    if v_total > app_sale_paid(v_sale.id) - app_sale_refunded(v_sale.id) then
      raise exception 'You can''t refund more than the customer paid on this invoice.';
    end if;
    if not exists (select 1 from cash_accounts where id = (p->>'account_id')::uuid and business_id = v_sale.business_id and is_active) then
      raise exception 'Choose which account the refund comes from.';
    end if;
    insert into cash_transactions (business_id, account_id, date, direction, amount, kind, customer_id, reference,
                                   source_type, source_id, created_by)
    values (v_sale.business_id, (p->>'account_id')::uuid, v_date, 'out', v_total, 'refund', v_sale.customer_id,
            v_sale.invoice_no, 'sale_return', v_ret, auth.uid());
  end if;
  return v_ret;
end $$;

-- ---------- Purchases ----------
create or replace function public.post_purchase(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_b uuid := (p->>'business_id')::uuid; v_biz businesses; v_pur uuid;
  v_date date := coalesce((p->>'date')::date, current_date);
  v_method text := coalesce(p->>'allocation_method', 'value');
  v_sub bigint; v_dc bigint; v_wsum numeric; r record; v_item uuid; v_layer uuid; v_pay bigint;
begin
  perform app_require(v_b, array['owner','admin','accountant']);
  select * into v_biz from businesses where id = v_b;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'Add at least one product to the purchase.';
  end if;
  if nullif(p->>'supplier_id', '') is not null and not exists (select 1 from suppliers where id = (p->>'supplier_id')::uuid and business_id = v_b) then
    raise exception 'Supplier not found.';
  end if;
  for r in select (e->>'product_id')::uuid pid, (e->>'qty')::numeric q, (e->>'unit_cost')::bigint uc from jsonb_array_elements(p->'items') e loop
    if not exists (select 1 from products where id = r.pid and business_id = v_b) then raise exception 'Product not found.'; end if;
    if r.q is null or r.q <= 0 then raise exception 'Quantity must be more than 0.'; end if;
    if r.uc is null or r.uc < 0 then raise exception 'Unit cost can''t be negative.'; end if;
  end loop;
  if exists (select 1 from jsonb_array_elements(coalesce(p->'costs', '[]'::jsonb)) e where (e->>'amount')::bigint < 0) then
    raise exception 'Extra costs can''t be negative.';
  end if;

  select coalesce(sum(round((e->>'qty')::numeric * (e->>'unit_cost')::bigint)), 0)::bigint into v_sub from jsonb_array_elements(p->'items') e;
  select coalesce(sum((e->>'amount')::bigint), 0)::bigint into v_dc from jsonb_array_elements(coalesce(p->'costs', '[]'::jsonb)) e;
  if v_method = 'value' and v_sub = 0 then v_method := 'quantity'; end if;

  insert into purchases (business_id, supplier_id, date, due_date, supplier_invoice_no, allocation_method, subtotal,
                         direct_costs_total, total, notes, created_by)
  values (v_b, nullif(p->>'supplier_id', '')::uuid, v_date,
          coalesce((p->>'due_date')::date, v_date + v_biz.default_payment_terms_days),
          p->>'supplier_invoice_no', v_method, v_sub, v_dc, v_sub + v_dc, p->>'notes', auth.uid())
  returning id into v_pur;

  insert into purchase_costs (business_id, purchase_id, kind, amount, description, created_by)
  select v_b, v_pur, coalesce(e->>'kind', 'other'), (e->>'amount')::bigint, e->>'description', auth.uid()
  from jsonb_array_elements(coalesce(p->'costs', '[]'::jsonb)) e where (e->>'amount')::bigint > 0;

  for r in
    with l as (
      select t.ord, (t.e->>'product_id')::uuid pid, (t.e->>'qty')::numeric q, (t.e->>'unit_cost')::bigint uc,
             round((t.e->>'qty')::numeric * (t.e->>'unit_cost')::bigint)::bigint lt
      from jsonb_array_elements(p->'items') with ordinality t(e, ord)
    ), w as (
      select l.*, case when v_method = 'value' then lt::numeric else q end as wt from l
    )
    select w.*, app_share(v_dc, sum(wt) over (order by ord), wt, sum(wt) over ()) as dc from w order by ord
  loop
    insert into purchase_items (business_id, purchase_id, product_id, qty, unit_cost, line_total, allocated_direct_cost, landed_total, created_by)
    values (v_b, v_pur, r.pid, r.q, r.uc, r.lt, r.dc, r.lt + r.dc, auth.uid()) returning id into v_item;
    perform 1 from products where id = r.pid for update;
    insert into cost_layers (business_id, product_id, source_type, source_id, layer_date, qty_in, qty_remaining, total_cost, created_by)
    values (v_b, r.pid, 'purchase', v_item, v_date, r.q, r.q, r.lt + r.dc, auth.uid()) returning id into v_layer;
    insert into inventory_transactions (business_id, product_id, date, kind, qty_change, cost_change, source_type, source_id, created_by)
    values (v_b, r.pid, v_date, 'purchase', r.q, r.lt + r.dc, 'purchase_item', v_item, auth.uid());
    perform app_settle_backorders(v_b, r.pid);
  end loop;

  v_pay := coalesce((p->'payment'->>'amount')::bigint, 0);
  if v_pay > 0 then
    if nullif(p->>'supplier_id', '') is null then raise exception 'Choose a supplier to record a payment.'; end if;
    if v_pay > v_sub + v_dc then raise exception 'Amount paid is more than the purchase total.'; end if;
    perform record_payment(jsonb_build_object(
      'business_id', v_b, 'party', 'supplier', 'party_id', p->>'supplier_id', 'account_id', p->'payment'->>'account_id',
      'date', v_date, 'amount', v_pay, 'reference', p->>'supplier_invoice_no', 'source_type', 'purchase', 'source_id', v_pur,
      'allocations', jsonb_build_array(jsonb_build_object('target_id', v_pur, 'amount', v_pay))));
  end if;
  return v_pur;
end $$;

-- ---------- Production ----------
-- costs: [{kind, amount, description, account_id?}] or [{kind:'materials', consumed_product_id, consumed_qty}]
create or replace function public.post_production(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_b uuid := (p->>'business_id')::uuid; v_batch uuid; v_prod products; v_raw products;
  v_date date := coalesce((p->>'date')::date, current_date); v_qty numeric := (p->>'qty')::numeric;
  e jsonb; v_pc uuid; c record; v_amt bigint; v_total bigint := 0; v_layer uuid; v_status text;
begin
  perform app_require(v_b, array['owner','admin','accountant']);
  select * into v_prod from products where id = (p->>'product_id')::uuid and business_id = v_b for update;
  if not found then raise exception 'Choose the product you made.'; end if;
  if v_qty is null or v_qty <= 0 then raise exception 'Quantity produced must be more than 0.'; end if;

  insert into production_batches (business_id, product_id, batch_no, date, qty_produced, total_cost, notes, created_by)
  values (v_b, v_prod.id,
          coalesce(nullif(p->>'batch_no', ''), 'B-' || to_char(v_date, 'YYMMDD') || '-' ||
            (select count(*) + 1 from production_batches where business_id = v_b and date = v_date)),
          v_date, v_qty, 0, p->>'notes', auth.uid())
  returning id into v_batch;

  for e in select * from jsonb_array_elements(coalesce(p->'costs', '[]'::jsonb)) loop
    v_status := 'actual';
    if nullif(e->>'consumed_product_id', '') is not null then
      select * into v_raw from products where id = (e->>'consumed_product_id')::uuid and business_id = v_b for update;
      if not found then raise exception 'Raw material not found.'; end if;
      if (e->>'consumed_qty')::numeric is null or (e->>'consumed_qty')::numeric <= 0 then raise exception 'Enter how much % you used.', v_raw.name; end if;
      insert into production_costs (business_id, batch_id, kind, amount, description, consumed_product_id, consumed_qty, created_by)
      values (v_b, v_batch, coalesce(e->>'kind', 'materials'), 0, coalesce(e->>'description', v_raw.name), v_raw.id, (e->>'consumed_qty')::numeric, auth.uid())
      returning id into v_pc;
      select * into c from app_consume_fifo(v_b, v_raw.id, (e->>'consumed_qty')::numeric, 'production_cost', v_pc);
      v_amt := c.cost;
      if c.covered < (e->>'consumed_qty')::numeric then
        if v_raw.standard_cost is null then
          raise exception 'Not enough % in stock. Record its purchase first, or set a standard cost for it.', v_raw.name;
        end if;
        v_amt := v_amt + round(((e->>'consumed_qty')::numeric - c.covered) * v_raw.standard_cost)::bigint;
        v_status := 'estimated';
      end if;
      update production_costs set amount = v_amt, cost_status = v_status where id = v_pc;
      insert into inventory_transactions (business_id, product_id, date, kind, qty_change, cost_change, source_type, source_id, created_by)
      values (v_b, v_raw.id, v_date, 'production_use', -c.covered, -c.cost, 'production_cost', v_pc, auth.uid());
    else
      v_amt := (e->>'amount')::bigint;
      if v_amt is null or v_amt < 0 then raise exception 'Production costs can''t be negative.'; end if;
      if v_amt = 0 then continue; end if;
      insert into production_costs (business_id, batch_id, kind, amount, description, created_by)
      values (v_b, v_batch, coalesce(e->>'kind', 'other'), v_amt, e->>'description', auth.uid()) returning id into v_pc;
      if nullif(e->>'account_id', '') is not null then
        if not exists (select 1 from cash_accounts where id = (e->>'account_id')::uuid and business_id = v_b and is_active) then
          raise exception 'Account not found.'; end if;
        insert into cash_transactions (business_id, account_id, date, direction, amount, kind, description, source_type, source_id, created_by)
        values (v_b, (e->>'account_id')::uuid, v_date, 'out', v_amt, 'direct_cost_payment',
                coalesce(e->>'description', e->>'kind'), 'production_batch', v_batch, auth.uid());
      end if;
    end if;
    v_total := v_total + v_amt;
  end loop;

  update production_batches set total_cost = v_total where id = v_batch;
  insert into cost_layers (business_id, product_id, source_type, source_id, layer_date, qty_in, qty_remaining, total_cost, created_by)
  values (v_b, v_prod.id, 'production', v_batch, v_date, v_qty, v_qty, v_total, auth.uid()) returning id into v_layer;
  insert into inventory_transactions (business_id, product_id, date, kind, qty_change, cost_change, source_type, source_id, created_by)
  values (v_b, v_prod.id, v_date, 'production', v_qty, v_total, 'production_batch', v_batch, auth.uid());
  perform app_settle_backorders(v_b, v_prod.id);
  return v_batch;
end $$;

-- ---------- Expenses and other cash ----------
create or replace function public.create_expense(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_b uuid := (p->>'business_id')::uuid; v_exp uuid; v_date date := coalesce((p->>'date')::date, current_date);
        v_amt bigint := (p->>'amount')::bigint; v_cat expense_categories;
begin
  perform app_require(v_b, array['owner','admin','accountant']);
  if v_amt is null or v_amt <= 0 then raise exception 'Expense amount must be greater than ₦0.'; end if;
  select * into v_cat from expense_categories where id = (p->>'category_id')::uuid and business_id = v_b;
  if not found then raise exception 'Choose a category.'; end if;
  if not exists (select 1 from cash_accounts where id = (p->>'account_id')::uuid and business_id = v_b and is_active) then
    raise exception 'Choose where the money came from (cash, bank or POS).';
  end if;
  insert into expenses (business_id, date, name, category_id, amount, vendor, cash_account_id, receipt_path, notes, created_by)
  values (v_b, v_date, coalesce(nullif(trim(p->>'name'), ''), v_cat.name), v_cat.id, v_amt, p->>'vendor',
          (p->>'account_id')::uuid, p->>'receipt_path', p->>'notes', auth.uid())
  returning id into v_exp;
  insert into cash_transactions (business_id, account_id, date, direction, amount, kind, counterparty, description,
                                 source_type, source_id, created_by)
  values (v_b, (p->>'account_id')::uuid, v_date, 'out', v_amt, 'expense_payment', p->>'vendor',
          coalesce(nullif(trim(p->>'name'), ''), v_cat.name), 'expense', v_exp, auth.uid());
  return v_exp;
end $$;

-- Paying a recurring expense only moves cash; the expense itself is accrued day by day.
create or replace function public.record_recurring_payment(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_re recurring_expenses; v_ct uuid; v_amt bigint := (p->>'amount')::bigint; v_date date := coalesce((p->>'date')::date, current_date);
begin
  select * into v_re from recurring_expenses where id = (p->>'recurring_expense_id')::uuid;
  if not found then raise exception 'Recurring expense not found.'; end if;
  perform app_require(v_re.business_id, array['owner','admin','accountant']);
  if v_amt is null or v_amt <= 0 then raise exception 'Payment must be more than ₦0.'; end if;
  if not exists (select 1 from cash_accounts where id = (p->>'account_id')::uuid and business_id = v_re.business_id and is_active) then
    raise exception 'Choose where the money came from.';
  end if;
  insert into cash_transactions (business_id, account_id, date, direction, amount, kind, description, reference,
                                 source_type, source_id, created_by)
  values (v_re.business_id, (p->>'account_id')::uuid, v_date, 'out', v_amt, 'recurring_payment', v_re.name,
          p->>'reference', 'recurring_expense', v_re.id, auth.uid())
  returning id into v_ct;
  insert into recurring_expense_payments (business_id, recurring_expense_id, cash_transaction_id, amount, date, created_by)
  values (v_re.business_id, v_re.id, v_ct, v_amt, v_date, auth.uid());
  return v_ct;
end $$;

-- Money in or out that is not a sale or expense: capital, loans, drawings, tax, other income.
create or replace function public.record_cash_movement(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_b uuid := (p->>'business_id')::uuid; v_kind text := p->>'kind'; v_ct uuid; v_amt bigint := (p->>'amount')::bigint;
begin
  perform app_require(v_b, array['owner','admin','accountant']);
  if v_kind not in ('other_income','capital_injection','loan_received','loan_repayment','owner_withdrawal','tax_payment') then
    raise exception 'Unknown type of money movement.';
  end if;
  if v_amt is null or v_amt <= 0 then raise exception 'Amount must be more than ₦0.'; end if;
  if not exists (select 1 from cash_accounts where id = (p->>'account_id')::uuid and business_id = v_b and is_active) then
    raise exception 'Choose an account.';
  end if;
  insert into cash_transactions (business_id, account_id, date, direction, amount, kind, counterparty, description, reference, created_by)
  values (v_b, (p->>'account_id')::uuid, coalesce((p->>'date')::date, current_date),
          case when v_kind in ('other_income','capital_injection','loan_received') then 'in' else 'out' end,
          v_amt, v_kind, p->>'counterparty', p->>'description', p->>'reference', auth.uid())
  returning id into v_ct;
  return v_ct;
end $$;

-- Moving money between your own accounts is never income or expense.
create or replace function public.transfer_cash(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_b uuid := (p->>'business_id')::uuid; v_g uuid := gen_random_uuid(); v_amt bigint := (p->>'amount')::bigint;
        v_date date := coalesce((p->>'date')::date, current_date);
begin
  perform app_require(v_b, array['owner','admin','accountant']);
  if v_amt is null or v_amt <= 0 then raise exception 'Amount must be more than ₦0.'; end if;
  if (p->>'from_account_id') = (p->>'to_account_id') then raise exception 'Choose two different accounts.'; end if;
  if (select count(*) from cash_accounts where business_id = v_b and is_active and id in ((p->>'from_account_id')::uuid, (p->>'to_account_id')::uuid)) <> 2 then
    raise exception 'Account not found.';
  end if;
  insert into cash_transactions (business_id, account_id, date, direction, amount, kind, description, transfer_group_id, created_by) values
    (v_b, (p->>'from_account_id')::uuid, v_date, 'out', v_amt, 'transfer', p->>'description', v_g, auth.uid()),
    (v_b, (p->>'to_account_id')::uuid,   v_date, 'in',  v_amt, 'transfer', p->>'description', v_g, auth.uid());
  return v_g;
end $$;

-- ---------- Voids ----------
create or replace function public.void_document(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_type text := p->>'type'; v_id uuid := (p->>'id')::uuid; v_reason text := trim(coalesce(p->>'reason', ''));
  v_b uuid; r record; v_products uuid[] := '{}';
begin
  if length(v_reason) < 3 then raise exception 'Please give a reason for voiding.'; end if;
  perform set_config('app.reason', v_reason, true);

  if v_type = 'sale' then
    select business_id into v_b from sales where id = v_id and voided_at is null for update;
    if not found then raise exception 'Sale not found or already voided.'; end if;
    perform app_require(v_b, array['owner','admin','accountant']);
    if exists (select 1 from sale_returns where sale_id = v_id and voided_at is null) then
      raise exception 'This sale has returns. Void the returns first.';
    end if;
    for r in select * from sale_items where sale_id = v_id loop
      perform 1 from products where id = r.product_id for update;
      perform app_restore_allocations('sale_item', r.id);
      insert into inventory_transactions (business_id, product_id, date, kind, qty_change, cost_change, source_type, source_id, note, created_by)
      values (v_b, r.product_id, current_date, 'void_reversal', r.qty, r.cogs_allocated, 'sale_item', r.id, v_reason, auth.uid());
      v_products := v_products || r.product_id;
    end loop;
    update cash_transactions set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
      where source_type = 'sale' and source_id = v_id and voided_at is null;
    update sales set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = v_id;
    for r in select distinct unnest(v_products) as pid loop perform app_settle_backorders(v_b, r.pid); end loop;

  elsif v_type = 'purchase' then
    select business_id into v_b from purchases where id = v_id and voided_at is null for update;
    if not found then raise exception 'Purchase not found or already voided.'; end if;
    perform app_require(v_b, array['owner','admin','accountant']);
    if exists (select 1 from cost_layers cl join purchase_items pi on cl.source_type = 'purchase' and cl.source_id = pi.id
               where pi.purchase_id = v_id and cl.qty_remaining < cl.qty_in) then
      raise exception 'Some of this stock has already been sold or used, so the purchase can''t be voided. Record a stock adjustment instead.';
    end if;
    for r in select pi.*, cl.id as layer_id from purchase_items pi join cost_layers cl on cl.source_type = 'purchase' and cl.source_id = pi.id
             where pi.purchase_id = v_id loop
      update cost_layers set voided_at = now() where id = r.layer_id;
      insert into inventory_transactions (business_id, product_id, date, kind, qty_change, cost_change, source_type, source_id, note, created_by)
      values (v_b, r.product_id, current_date, 'void_reversal', -r.qty, -r.landed_total, 'purchase_item', r.id, v_reason, auth.uid());
    end loop;
    update cash_transactions set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
      where source_type = 'purchase' and source_id = v_id and voided_at is null;
    update purchases set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = v_id;

  elsif v_type = 'production' then
    select business_id into v_b from production_batches where id = v_id and voided_at is null for update;
    if not found then raise exception 'Batch not found or already voided.'; end if;
    perform app_require(v_b, array['owner','admin','accountant']);
    if exists (select 1 from cost_layers where source_type = 'production' and source_id = v_id and qty_remaining < qty_in) then
      raise exception 'Some of this batch has already been sold, so it can''t be voided.';
    end if;
    for r in select * from production_costs where batch_id = v_id and consumed_product_id is not null loop
      perform app_restore_allocations('production_cost', r.id);
      insert into inventory_transactions (business_id, product_id, date, kind, qty_change, cost_change, source_type, source_id, note, created_by)
      select v_b, r.consumed_product_id, current_date, 'void_reversal', -it.qty_change, -it.cost_change, 'production_cost', r.id, v_reason, auth.uid()
      from inventory_transactions it where it.source_type = 'production_cost' and it.source_id = r.id and it.kind = 'production_use';
      perform app_settle_backorders(v_b, r.consumed_product_id);
    end loop;
    for r in select * from cost_layers where source_type = 'production' and source_id = v_id loop
      update cost_layers set voided_at = now() where id = r.id;
      insert into inventory_transactions (business_id, product_id, date, kind, qty_change, cost_change, source_type, source_id, note, created_by)
      values (v_b, r.product_id, current_date, 'void_reversal', -r.qty_in, -r.total_cost, 'production_batch', v_id, v_reason, auth.uid());
    end loop;
    update cash_transactions set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
      where source_type = 'production_batch' and source_id = v_id and voided_at is null;
    update production_batches set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = v_id;

  elsif v_type = 'return' then
    select business_id into v_b from sale_returns where id = v_id and voided_at is null for update;
    if not found then raise exception 'Return not found or already voided.'; end if;
    perform app_require(v_b, array['owner','admin','accountant']);
    if exists (select 1 from cost_layers cl join sale_return_items ri on cl.source_type = 'return' and cl.source_id = ri.id
               where ri.return_id = v_id and cl.qty_remaining < cl.qty_in) then
      raise exception 'The returned items have been sold again, so this return can''t be voided.';
    end if;
    for r in select cl.*, ri.id as ri_id from cost_layers cl join sale_return_items ri on cl.source_type = 'return' and cl.source_id = ri.id
             where ri.return_id = v_id loop
      update cost_layers set voided_at = now() where id = r.id;
      insert into inventory_transactions (business_id, product_id, date, kind, qty_change, cost_change, source_type, source_id, note, created_by)
      values (v_b, r.product_id, current_date, 'void_reversal', -r.qty_in, -r.total_cost, 'sale_return_item', r.ri_id, v_reason, auth.uid());
    end loop;
    update cash_transactions set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
      where source_type = 'sale_return' and source_id = v_id and voided_at is null;
    update sale_returns set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = v_id;

  elsif v_type = 'expense' then
    select business_id into v_b from expenses where id = v_id and voided_at is null for update;
    if not found then raise exception 'Expense not found or already voided.'; end if;
    perform app_require(v_b, array['owner','admin','accountant']);
    update cash_transactions set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
      where source_type = 'expense' and source_id = v_id and voided_at is null;
    update expenses set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = v_id;

  elsif v_type = 'cash' then
    select business_id into v_b from cash_transactions where id = v_id and voided_at is null for update;
    if not found then raise exception 'Transaction not found or already voided.'; end if;
    perform app_require(v_b, array['owner','admin','accountant']);
    if exists (select 1 from cash_transactions where id = v_id and source_type in ('expense','sale_return','production_batch')) then
      raise exception 'Void the expense, return or batch this payment belongs to instead.';
    end if;
    update cash_transactions set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
      where (id = v_id or transfer_group_id = (select transfer_group_id from cash_transactions where id = v_id))
        and voided_at is null;
  else
    raise exception 'Unknown document type.';
  end if;
end $$;

-- ---------- Grants ----------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
