-- Removing a product entered by mistake — without ever deleting money history.
--   never used                          → deleted completely
--   only unsold opening stock           → opening stock cancelled (not a cost), product archived
--   has real history, no stock left     → archived (hidden from lists and forms; reports keep its history)
--   still has stock                     → refused, with how to fix it
-- Archived products can be restored.

-- What "Remove" would do for this product (shown to the person before they confirm).
create or replace function public.product_removal_check(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_prod products; v_b uuid := (p->>'business_id')::uuid;
  v_used boolean; v_opening_only boolean; v_on_hand numeric; v_qty text;
begin
  select * into v_prod from products where id = (p->>'product_id')::uuid and business_id = v_b;
  if not found then raise exception 'Product not found.'; end if;
  perform app_require(v_b, array['owner','admin','accountant']);
  if not v_prod.is_active then return jsonb_build_object('mode', 'restore', 'message', 'This product is archived. Restore it to use it again.'); end if;

  -- Used anywhere other than its own opening stock?
  v_used := exists (select 1 from sale_items where product_id = v_prod.id)
         or exists (select 1 from purchase_items where product_id = v_prod.id)
         or exists (select 1 from production_batches where product_id = v_prod.id)
         or exists (select 1 from production_costs where consumed_product_id = v_prod.id)
         or exists (select 1 from stock_adjustments where product_id = v_prod.id)
         or exists (select 1 from inventory_transactions where product_id = v_prod.id and kind <> 'opening');
  v_opening_only := not v_used and exists (select 1 from cost_layers where product_id = v_prod.id and voided_at is null);
  select coalesce(sum(qty_remaining), 0) into v_on_hand from cost_layers where product_id = v_prod.id and voided_at is null;
  -- "10 units", "1 unit", "2.5 kg"
  v_qty := rtrim(to_char(v_on_hand, 'FM999999990.###'), '.') || ' ' ||
           case when v_prod.unit = 'unit' and v_on_hand <> 1 then 'units' else v_prod.unit end;

  if not v_used and not v_opening_only then
    return jsonb_build_object('mode', 'delete', 'message', 'Nothing has been recorded for this product, so it will be deleted completely.');
  elsif v_opening_only then
    return jsonb_build_object('mode', 'void_opening', 'message',
      format('The opening stock you entered (%s) will be cancelled. It was never sold, so this doesn''t count as a cost. The product will be archived.', v_qty));
  elsif v_on_hand > 0 then
    return jsonb_build_object('mode', 'blocked', 'message',
      format('%s still has %s in stock. Sell it, or use "Adjust stock" on the product page to bring it to zero, then remove it.', v_prod.name, v_qty));
  else
    return jsonb_build_object('mode', 'archive', 'message',
      'This product has sales or stock history, so it will be archived: hidden from lists and new sales, but kept in past reports. You can restore it any time.');
  end if;
end $$;

create or replace function public.remove_product(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_b uuid := (p->>'business_id')::uuid; v_id uuid := (p->>'product_id')::uuid;
  v_check jsonb; v_mode text; v_prod products; r record;
  v_reason text := coalesce(nullif(trim(p->>'reason'), ''), 'Entered by mistake');
begin
  v_check := product_removal_check(p);           -- also checks the role
  v_mode := v_check->>'mode';
  select * into v_prod from products where id = v_id for update;
  perform set_config('app.reason', v_reason, true);

  if v_mode = 'blocked' then
    raise exception '%', v_check->>'message';
  elsif v_mode = 'restore' then
    update products set is_active = true, updated_at = now() where id = v_id;
    return 'restored';
  elsif v_mode = 'delete' then
    insert into audit_log (business_id, table_name, record_id, action, user_id, old, reason)
    values (v_b, 'products', v_id, 'remove', auth.uid(), to_jsonb(v_prod), v_reason);
    delete from products where id = v_id;
    return 'deleted';
  elsif v_mode = 'void_opening' then
    -- Cancel each opening stock entry on its own date, so stock history reads as if it was never there.
    for r in select * from cost_layers where product_id = v_id and voided_at is null and source_type = 'opening' loop
      update cost_layers set voided_at = now() where id = r.id;
      insert into inventory_transactions (business_id, product_id, date, kind, qty_change, cost_change, source_type, source_id, note, created_by)
      values (v_b, v_id, r.layer_date, 'void_reversal', -r.qty_in, -r.total_cost, 'cost_layer', r.id, v_reason, auth.uid());
    end loop;
    update products set is_active = false, updated_at = now() where id = v_id;
    return 'archived';
  else
    update products set is_active = false, updated_at = now() where id = v_id;
    return 'archived';
  end if;
end $$;

revoke execute on function public.product_removal_check(jsonb), public.remove_product(jsonb) from public, anon;
grant execute on function public.product_removal_check(jsonb), public.remove_product(jsonb) to authenticated;
