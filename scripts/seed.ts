// Seeds a realistic 12-week history for an Abuja fruit-juice business, ending today (Lagos time).
// Everything is posted through the same functions the app uses, so the numbers are real.
// Usage: tsx scripts/seed.ts   → resets the `ledgr` database, creates demo@ledgr.ng / ledgr-demo
import { resetDatabase } from "./db-reset";
import { createPool, withUser, rpc, read, type Db } from "../src/lib/db/core";
import { addDays, startOfWeek, todayIn, diffDays } from "../src/lib/finance/periods";

const DB = process.env.SEED_DB ?? "ledgr";
const N = (naira: number) => Math.round(naira * 100);

// Deterministic randomness so the demo looks the same every time.
let seed = 20260927;
const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const between = (a: number, b: number) => a + (b - a) * rand();
const int = (a: number, b: number) => Math.floor(between(a, b + 1));
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

async function main() {
  await resetDatabase(DB);
  const pool = createPool(`postgres://postgres@localhost:54322/${DB}`);
  const { rows: [user] } = await pool.query(
    `insert into auth.users (email, encrypted_password, raw_user_meta_data)
     values ('demo@ledgr.ng', extensions.crypt('ledgr-demo', extensions.gen_salt('bf')), '{"full_name":"Moses Mshelia"}') returning id`);
  const as = <T,>(fn: (db: Db) => Promise<T>) => withUser(pool, user.id, fn);

  const today = todayIn("Africa/Lagos");
  const start = addDays(startOfWeek(today), -7 * 11); // Monday, 12 weeks ago (incl. this week)
  const weeks = Math.floor(diffDays(today, start) / 7) + 1;

  const b = await as((db) => rpc<string>(db, "create_business", {
    name: "Tropic Press Juices", business_type: "Fresh juice production & retail", owner_name: "Moses Mshelia",
    phone: "0800 000 0000", email: "hello@tropicpress.ng", address: "Plot 12, Aminu Kano Crescent, Wuse 2, Abuja",
    default_payment_terms_days: 14,
    accounts: [
      { name: "Cash drawer", type: "cash", opening_balance: N(250_000), opening_date: start },
      { name: "GTBank current", type: "bank", opening_balance: N(1_800_000), opening_date: start },
      { name: "Moniepoint POS", type: "pos", opening_balance: 0, opening_date: start },
    ],
  }));
  const q = <T = Record<string, unknown>,>(sql: string, p: unknown[] = []) => as((db) => read<T>(db, sql, p));
  const post = <T = string,>(fn: string, payload: Record<string, unknown>) => as((db) => rpc<T>(db, fn, { business_id: b, ...payload }));

  const acc = Object.fromEntries((await q<{ id: string; type: string }>("select id, type from cash_accounts where business_id=$1", [b])).map((a) => [a.type, a.id]));
  const cat = Object.fromEntries((await q<{ id: string; name: string }>("select id, name from expense_categories where business_id=$1", [b])).map((c) => [c.name, c.id]));
  const walkIn = (await q<{ id: string }>("select id from customers where business_id=$1 and is_walk_in", [b]))[0].id;

  // ---------- Team: one demo login per role (all use password ledgr-demo) ----------
  const team: Record<string, string> = {};
  for (const [role, email, name, costs] of [
    ["accountant", "accountant@ledgr.ng", "Ngozi Eze", true], ["sales", "sales@ledgr.ng", "Amina Bello", false], ["viewer", "viewer@ledgr.ng", "Tunde Ade", false],
  ] as const) {
    const { rows: [u] } = await pool.query(`insert into auth.users (email, encrypted_password, raw_user_meta_data)
      values ($1, extensions.crypt('ledgr-demo', extensions.gen_salt('bf')), jsonb_build_object('full_name', $2::text)) returning id`, [email, name]);
    const token = await post("create_invite", { email, role, can_see_costs: costs });
    await withUser(pool, u.id, (db) => rpc(db, "accept_invite", { token }));
    await pool.query("insert into public.profiles (user_id, full_name, display_name) values ($1, $2, split_part($2, ' ', 1)) on conflict do nothing", [u.id, name]);
    team[role] = u.id;
  }
  await post("create_invite", { email: "driver@tropicpress.ng", role: "sales" }); // a pending invitation to show in Settings

  // ---------- Master data ----------
  const pc = async (name: string) => (await q<{ id: string }>("insert into product_categories (business_id, name) values ($1,$2) returning id", [b, name]))[0].id;
  const catJuice = await pc("Fresh juices"), catSmoothie = await pc("Smoothies"), catRetail = await pc("Drinks & snacks"), catRaw = await pc("Raw materials");
  const product = async (name: string, o: { sku: string; cat: string; price?: number; std?: number | null; unit?: string; sellable?: boolean; min?: number }) =>
    (await q<{ id: string }>(
      "insert into products (business_id, name, sku, category_id, selling_price, standard_cost, unit, is_sellable, min_stock) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id",
      [b, name, o.sku, o.cat, o.price ? N(o.price) : null, o.std ? N(o.std) : null, o.unit ?? "unit", o.sellable ?? true, o.min ?? 0]))[0].id;

  const raw = {
    orange: await product("Oranges", { sku: "RAW-ORG", cat: catRaw, unit: "kg", sellable: false, std: 900, min: 50 }),
    pineapple: await product("Pineapples", { sku: "RAW-PIN", cat: catRaw, unit: "pcs", sellable: false, std: 1_200, min: 20 }),
    watermelon: await product("Watermelon", { sku: "RAW-WML", cat: catRaw, unit: "kg", sellable: false, std: 600, min: 40 }),
    ginger: await product("Ginger", { sku: "RAW-GNG", cat: catRaw, unit: "kg", sellable: false, std: 3_000, min: 3 }),
    sugar: await product("Sugar", { sku: "RAW-SUG", cat: catRaw, unit: "kg", sellable: false, std: 1_600, min: 10 }),
    bottle: await product("PET bottles", { sku: "PKG-BTL", cat: catRaw, unit: "pcs", sellable: false, std: 180, min: 300 }),
    label: await product("Labels", { sku: "PKG-LBL", cat: catRaw, unit: "pcs", sellable: false, std: 40, min: 300 }),
  };
  // Produced juices: recipe per unit (raw qty) + cash direct cost per unit + labour per unit
  const made = [
    { id: await product("Orange juice 50cl", { sku: "OJ-50", cat: catJuice, price: 1_800, min: 30 }), price: 1_800, weekly: 180,
      recipe: { orange: 0.9, sugar: 0.05 }, extra: 0, extraLabel: "" },
    { id: await product("Pineapple & ginger 50cl", { sku: "PG-50", cat: catJuice, price: 1_800, min: 20 }), price: 1_800, weekly: 120,
      recipe: { pineapple: 0.35, ginger: 0.03, sugar: 0.04 }, extra: 0, extraLabel: "" },
    { id: await product("Watermelon juice 50cl", { sku: "WM-50", cat: catJuice, price: 1_700, min: 20 }), price: 1_700, weekly: 100,
      recipe: { watermelon: 1.1 }, extra: 0, extraLabel: "" },
    { id: await product("Tropical mix 1L", { sku: "TM-1L", cat: catJuice, price: 3_500, min: 12 }), price: 3_500, weekly: 60,
      recipe: { orange: 1, pineapple: 0.3, watermelon: 0.6 }, extra: 0, extraLabel: "" },
    { id: await product("Zobo 50cl", { sku: "ZB-50", cat: catJuice, price: 1_000, min: 30 }), price: 1_000, weekly: 150,
      recipe: { sugar: 0.06, ginger: 0.01 }, extra: 150, extraLabel: "Hibiscus leaves & spices" },
    { id: await product("Green smoothie 35cl", { sku: "GS-35", cat: catSmoothie, price: 2_500, min: 10 }), price: 2_500, weekly: 70,
      recipe: { pineapple: 0.2, ginger: 0.01 }, extra: 500, extraLabel: "Spinach, cucumber & apples" },
  ];
  const bought = [
    { id: await product("Greek yoghurt 500g", { sku: "YG-500", cat: catRetail, price: 3_000, min: 24 }), price: 3_000, cost: 2_300, weekly: 30 },
    { id: await product("Bottled water 75cl ×12", { sku: "WTR-12", cat: catRetail, price: 2_400, min: 10 }), price: 2_400, cost: 1_800, weekly: 20 },
    { id: await product("Coconut water 330ml", { sku: "CCW-33", cat: catRetail, price: 1_400, min: 24 }), price: 1_400, cost: 900, weekly: 40 },
    { id: await product("Chin chin pack", { sku: "CC-PK", cat: catRetail, price: 800, min: 20 }), price: 800, cost: 500, weekly: 50 },
  ];
  // A new line with no cost recorded yet → demonstrates "missing cost".
  const kunu = await product("Tiger nut drink (kunu) 50cl", { sku: "KN-50", cat: catJuice, price: 1_200 });

  const cust = async (name: string, terms: number, phone: string) =>
    (await q<{ id: string }>("insert into customers (business_id, name, payment_terms_days, phone) values ($1,$2,$3,$4) returning id", [b, name, terms, phone]))[0].id;
  const greenleaf = await cust("Greenleaf Supermarket, Jabi", 30, "0803 111 2233");
  const pulse = await cust("Pulse Fitness, Wuse 2", 7, "0805 222 3344");
  const bluebell = await cust("Bluebell Café, Maitama", 14, "0807 333 4455");
  const harmony = await cust("Harmony Events", 14, "0809 444 5566");
  const crescent = await cust("Crescent Hotel, Garki", 30, "0802 555 6677");
  const kidz = await cust("Kidz Academy, Gwarinpa", 14, "0806 666 7788");
  const nkechi = await cust("Mama Nkechi Kiosk", 7, "0708 777 8899");

  const sup = async (name: string, contact: string) =>
    (await q<{ id: string }>("insert into suppliers (business_id, name, contact_name, phone) values ($1,$2,$3,'0800 000 0000') returning id", [b, name, contact]))[0].id;
  const fruits = await sup("Dei-Dei Fruit Traders", "Alhaji Musa");
  const packaging = await sup("Abuja Bottles & Packaging", "Mrs. Okafor");
  const dairy = await sup("Dairy Fresh Distributors", "Tunde");
  const aqua = await sup("Aqua Pure Water Co.", "Emeka");
  const snacks = await sup("Crunchy Bites Snacks", "Aisha");

  // ---------- Recurring expenses ----------
  const recurring = async (name: string, c: string, amount: number, frequency: string, sd: string, account: string) =>
    (await q<{ id: string }>("insert into recurring_expenses (business_id, name, category_id, amount, frequency, start_date, cash_account_id) values ($1,$2,$3,$4,$5,$6,$7) returning id",
      [b, name, cat[c], N(amount), frequency, sd, account]))[0].id;
  const monthStart = start.slice(0, 8) + "01";
  const rent = await recurring("Shop rent (Wuse 2)", "Rent", 1_800_000, "annual", monthStart, acc.bank);
  const salaries = await recurring("Staff salaries (3)", "Salaries", 450_000, "monthly", monthStart, acc.bank);
  const diesel = await recurring("Generator diesel", "Generator & fuel", 35_000, "weekly", start, acc.cash);
  const power = await recurring("Electricity (prepaid meter)", "Electricity", 60_000, "monthly", monthStart, acc.pos);
  const internet = await recurring("Internet (Spectranet)", "Internet", 25_000, "monthly", monthStart, acc.bank);
  const rider = await recurring("Delivery rider", "Logistics & delivery", 20_000, "weekly", start, acc.cash);
  const security = await recurring("Security guard", "Security", 40_000, "monthly", monthStart, acc.cash);
  const payRecurring = (id: string, account: string, date: string, amount: number) =>
    as((db) => rpc(db, "record_recurring_payment", { recurring_expense_id: id, account_id: account, date, amount: N(amount) }));

  // Prepaid rent: the whole year paid on day one (cash out now, expense spread over 12 months).
  await payRecurring(rent, acc.bank, start, 1_800_000);

  const expense = (date: string, name: string, c: string, amount: number, account: string, vendor?: string) =>
    post("create_expense", { date, name, category_id: cat[c], amount: N(amount), account_id: account, vendor });

  // ---------- Week by week ----------
  const pendingPayments: { date: string; customer: string; amount: number }[] = [];
  const unitsOf = (w: number) => (w === 3 ? 0.6 : 1) * (1 + w * 0.012); // week 4 (index 3) is a bad week; slow growth otherwise
  let orangePrice = 850;

  for (let w = 0; w < weeks; w++) {
    const mon = addDays(start, 7 * w);
    const lastDay = w === weeks - 1 ? today : addDays(mon, 6);
    const daysThisWeek = diffDays(lastDay, mon) + 1;
    const factor = unitsOf(w) * (daysThisWeek / 7);
    orangePrice = Math.round(orangePrice * between(1.0, 1.035)); // fruit prices creep up (margin squeeze)

    // Plan demand, then buy raw materials and produce enough to cover it.
    const demand = made.map((m) => Math.round(m.weekly * factor * between(0.9, 1.1)));
    const retailDemand = bought.map((r) => Math.round(r.weekly * factor * between(0.85, 1.15)));
    const need: Record<string, number> = {};
    made.forEach((m, i) => {
      const qty = Math.ceil(demand[i] * 1.03);
      for (const [k, v] of Object.entries(m.recipe)) need[k] = (need[k] ?? 0) + v * qty;
    });
    const produceQty = made.map((m, i) => Math.ceil(demand[i] * 1.03));
    const bottlesNeeded = produceQty.reduce((a, x) => a + x, 0);

    if (w % 4 === 0) {
      // Monthly packaging order on credit; paid ~2 weeks later (except the latest one → payable).
      const pq = Math.ceil(bottlesNeeded * 4.4 / 100) * 100;
      const pur = await post("post_purchase", { supplier_id: packaging, date: mon, supplier_invoice_no: `ABP-${2400 + w}`,
        due_date: addDays(mon, 21), items: [{ product_id: raw.bottle, qty: pq, unit_cost: N(175) }, { product_id: raw.label, qty: pq, unit_cost: N(38) }],
        costs: [{ kind: "shipping", amount: N(15_000), description: "Delivery to shop" }] });
      const payDate = addDays(mon, 14);
      if (payDate <= today && w < 8) {
        const [{ total }] = await q<{ total: number }>("select total from purchases where id=$1", [pur]);
        await post("record_payment", { party: "supplier", party_id: packaging, account_id: acc.bank, date: payDate, amount: total });
      }
    }
    // Weekly fruit run (paid cash on the spot).
    const fruitItems = [
      { product_id: raw.orange, qty: Math.ceil((need.orange ?? 0) * 1.02), unit_cost: N(orangePrice) },
      { product_id: raw.pineapple, qty: Math.ceil((need.pineapple ?? 0) * 1.02), unit_cost: N(Math.round(1_150 * between(0.97, 1.08))) },
      { product_id: raw.watermelon, qty: Math.ceil((need.watermelon ?? 0) * 1.02), unit_cost: N(Math.round(580 * between(0.95, 1.1))) },
      { product_id: raw.ginger, qty: Math.ceil((need.ginger ?? 0) * 1.05 * 10) / 10, unit_cost: N(3_000) },
      { product_id: raw.sugar, qty: Math.ceil((need.sugar ?? 0) * 1.05), unit_cost: N(1_600) },
    ].filter((i) => i.qty > 0);
    const fruitTotal = fruitItems.reduce((a, i) => a + Math.round(i.qty * i.unit_cost), 0) + N(8_000);
    await post("post_purchase", { supplier_id: fruits, date: mon, supplier_invoice_no: `DD-${w + 1}`, items: fruitItems,
      costs: [{ kind: "shipping", amount: N(8_000), description: "Keke transport from market" }],
      payment: { account_id: acc.bank, amount: fruitTotal } });

    // Produce the week's juice (Monday) — consumes fruit, bottles, labels from stock.
    for (let i = 0; i < made.length; i++) {
      const m = made[i]; const qty = produceQty[i];
      const costs: Record<string, unknown>[] = Object.entries(m.recipe).map(([k, v]) => ({
        kind: "materials", consumed_product_id: raw[k as keyof typeof raw], consumed_qty: Math.round(v * qty * 1000) / 1000 }));
      costs.push({ kind: "packaging", consumed_product_id: raw.bottle, consumed_qty: qty, description: "Bottles" });
      costs.push({ kind: "packaging", consumed_product_id: raw.label, consumed_qty: qty, description: "Labels" });
      costs.push({ kind: "labour", amount: N(100 * qty), description: "Juicing & bottling labour", account_id: acc.cash });
      if (m.extra) costs.push({ kind: "materials", amount: N(m.extra * qty), description: m.extraLabel, account_id: acc.cash });
      await post("post_production", { product_id: m.id, date: mon, qty, costs });
    }

    // Retail stock: fortnightly orders; the dairy order in week 10 is on credit and still unpaid.
    if (w % 2 === 0) {
      const lookahead = w === weeks - 2 ? 1.15 : 2.1;
      const items = (s: typeof bought) => s.map((r) => ({ product_id: r.id, qty: Math.ceil(r.weekly * unitsOf(w) * lookahead), unit_cost: N(r.cost) }));
      const yogQty = w >= weeks - 2 ? Math.ceil(bought[0].weekly * 1.2) : Math.ceil(bought[0].weekly * unitsOf(w) * lookahead);
      const dairyPur = await post("post_purchase", { supplier_id: dairy, date: mon, supplier_invoice_no: `DF-${w + 1}`,
        items: [{ product_id: bought[0].id, qty: yogQty, unit_cost: N(bought[0].cost) }] });
      if (w !== 10) {
        const [{ total }] = await q<{ total: number }>("select total from purchases where id=$1", [dairyPur]);
        await post("record_payment", { party: "supplier", party_id: dairy, account_id: acc.bank, date: addDays(mon, 3) <= today ? addDays(mon, 3) : mon, amount: total });
      }
      const [water, coco, chin] = items(bought.slice(1));
      const aquaTotal = Math.round(water.qty * water.unit_cost) + Math.round(coco.qty * coco.unit_cost);
      await post("post_purchase", { supplier_id: aqua, date: mon, supplier_invoice_no: `AQ-${w + 1}`, items: [water, coco], payment: { account_id: acc.bank, amount: aquaTotal } });
      await post("post_purchase", { supplier_id: snacks, date: mon, supplier_invoice_no: `CB-${w + 1}`, items: [chin], payment: { account_id: acc.cash, amount: Math.round(chin.qty * chin.unit_cost) } });
    }

    // Top up retail stock if this week's demand is higher than what's on the shelf.
    for (let i = 0; i < bought.length; i++) {
      const [{ avail }] = await q<{ avail: number }>("select app_available_qty($1) avail", [bought[i].id]);
      const short = retailDemand[i] - avail;
      if (short > 0) {
        const qty = short + (i === 0 && w >= weeks - 2 ? 2 : Math.ceil(bought[i].weekly * 0.1));
        const supplier = i === 0 ? dairy : i === 3 ? snacks : aqua;
        await post("post_purchase", { supplier_id: supplier, date: mon, supplier_invoice_no: `TOP-${w + 1}-${i}`,
          items: [{ product_id: bought[i].id, qty, unit_cost: N(bought[i].cost) }],
          payment: { account_id: acc.bank, amount: N(bought[i].cost) * qty } });
      }
    }

    // Sales: B2B orders first (they're booked ahead), walk-ins share the rest day by day.
    const remaining = made.map((m, i) => ({ id: m.id, price: m.price, left: demand[i] }))
      .concat(bought.map((r, i) => ({ id: r.id, price: r.price, left: retailDemand[i] })));
    const take = (idx: number, qty: number) => { const r = remaining[idx]; const t = Math.min(r.left, qty); r.left -= t; return t; };
    const b2b: { customer: string; day: number; terms: number; lines: [number, number][]; pay: "full" | "half" | "none" | "later" }[] = [
      { customer: greenleaf, day: 1, terms: 30, lines: [[0, 36], [1, 24], [2, 18], [3, 12]], pay: "later" },
      { customer: pulse, day: 2, terms: 7, lines: [[5, 20], [1, 12]], pay: "later" },
      { customer: bluebell, day: 3, terms: 14, lines: [[0, 18], [4, 24], [3, 6]], pay: "later" },
    ];
    if (w % 2 === 1) b2b.push({ customer: kidz, day: 4, terms: 14, lines: [[4, 40], [2, 20]], pay: "later" });
    if (w === 2) b2b.push({ customer: crescent, day: 2, terms: 30, lines: [[3, 24], [0, 30], [1, 30]], pay: "none" }); // becomes overdue
    if (w === 9) b2b.push({ customer: harmony, day: 5, terms: 14, lines: [[0, 60], [4, 80], [5, 30]], pay: "half" }); // partial payment
    if (w % 3 === 0) b2b.push({ customer: nkechi, day: 0, terms: 7, lines: [[4, 30], [9, 20]], pay: "full" });

    for (const o of b2b) {
      if (o.day >= daysThisWeek) continue;
      const date = addDays(mon, o.day);
      const items = o.lines.map(([idx, qty]) => ({ product_id: remaining[idx].id, qty: take(idx, Math.round(qty * unitsOf(w))), unit_price: N(Math.round(remaining[idx].price * 0.9)) }))
        .filter((i) => i.qty > 0);
      if (!items.length) continue;
      const total = items.reduce((a, i) => a + i.qty * i.unit_price, 0);
      const pay = o.pay === "full" ? total : o.pay === "half" ? Math.round(total / 2) : 0;
      await post("post_sale", { customer_id: o.customer, date, items, due_date: addDays(date, o.terms),
        payment: pay ? { account_id: acc.bank, amount: pay } : undefined });
      if (o.pay === "later") pendingPayments.push({ date: addDays(date, o.terms + int(-4, 6)), customer: o.customer, amount: total });
    }

    for (let d = 0; d < daysThisWeek; d++) {
      const date = addDays(mon, d);
      const share = 1 / (daysThisWeek - d);
      const items = remaining.map((r) => ({ product_id: r.id, qty: Math.round(r.left * share * between(0.85, 1.15)), unit_price: N(r.price) }))
        .map((it, idx) => ({ ...it, qty: d === daysThisWeek - 1 ? remaining[idx].left : Math.min(it.qty, remaining[idx].left) }))
        .filter((it) => it.qty > 0);
      items.forEach((it) => { const r = remaining.find((x) => x.id === it.product_id)!; r.left -= it.qty; });
      if (!items.length) continue;
      const total = items.reduce((a, i) => a + i.qty * i.unit_price, 0);
      // Counter sales: split between POS and cash as two sales.
      const posShare = Math.round(items.length * 0.6);
      const posItems = items.slice(0, posShare), cashItems = items.slice(posShare);
      for (const [its, account] of [[posItems, acc.pos], [cashItems, acc.cash]] as const) {
        if (!its.length) continue;
        const t = its.reduce((a, i) => a + i.qty * i.unit_price, 0);
        await post("post_sale", { customer_id: walkIn, date, items: its, payment: { account_id: account, amount: t }, notes: "Counter sales",
          salesperson_id: account === acc.cash ? team.sales : undefined });
      }
      void total;
    }

    // Missing-cost product sold before any stock/cost was recorded.
    if (w >= weeks - 2) {
      await post("post_sale", { customer_id: walkIn, date: addDays(mon, Math.min(2, daysThisWeek - 1)), allow_negative_stock: true,
        items: [{ product_id: kunu, qty: 12, unit_price: N(1_200) }], payment: { account_id: acc.cash, amount: N(14_400) }, notes: "Trial batch from a partner" });
    }

    // Collect B2B payments that have come due.
    for (const p of pendingPayments.filter((p) => p.date <= lastDay && p.date >= mon)) {
      const [{ owed }] = await q<{ owed: number }>(
        "select coalesce(sum(app_sale_outstanding(id)),0)::bigint owed from sales where customer_id=$1 and voided_at is null and date <= $2", [p.customer, p.date]);
      const amt = Math.min(owed, p.amount);
      if (amt > 0) await post("record_payment", { party: "customer", party_id: p.customer, account_id: acc.bank, date: p.date, amount: amt });
    }

    // Weekly running costs (cash) + month-end salaries etc.
    if (diffDays(lastDay, mon) >= 5) {
      await payRecurring(diesel, acc.cash, addDays(mon, 5), 35_000);
      await payRecurring(rider, acc.cash, addDays(mon, 5), 20_000);
    }
    for (let d = 0; d < daysThisWeek; d++) {
      const date = addDays(mon, d);
      const next = addDays(date, 1);
      if (next.slice(8) === "01") { // last day of month
        await payRecurring(salaries, acc.bank, date, 450_000);
        await payRecurring(internet, acc.bank, date, 25_000);
        await payRecurring(security, acc.cash, date, 40_000);
      }
      if (date.slice(8) === "05") await payRecurring(power, acc.pos, date, 60_000);
    }

    // One-time expenses.
    await expense(addDays(mon, 1), "Instagram & WhatsApp ads", "Marketing", int(12, 25) * 1_000, acc.bank, "Meta");
    await expense(addDays(mon, Math.min(3, daysThisWeek - 1)), "Market transport & keke", "Transport", int(6, 11) * 1_000, acc.cash);
    if (w % 2 === 0) await expense(addDays(mon, Math.min(4, daysThisWeek - 1)), "Cleaning supplies & ice", "Office supplies", int(8, 15) * 1_000, acc.cash);
    if (w % 4 === 1) await expense(addDays(mon, 2), "Bank charges & SMS alerts", "Bank charges", int(3, 6) * 1_000, acc.bank, "GTBank");
    if (w === 3) {
      await expense(addDays(mon, 2), "Generator overhaul (burnt alternator)", "Repairs & maintenance", 380_000, acc.bank, "Kabir Engineering");
      await expense(addDays(mon, 4), "Emergency fuel during scarcity", "Generator & fuel", 65_000, acc.cash);
    }
    if (w === 6) await expense(addDays(mon, 1), "Blender motor repair", "Repairs & maintenance", 45_000, acc.cash, "Wuse Electronics");
    if (w === weeks - 2) {
      // Logistics spike: event deliveries with hired vans.
      await expense(addDays(mon, 3), "Van hire for event deliveries", "Logistics & delivery", 150_000, acc.bank, "Swift Vans");
      await expense(addDays(mon, 5), "Extra dispatch riders", "Logistics & delivery", 60_000, acc.cash);
    }
    if (w === 1) await post("record_cash_movement", { kind: "loan_received", account_id: acc.bank, date: addDays(mon, 2), amount: N(1_000_000), counterparty: "LAPO Microfinance", description: "Equipment loan — cold room" });
    if (w === 1) await expense(addDays(mon, 3), "Cold room installation", "Repairs & maintenance", 90_000, acc.bank, "CoolTech");
    if (w >= 5 && w % 4 === 1) {
      await post("record_cash_movement", { kind: "loan_repayment", account_id: acc.bank, date: addDays(mon, 2), amount: N(180_000), counterparty: "LAPO Microfinance" });
      await expense(addDays(mon, 2), "Loan interest", "Loan interest", 25_000, acc.bank, "LAPO Microfinance");
    }
    if (w === 7) await post("record_cash_movement", { kind: "owner_withdrawal", account_id: acc.bank, date: addDays(mon, 4), amount: N(200_000), description: "Owner drawings" });
    // Weekly sweeps: POS settles into the bank; spare cash from the drawer is lodged at the bank.
    if (w < weeks - 1) {
      const sun = addDays(mon, 6);
      const bal = async (id: string) => (await q<{ closing: number }>("select closing from fin_cash_accounts($1,$2,$2) where account_id=$3", [b, sun, id]))[0].closing;
      const posBal = await bal(acc.pos);
      if (posBal > N(50_000)) await post("transfer_cash", { from_account_id: acc.pos, to_account_id: acc.bank, date: sun, amount: posBal - N(20_000), description: "Moniepoint settlement" });
      const cashBal = await bal(acc.cash);
      if (cashBal > N(400_000)) await post("transfer_cash", { from_account_id: acc.cash, to_account_id: acc.bank, date: sun, amount: cashBal - N(250_000), description: "Cash lodgement" });
      if (cashBal < N(150_000)) await post("transfer_cash", { from_account_id: acc.bank, to_account_id: acc.cash, date: sun, amount: N(300_000), description: "Cash withdrawal for float" });
    }
  }

  // ---------- Returns ----------
  // Greenleaf returned 10 orange juices past their date (not restocked; the cost stays as a loss).
  const [gl] = await q<{ id: string }>("select id from sales where customer_id=$1 and voided_at is null order by date desc offset 1 limit 1", [greenleaf]);
  const [glLine] = await q<{ id: string; qty: number }>("select id, qty from sale_items where sale_id=$1 and product_id=$2", [gl.id, made[0].id]);
  if (glLine) {
    const [{ date }] = await q<{ date: string }>("select date from sales where id=$1", [gl.id]);
    await as((db) => rpc(db, "post_return", { sale_id: gl.id, date: addDays(date, 2) <= today ? addDays(date, 2) : date, reason: "Past best-before date",
      restock: false, refund_method: "credit", items: [{ sale_item_id: glLine.id, qty: Math.min(10, glLine.qty) }] }));
  }
  // A walk-in customer returned 2 yoghurts (unopened, restocked, refunded in cash).
  const [ws] = await q<{ sale_id: string; id: string }>(
    "select si.sale_id, si.id from sale_items si join sales s on s.id = si.sale_id where s.business_id=$1 and si.product_id=$2 and s.customer_id=$3 and si.qty >= 2 and s.date < $4 order by s.date desc limit 1",
    [b, bought[0].id, walkIn, addDays(today, -3)]);
  if (ws) {
    const [s] = await q<{ date: string }>("select date from sales where id=$1", [ws.sale_id]);
    await as((db) => rpc(db, "post_return", { sale_id: ws.sale_id, date: addDays(s.date, 1), reason: "Customer changed mind (unopened)",
      restock: true, refund_method: "cash", account_id: acc.cash, items: [{ sale_item_id: ws.id, qty: 2 }] }));
  }

  // Budgets for last month and this month (some lines deliberately over budget).
  for (const [monthOffset, scale] of [[-1, 1], [0, 1]] as const) {
    const m = addDays(today.slice(0, 8) + "01", 0);
    const monthStart = monthOffset === 0 ? m : (() => { const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 2, 1)); return d.toISOString().slice(0, 10); })();
    const lines: [string, string | null, number][] = [
      ["revenue", null, 6_800_000], ["cogs", null, 4_100_000],
      ["category", cat["Salaries"], 450_000], ["category", cat["Rent"], 150_000], ["category", cat["Generator & fuel"], 140_000],
      ["category", cat["Logistics & delivery"], 110_000], ["category", cat["Marketing"], 60_000], ["category", cat["Electricity"], 60_000],
      ["category", cat["Internet"], 25_000], ["category", cat["Security"], 40_000], ["category", cat["Transport"], 35_000], ["category", cat["Office supplies"], 25_000],
    ];
    for (const [line, category, amount] of lines) {
      await q("insert into budgets (business_id, month, line, category_id, amount) values ($1,$2,$3,$4,$5)", [b, monthStart, line, category, N(amount * scale)]);
    }
  }

  // A stock write-off (broken bottles) a few days ago
  const [bottle] = await q<{ product_id: string; on_hand: number; name: string }>(
    "select product_id, on_hand, name from fin_inventory($1) where is_sellable and on_hand >= 4 order by on_hand desc limit 1", [b]);
  if (bottle) await post("post_stock_adjustment", { product_id: bottle.product_id, date: addDays(today, -2), qty_change: -3, reason: "3 bottles broke during delivery" });

  // Targets
  await q("insert into targets (business_id, kind, amount) values ($1,'weekly_sales',$2),($1,'monthly_sales',$3),($1,'monthly_profit',$4),($1,'gross_margin',4000)",
    [b, N(1_600_000), N(7_000_000), N(1_500_000)]);
  await post("update_business_settings", { onboarding_complete: true });

  const [counts] = await pool.query(`select
    (select count(*) from sales where business_id=$1) sales, (select count(*) from purchases where business_id=$1) purchases,
    (select count(*) from production_batches where business_id=$1) batches, (select count(*) from expenses where business_id=$1) expenses,
    (select count(*) from recurring_expenses where business_id=$1) recurring, (select count(*) from products where business_id=$1) products,
    (select count(*) from customers where business_id=$1) customers, (select count(*) from suppliers where business_id=$1) suppliers,
    (select count(*) from sale_returns where business_id=$1) returns`, [b]).then((r) => r.rows);
  console.log(`✓ Seeded "${DB}" — ${weeks} weeks from ${start} to ${today}`, counts);
  console.log("  Sign in: demo@ledgr.ng / ledgr-demo");
  await pool.end();
  void pick;
}

main().catch((e) => { console.error(e); process.exit(1); });
