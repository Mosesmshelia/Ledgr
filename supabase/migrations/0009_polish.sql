-- Phase 5: indexes for screens added in Phase 4.
create index if not exists sales_salesperson on public.sales (business_id, salesperson_id, date);
create index if not exists audit_log_business_id on public.audit_log (business_id, id desc);
create index if not exists targets_lookup on public.targets (business_id, kind, effective_from desc);
