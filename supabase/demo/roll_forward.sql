-- DEMO ONLY. Keeps the Tropic Press Juices sample data looking current: every night it moves all dates forward
-- so the latest sale is always "today" (Lagos time). Every figure stays identical because everything
-- moves together. Never install this on a real business's database.
create or replace function public.demo_roll_forward(p_days int default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Africa/Lagos')::date;
  last date;
  n int;       -- days to move
  m int;       -- whole months the calendar moved (for month-based rows)
  t text;
begin
  select max(date) into last from sales where voided_at is null;
  if p_days is not null then today := last + p_days; end if; -- for testing
  if last is null or last >= today then return 'nothing to do'; end if;
  n := today - last;
  m := (extract(year from today) * 12 + extract(month from today))::int - (extract(year from last) * 12 + extract(month from last))::int;

  -- Rows are already posted (costs, audit trail); triggers that forbid edits are paused for this move only.
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I disable trigger user', t);
  end loop;

  update sales set date = date + n, due_date = due_date + n;
  update sale_returns set date = date + n;
  update purchases set date = date + n, due_date = due_date + n;
  update production_batches set date = date + n;
  update cost_layers set layer_date = layer_date + n;
  update inventory_transactions set date = date + n;
  update cash_transactions set date = date + n;
  update expenses set date = date + n;
  update stock_adjustments set date = date + n;
  update recurring_expense_payments set date = date + n;
  update cash_accounts set opening_date = opening_date + n;
  update targets set effective_from = effective_from + n;
  -- Weekly/daily bills keep their weekday; monthly, quarterly and yearly bills stay on the 1st of a month.
  update recurring_expenses set
    start_date = case when frequency in ('weekly', 'daily') then start_date + n else date_trunc('month', start_date + n)::date end,
    end_date = end_date + n;
  -- Budgets are per calendar month: move them by whole months (in two steps to avoid clashing with each other).
  if m > 0 then
    update budgets set month = (month + make_interval(months => m + 1200))::date;
    update budgets set month = (month - make_interval(months => 1200))::date;
  end if;
  update invitations set expires_at = expires_at + make_interval(days => n), created_at = created_at + make_interval(days => n)
    where accepted_at is null and revoked_at is null;
  delete from alerts; -- recalculated on the next visit

  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;
  return format('moved %s days (%s months)', n, m);
end $$;

revoke all on function public.demo_roll_forward(int) from public, anon, authenticated;

-- Run nightly at 00:10 Lagos time (23:10 UTC).
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'ledgr-demo-roll-forward';
select cron.schedule('ledgr-demo-roll-forward', '10 23 * * *', 'select public.demo_roll_forward()');
