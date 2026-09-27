// Independent check: recompute the dashboard's key numbers straight from the raw tables with plain SQL
// (NOT using any fin_* function or the TypeScript engine), then compare with what the app shows.
import { createPool, withUser, read } from "../src/lib/db/core";
import { calculatePnl, calculateCashFlow, resolvePeriod, todayIn, formatMoney, type PnlInputs, type CashAccountRow, type PeriodKey } from "../src/lib/finance";

async function main() {
  const pool = createPool(`postgres://postgres@localhost:54322/${process.env.SEED_DB ?? "ledgr"}`);
  const raw = (sql: string, p: unknown[]) => pool.query(sql, p).then((r) => r.rows[0]);
  const { rows: [u] } = await pool.query("select id from auth.users where email='demo@ledgr.ng'");
  const { rows: [{ id: b }] } = await pool.query("select b.id from businesses b join business_members m on m.business_id=b.id where m.user_id=$1", [u.id]);
  const today = todayIn();
  let fails = 0;
  const check = (label: string, app: number, independent: number) => {
    const ok = app === independent;
    if (!ok) fails++;
    console.log(`${ok ? "✓" : "✗"} ${label.padEnd(38)} app ${formatMoney(app, { exact: true }).padStart(18)}   raw ${formatMoney(independent, { exact: true }).padStart(18)}`);
  };

  for (const key of ["this_week", "this_month", "last_month"] as PeriodKey[]) {
    const p = resolvePeriod(key, today);
    console.log(`\n${p.label} (${p.from} → ${p.to})`);
    const app = await withUser(pool, u.id, async (db) => {
      const [{ r }] = await read<{ r: PnlInputs }>(db, "select fin_pnl($1,$2,$3) r", [b, p.from, p.to]);
      const cash = await read<CashAccountRow>(db, "select * from fin_cash_accounts($1,$2,$3)", [b, p.from, p.to]);
      return { pnl: calculatePnl(r), cash: calculateCashFlow(cash) };
    });

    // --- Independent SQL ---
    const sales = await raw(`select coalesce(sum(si.net_amount),0)::bigint net, coalesce(sum(si.cogs) filter (where si.cogs is not null),0)::bigint cogs,
        coalesce(sum(si.net_amount) filter (where si.cogs is null),0)::bigint miss
      from sale_items si join sales s on s.id=si.sale_id where s.business_id=$1 and s.voided_at is null and s.date between $2 and $3`, [b, p.from, p.to]);
    const rets = await raw(`select coalesce(sum(ri.net_reversed),0)::bigint net, coalesce(sum(ri.cogs_reversed) filter (where ri.cogs_reversed is not null),0)::bigint cogs,
        coalesce(sum(ri.net_reversed) filter (where ri.cogs_reversed is null),0)::bigint miss
      from sale_return_items ri join sale_returns r on r.id=ri.return_id join sales s on s.id=r.sale_id
      where r.business_id=$1 and r.voided_at is null and s.voided_at is null and r.date between $2 and $3`, [b, p.from, p.to]);
    const adj = await raw(`select coalesce(sum(cost_effect),0)::bigint t from stock_adjustments
      where business_id=$1 and voided_at is null and date between $2 and $3`, [b, p.from, p.to]);
    const oneTime = await raw(`select coalesce(sum(e.amount),0)::bigint t from expenses e join expense_categories c on c.id=e.category_id
      where e.business_id=$1 and e.voided_at is null and c.kind='operating' and e.date between $2 and $3`, [b, p.from, p.to]);
    // Recurring accrual recomputed day by day in SQL here, independently of app_recurring_daily:
    // month amount = cumulative share of the yearly/quarterly amount; day amount = cumulative share of the month amount.
    const recurring = await raw(`
      with d as (
        select re.amount, re.frequency, re.start_date, g::date as dd from recurring_expenses re
        join expense_categories c on c.id = re.category_id
        cross join generate_series(greatest($2::date, re.start_date), least($3::date, coalesce(re.end_date, $3::date)), '1 day') g
        where re.business_id=$1 and c.kind='operating'
      ), x as (
        select *, extract(day from dd)::int dom, extract(day from date_trunc('month', dd) + interval '1 month - 1 day')::int dim,
          ((extract(year from dd)*12+extract(month from dd)) - (extract(year from start_date)*12+extract(month from start_date)))::int k from d
      ), m as (
        select *, case frequency
          when 'monthly' then amount::numeric
          when 'quarterly' then floor(amount::numeric*((k%3)+1)/3) - floor(amount::numeric*(k%3)/3)
          when 'annual' then floor(amount::numeric*((k%12)+1)/12) - floor(amount::numeric*(k%12)/12) end mamt from x
      )
      select coalesce(sum(case frequency
        when 'daily' then amount
        when 'weekly' then floor(amount::numeric*(((dd-start_date)%7)+1)/7) - floor(amount::numeric*((dd-start_date)%7)/7)
        else floor(mamt*dom/dim) - floor(mamt*(dom-1)/dim) end),0)::bigint t from m`, [b, p.from, p.to]);
    const cashClose = await raw(`select (select coalesce(sum(opening_balance),0) from cash_accounts where business_id=$1)
        + coalesce((select sum(case direction when 'in' then amount else -amount end) from cash_transactions where business_id=$1 and voided_at is null and date <= $2),0) t`, [b, p.to]);

    const revenue = Number(sales.net) - Number(rets.net);
    const cogs = Number(sales.cogs) - Number(rets.cogs) + Number(adj.t);
    const covered = revenue - (Number(sales.miss) - Number(rets.miss));
    const opex = Number(oneTime.t) + Number(recurring.t);
    check("Revenue", app.pnl.revenue, revenue);
    check("Cost of goods sold", app.pnl.cogs, cogs);
    check("Gross profit", app.pnl.grossProfit, covered - cogs);
    check("Operating expenses", app.pnl.operatingExpenses, opex);
    check("Operating profit", app.pnl.operatingProfit, covered - cogs - opex);
    check("Closing cash", app.cash.closing, Number(cashClose.t));
  }

  // Receivables today: every live invoice total − returns − allocated payments + refunds
  const recApp = await withUser(pool, u.id, (db) => read<{ outstanding: number }>(db, "select * from fin_receivables($1,$2)", [b, today]));
  const recRaw = await raw(`select coalesce(sum(greatest(s.total
      - coalesce((select sum(r.total) from sale_returns r where r.sale_id=s.id and r.voided_at is null),0)
      - coalesce((select sum(pa.amount) from payment_allocations pa join cash_transactions ct on ct.id=pa.cash_transaction_id where pa.target_type='sale' and pa.target_id=s.id and ct.voided_at is null),0)
      + coalesce((select sum(ct.amount) from cash_transactions ct join sale_returns r on ct.source_type='sale_return' and ct.source_id=r.id where r.sale_id=s.id and ct.voided_at is null and ct.kind='refund'),0), 0)),0)::bigint t
    from sales s where s.business_id=$1 and s.voided_at is null`, [b]);
  console.log("\nToday");
  check("Customers owe you", recApp.reduce((a, r) => a + r.outstanding, 0), Number(recRaw.t));
  const payApp = await withUser(pool, u.id, (db) => read<{ outstanding: number }>(db, "select * from fin_payables($1,$2)", [b, today]));
  const payRaw = await raw(`select coalesce(sum(p.total - coalesce((select sum(pa.amount) from payment_allocations pa join cash_transactions ct on ct.id=pa.cash_transaction_id
      where pa.target_type='purchase' and pa.target_id=p.id and ct.voided_at is null),0)),0)::bigint t from purchases p where p.business_id=$1 and p.voided_at is null`, [b]);
  check("You owe suppliers", payApp.reduce((a, r) => a + r.outstanding, 0), Number(payRaw.t));
  const invApp = await withUser(pool, u.id, (db) => read<{ value: number }>(db, "select * from fin_inventory($1)", [b]));
  const invRaw = await raw(`select coalesce(sum(cl.total_cost),0) - coalesce((select sum(ca.cost) from cost_allocations ca join cost_layers l on l.id=ca.cost_layer_id where l.business_id=$1 and l.voided_at is null and ca.reversed_at is null),0) t
    from cost_layers cl where cl.business_id=$1 and cl.voided_at is null`, [b]);
  check("Stock value", invApp.reduce((a, r) => a + r.value, 0), Number(invRaw.t));

  console.log(fails ? `\n✗ ${fails} mismatch(es)` : "\n✓ All figures match an independent calculation from the raw records.");
  await pool.end();
  process.exit(fails ? 1 : 0);
}
main();
