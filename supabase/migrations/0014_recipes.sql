-- Recipes: "40 bottles of orange juice use 12 kg oranges, 2 kg sugar, 40 bottles".
-- Saved once per product, then "Made a batch" fills the ingredients in automatically, scaled to the batch size.
-- A recipe is a template only: stock and costs move when a batch is recorded (post_production), never here.

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  yield_qty numeric(14,3) not null check (yield_qty > 0),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id)
);

create table if not exists public.recipe_items (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  ingredient_id uuid not null references public.products(id) on delete cascade,
  qty numeric(14,3) not null check (qty > 0),
  unique (recipe_id, ingredient_id)
);
create index if not exists recipe_items_recipe on public.recipe_items (recipe_id);

alter table public.recipes enable row level security;
alter table public.recipe_items enable row level security;
drop policy if exists member_select on public.recipes;
drop policy if exists member_select on public.recipe_items;
create policy member_select on public.recipes for select using (app_is_member(business_id));
create policy member_select on public.recipe_items for select using (app_is_member(business_id));
revoke all on public.recipes, public.recipe_items from anon, public;
grant select on public.recipes, public.recipe_items to authenticated;

-- Save (create or replace) a product's recipe in one step.
-- p = { business_id, product_id, yield_qty, notes?, items: [{ ingredient_id, qty }] }. Empty items deletes the recipe.
create or replace function public.save_recipe(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_b uuid := (p->>'business_id')::uuid;
  v_prod uuid := (p->>'product_id')::uuid;
  v_yield numeric := (p->>'yield_qty')::numeric;
  v_id uuid; e jsonb; n int := 0;
begin
  perform app_require(v_b, array['owner','admin','accountant']);
  if not exists (select 1 from products where id = v_prod and business_id = v_b) then raise exception 'Product not found.'; end if;
  if jsonb_array_length(coalesce(p->'items', '[]'::jsonb)) = 0 then
    delete from recipes where product_id = v_prod and business_id = v_b;
    return null;
  end if;
  if v_yield is null or v_yield <= 0 then raise exception 'How many does one batch make? Enter a number above 0.'; end if;

  insert into recipes (business_id, product_id, yield_qty, notes, created_by)
  values (v_b, v_prod, v_yield, nullif(trim(p->>'notes'), ''), auth.uid())
  on conflict (product_id) do update set yield_qty = excluded.yield_qty, notes = excluded.notes, updated_at = now()
  returning id into v_id;

  delete from recipe_items where recipe_id = v_id;
  for e in select * from jsonb_array_elements(p->'items') loop
    if (e->>'ingredient_id')::uuid = v_prod then raise exception 'A product can''t be an ingredient of itself.'; end if;
    if not exists (select 1 from products where id = (e->>'ingredient_id')::uuid and business_id = v_b) then raise exception 'Ingredient not found.'; end if;
    if coalesce((e->>'qty')::numeric, 0) <= 0 then continue; end if;
    insert into recipe_items (recipe_id, business_id, ingredient_id, qty)
    values (v_id, v_b, (e->>'ingredient_id')::uuid, (e->>'qty')::numeric)
    on conflict (recipe_id, ingredient_id) do update set qty = recipe_items.qty + excluded.qty;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Add at least one ingredient with a quantity.'; end if;
  return v_id;
end $$;

revoke execute on function public.save_recipe(jsonb) from public, anon;
grant execute on function public.save_recipe(jsonb) to authenticated;
