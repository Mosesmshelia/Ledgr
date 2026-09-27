// Prints a weekly P&L for the seeded business and runs the COGS reconciliation check.
import { createPool, withUser, read } from "../src/lib/db/core";
import { calculatePnl, formatMoney as m, formatPercent as pct, addDays, startOfWeek, todayIn, type PnlInputs } from "../src/lib/finance";

async function main() {
  const pool = createPool(`postgres://postgres@localhost:54322/${process.env.SEED_DB ?? "ledgr"}`);
  const { rows: [u] } = await pool.query("select id from auth.users where email='demo@ledgr.ng'");
  await withUser(pool, u.id, async (db) => {
    const [{ id: b }] = await read<{ id: string }>(db, "select id from businesses limit 1");
    const today = todayIn();
    const counts = (await db.query(`select
      (select count(*) from sales where business_id=$1)::int sales, (select count(*) from purchases where business_id=$1)::int purchases,
      (select count(*) from production_batches where business_id=$1)::int batches, (select count(*) from expenses where business_id=$1)::int expenses,
      (select count(*) from recurring_expenses where business_id=$1)::int recurring, (select count(*) from products where business_id=$1)::int products,
      (select count(*) from customers where business_id=$1)::int customers, (select count(*) from suppliers where business_id=$1)::int suppliers,
      (select count(*) from sale_returns where business_id=$1)::int returns`, [b])).rows[0];
    console.log(counts);
    let wk = addDays(startOfWeek(today), -77);
    console.log("week        revenue      GP  margin     opex       net  status");
    while (wk <= today) {
      const to = addDays(wk, 6) > today ? today : addDays(wk, 6);
      const [row] = await read<{ r: PnlInputs }>(db, "select fin_pnl($1,$2,$3) r", [b, wk, to]);
      const p = calculatePnl(row.r);
      console.log(wk, m(p.revenue, { compact: true }).padStart(9), m(p.grossProfit, { compact: true }).padStart(8), pct(p.grossMargin).padStart(7),
        m(p.operatingExpenses, { compact: true }).padStart(8), m(p.netProfit, { compact: true }).padStart(9), p.status);
      wk = addDays(wk, 7);
    }
    const cash = await read<{ name: string; closing: number }>(db, "select * from fin_cash_accounts($1,$2,$3)", [b, today, today]);
    console.log("cash:", cash.map((c) => `${c.name} ${m(c.closing)}`).join(" | "));
    const rec = await read<{ outstanding: number; status: string; customer_name: string }>(db, "select * from fin_receivables($1,$2)", [b, today]);
    console.log("receivables:", m(rec.reduce((a, r) => a + r.outstanding, 0)), rec.map((r) => `${r.customer_name}:${r.status}`).join(", "));
    const pay = await read<{ outstanding: number }>(db, "select * from fin_payables($1,$2)", [b, today]);
    console.log("payables:", m(pay.reduce((a, r) => a + r.outstanding, 0)), pay.length);
    const inv = await read<{ name: string; on_hand: number; value: number; low_stock: boolean }>(db, "select * from fin_inventory($1)", [b]);
    console.log("inventory:", m(inv.reduce((a, r) => a + r.value, 0)), "low:", inv.filter((i) => i.low_stock).map((i) => `${i.name}(${i.on_hand})`).join(", "));
    const exp = await read<{ name: string; total: number }>(db, "select * from fin_expense_breakdown($1,$2,$3)", [b, startOfWeek(today), today]);
    console.log("this week expenses:", exp.map((e) => `${e.name} ${m(e.total, { compact: true })}`).join(", "));

    // Reconciliation over the full history
    const from = addDays(startOfWeek(today), -77);
    const [{ v: open }] = await read<{ v: number }>(db, "select fin_inventory_value_at($1,$2) v", [b, addDays(from, -1)]);
    const [{ v: close }] = await read<{ v: number }>(db, "select fin_inventory_value_at($1,$2) v", [b, today]);
    const [{ adds }] = await read<{ adds: number }>(db, `select (
      coalesce((select sum(total) from purchases where business_id=$1 and voided_at is null and date between $2 and $3),0) +
      coalesce((select sum(pc.amount) from production_costs pc join production_batches pb on pb.id=pc.batch_id where pb.business_id=$1 and pb.voided_at is null and pc.consumed_product_id is null and pb.date between $2 and $3),0) +
      coalesce((select sum(cl.total_cost) from cost_layers cl where cl.business_id=$1 and cl.source_type in ('return','opening') and cl.voided_at is null and cl.layer_date between $2 and $3),0)
    )::bigint adds`, [b, from, today]);
    const [{ cogs }] = await read<{ cogs: number }>(db, "select coalesce(sum(si.cogs_allocated),0)::bigint cogs from sale_items si join sales s on s.id=si.sale_id where s.business_id=$1 and s.voided_at is null", [b]);
    // Stock written off (or found) is part of the cost of goods too (DECISIONS D-60).
    const [{ adj }] = await read<{ adj: number }>(db, "select coalesce(sum(cost_effect),0)::bigint adj from stock_adjustments where business_id=$1 and voided_at is null", [b]);
    const total = Number(cogs) + Number(adj);
    console.log(`reconciliation: opening ${m(open)} + additions ${m(adds)} − closing ${m(close)} = ${m(open + adds - close)} | FIFO COGS ${m(cogs)} + stock written off ${m(adj)} = ${m(total)} | ${open + adds - close === total ? "✓ MATCH" : "✗ MISMATCH"}`);
  });
  await pool.end();
}
main();
