-- Ledgr schema. All money is bigint KOBO (₦1 = 100). Quantities are numeric(14,3).
-- Documents are only written through posting functions (0003); users read via RLS (0002).

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  business_type text,
  owner_name text,
  phone text,
  email text,
  address text,
  currency char(3) not null default 'NGN',
  timezone text not null default 'Africa/Lagos',
  week_start smallint not null default 1 check (week_start between 0 and 6), -- 1 = Monday
  fy_start_month smallint not null default 1 check (fy_start_month between 1 and 12),
  vat_registered boolean not null default false,
  vat_rate_bp int not null default 750 check (vat_rate_bp between 0 and 10000),
  prices_include_vat boolean not null default false,
  costing_method text not null default 'fifo' check (costing_method in ('fifo')),
  default_payment_terms_days int not null default 7 check (default_payment_terms_days >= 0),
  next_invoice_no bigint not null default 1,
  onboarding_completed_at timestamptz,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','accountant','sales','viewer')),
  can_see_costs boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  unique (business_id, user_id)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  phone text, email text, address text,
  payment_terms_days int check (payment_terms_days >= 0),
  is_walk_in boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  contact_name text, phone text, email text, notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  unique (business_id, name)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  sku text,
  category_id uuid references public.product_categories(id),
  default_supplier_id uuid references public.suppliers(id),
  unit text not null default 'unit',
  selling_price bigint check (selling_price >= 0),
  standard_cost bigint check (standard_cost >= 0),   -- fallback estimate only
  min_stock numeric(14,3) not null default 0 check (min_stock >= 0),
  is_sellable boolean not null default true,         -- false for raw materials
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  unique (business_id, sku)
);

create table public.cash_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  type text not null check (type in ('cash','bank','pos','mobile_money','other')),
  currency char(3) not null default 'NGN',
  opening_balance bigint not null default 0,
  opening_date date not null default current_date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  kind text not null default 'operating' check (kind in ('operating','other_expense','income_tax')),
  icon text,
  is_system boolean not null default false,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  unique (business_id, name)
);

-- ---------- Purchases ----------
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  supplier_id uuid references public.suppliers(id),
  date date not null,
  due_date date,
  supplier_invoice_no text,
  allocation_method text not null default 'value' check (allocation_method in ('value','quantity')),
  currency char(3) not null default 'NGN',
  subtotal bigint not null check (subtotal >= 0),
  direct_costs_total bigint not null default 0 check (direct_costs_total >= 0),
  total bigint not null check (total >= 0),
  notes text,
  voided_at timestamptz, voided_by uuid, void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id),
  product_id uuid not null references public.products(id),
  qty numeric(14,3) not null check (qty > 0),
  unit_cost bigint not null check (unit_cost >= 0),
  line_total bigint not null check (line_total >= 0),
  allocated_direct_cost bigint not null default 0 check (allocated_direct_cost >= 0),
  landed_total bigint not null check (landed_total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table public.purchase_costs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id),
  kind text not null check (kind in ('shipping','customs','clearing','packaging','other')),
  amount bigint not null check (amount >= 0),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

-- ---------- Production ----------
create table public.production_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null references public.products(id),
  batch_no text,
  date date not null,
  qty_produced numeric(14,3) not null check (qty_produced > 0),
  total_cost bigint not null check (total_cost >= 0),
  notes text,
  voided_at timestamptz, voided_by uuid, void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table public.production_costs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  batch_id uuid not null references public.production_batches(id),
  kind text not null check (kind in ('materials','labour','packaging','transport','other')),
  amount bigint not null check (amount >= 0),
  description text,
  consumed_product_id uuid references public.products(id),
  consumed_qty numeric(14,3) check (consumed_qty > 0),
  cost_status text not null default 'actual' check (cost_status in ('actual','estimated','missing')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

-- ---------- Stock ----------
create table public.cost_layers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null references public.products(id),
  source_type text not null check (source_type in ('purchase','production','return','opening','adjustment')),
  source_id uuid,
  layer_date date not null,
  qty_in numeric(14,3) not null check (qty_in > 0),
  qty_remaining numeric(14,3) not null check (qty_remaining >= 0),
  total_cost bigint not null check (total_cost >= 0),
  consumed_cost bigint not null default 0,   -- cost already taken out; remaining value = total_cost - consumed_cost
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  check (qty_remaining <= qty_in),
  check (consumed_cost between 0 and total_cost),
  check (qty_remaining > 0 or consumed_cost = total_cost)
);

create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null references public.products(id),
  date date not null,
  kind text not null check (kind in ('opening','purchase','production','production_use','sale','return','adjustment','void_reversal')),
  qty_change numeric(14,3) not null,
  cost_change bigint not null default 0,
  source_type text not null,
  source_id uuid,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

-- ---------- Sales ----------
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  invoice_no text not null,
  customer_id uuid references public.customers(id),
  salesperson_id uuid references auth.users(id),
  date date not null,
  due_date date not null,
  currency char(3) not null default 'NGN',
  vat_rate_bp int not null default 0,
  prices_include_vat boolean not null default false,
  gross bigint not null check (gross >= 0),          -- ex-VAT, before discounts
  discount_total bigint not null default 0 check (discount_total >= 0),
  net bigint not null check (net >= 0),              -- revenue, ex-VAT
  vat_amount bigint not null default 0 check (vat_amount >= 0),
  total bigint not null check (total >= 0),          -- what the customer owes
  notes text,
  voided_at timestamptz, voided_by uuid, void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  unique (business_id, invoice_no),
  check (gross - discount_total = net),
  check (net + vat_amount = total)
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  sale_id uuid not null references public.sales(id),
  product_id uuid not null references public.products(id),
  qty numeric(14,3) not null check (qty > 0),
  unit_price bigint not null check (unit_price >= 0),
  line_discount bigint not null default 0 check (line_discount >= 0),
  gross_amount bigint not null check (gross_amount >= 0),     -- ex-VAT
  discount_amount bigint not null default 0 check (discount_amount >= 0), -- ex-VAT (line + share of invoice discount)
  net_amount bigint not null check (net_amount >= 0),         -- revenue ex-VAT
  vat_amount bigint not null default 0 check (vat_amount >= 0),
  cogs_allocated bigint not null default 0 check (cogs_allocated >= 0), -- from FIFO layers
  uncovered_qty numeric(14,3) not null default 0 check (uncovered_qty >= 0), -- sold without stock (backorder)
  estimated_unit_cost bigint check (estimated_unit_cost >= 0), -- product standard cost snapshot
  manual_unit_cost bigint check (manual_unit_cost >= 0),       -- set via "Fix missing cost"
  cogs bigint check (cogs >= 0),                               -- effective COGS; NULL = unknown
  cost_status text not null check (cost_status in ('actual','estimated','manual','missing')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  check (gross_amount - discount_amount = net_amount)
);

create table public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  sale_id uuid not null references public.sales(id),
  date date not null,
  reason text,
  restock boolean not null default true,
  refund_method text not null check (refund_method in ('cash','credit')),
  net_total bigint not null check (net_total >= 0),
  vat_total bigint not null default 0 check (vat_total >= 0),
  total bigint not null check (total >= 0),
  voided_at timestamptz, voided_by uuid, void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table public.sale_return_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  return_id uuid not null references public.sale_returns(id),
  sale_item_id uuid not null references public.sale_items(id),
  qty numeric(14,3) not null check (qty > 0),
  gross_reversed bigint not null default 0,
  discount_reversed bigint not null default 0,
  net_reversed bigint not null check (net_reversed >= 0),
  vat_reversed bigint not null default 0,
  cogs_reversed bigint,                      -- NULL when original cost unknown
  cost_status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table public.cost_allocations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  consumer_type text not null check (consumer_type in ('sale_item','production_cost')),
  consumer_id uuid not null,
  cost_layer_id uuid not null references public.cost_layers(id),
  qty numeric(14,3) not null check (qty > 0),
  cost bigint not null check (cost >= 0),
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

-- ---------- Money ----------
create table public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  account_id uuid not null references public.cash_accounts(id),
  date date not null,
  direction text not null check (direction in ('in','out')),
  amount bigint not null check (amount > 0),
  kind text not null check (kind in (
    'customer_payment','supplier_payment','expense_payment','recurring_payment','direct_cost_payment',
    'other_income','capital_injection','loan_received','loan_repayment','owner_withdrawal',
    'tax_payment','refund','transfer')),
  customer_id uuid references public.customers(id),
  supplier_id uuid references public.suppliers(id),
  counterparty text,
  reference text,
  description text,
  transfer_group_id uuid,
  source_type text,
  source_id uuid,
  voided_at timestamptz, voided_by uuid, void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  check (
    (kind in ('customer_payment','other_income','capital_injection','loan_received') and direction = 'in') or
    (kind in ('supplier_payment','expense_payment','recurring_payment','direct_cost_payment','loan_repayment','owner_withdrawal','tax_payment','refund') and direction = 'out') or
    (kind = 'transfer')
  )
);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  cash_transaction_id uuid not null references public.cash_transactions(id),
  target_type text not null check (target_type in ('sale','purchase')),
  target_id uuid not null,
  amount bigint not null check (amount > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

-- ---------- Expenses ----------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  date date not null,
  name text not null check (length(trim(name)) > 0),
  category_id uuid not null references public.expense_categories(id),
  amount bigint not null check (amount > 0),
  vendor text,
  cash_account_id uuid references public.cash_accounts(id),
  receipt_path text,
  notes text,
  voided_at timestamptz, voided_by uuid, void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  category_id uuid not null references public.expense_categories(id),
  amount bigint not null check (amount > 0),
  frequency text not null check (frequency in ('daily','weekly','monthly','quarterly','annual')),
  start_date date not null,
  end_date date,
  cash_account_id uuid references public.cash_accounts(id),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  check (end_date is null or end_date >= start_date)
);

create table public.recurring_expense_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  recurring_expense_id uuid not null references public.recurring_expenses(id),
  cash_transaction_id uuid not null references public.cash_transactions(id),
  amount bigint not null check (amount > 0),
  date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

-- ---------- Control (used from Phase 3/4, created now so the model is complete) ----------
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  line text not null check (line in ('revenue','cogs','category')),
  category_id uuid references public.expense_categories(id),
  amount bigint not null check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table public.targets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null check (kind in ('daily_sales','weekly_sales','monthly_sales','monthly_profit','gross_margin')),
  amount bigint not null check (amount >= 0),  -- kobo, or basis points for gross_margin
  effective_from date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null,
  threshold jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  rule_id uuid references public.alert_rules(id),
  kind text not null,
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  message text not null,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz, resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  business_id uuid,
  table_name text not null,
  record_id uuid,
  action text not null,
  user_id uuid,
  at timestamptz not null default now(),
  old jsonb,
  new jsonb,
  reason text
);

create table public.report_exports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  report_kind text not null,
  params jsonb not null default '{}'::jsonb,
  format text not null check (format in ('pdf','csv','xlsx')),
  file_path text,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

-- ---------- Indexes ----------
create index on public.business_members (user_id);
create index on public.products (business_id);
create index on public.customers (business_id);
create index on public.suppliers (business_id);
create index on public.purchases (business_id, date);
create index on public.purchase_items (purchase_id);
create index on public.production_batches (business_id, date);
create index on public.production_costs (batch_id);
create index cost_layers_fifo on public.cost_layers (product_id, layer_date, created_at) where qty_remaining > 0 and voided_at is null;
create index on public.cost_layers (source_type, source_id);
create index on public.inventory_transactions (business_id, product_id, date);
create index on public.sales (business_id, date);
create index on public.sales (customer_id);
create index on public.sale_items (sale_id);
create index on public.sale_items (business_id, product_id);
create index sale_items_backorder on public.sale_items (product_id, created_at) where uncovered_qty > 0;
create index on public.sale_returns (business_id, date);
create index on public.sale_returns (sale_id);
create index on public.sale_return_items (sale_item_id);
create index on public.cost_allocations (consumer_type, consumer_id);
create index on public.cost_allocations (cost_layer_id);
create index on public.cash_transactions (business_id, date);
create index on public.cash_transactions (account_id, date);
create index on public.cash_transactions (source_type, source_id);
create index on public.payment_allocations (target_type, target_id);
create index on public.payment_allocations (cash_transaction_id);
create index on public.expenses (business_id, date);
create index on public.recurring_expenses (business_id);
create index on public.recurring_expense_payments (recurring_expense_id);
create index on public.audit_log (business_id, at);

-- ---------- updated_at ----------
create or replace function public.app_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$ declare t text; begin
  for t in select table_name from information_schema.columns
           where table_schema = 'public' and column_name = 'updated_at'
  loop
    execute format('create trigger touch_%I before update on public.%I for each row execute function public.app_touch()', t, t);
  end loop;
end $$;
