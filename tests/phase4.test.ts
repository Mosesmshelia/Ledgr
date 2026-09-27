// Phase 4: roles enforced by the database, invitations, last-owner protection, stock adjustments.
import { describe, it, expect, afterAll } from "vitest";
import { pool, setup, createUser, q, N, type Ctx } from "./helpers";
import { withUser, rpc, read } from "@/lib/db/core";

afterAll(() => pool.end());

async function emailOf(uid: string) {
  const { rows } = await pool.query("select email from auth.users where id = $1", [uid]);
  return rows[0].email as string;
}

/** Owner invites a brand-new user with a role; the user accepts. Returns the user's id + helpers. */
async function join(ctx: Ctx, role: string, can_see_costs = false) {
  const uid = await createUser();
  const token = await ctx.rpc<string>("create_invite", { email: (await emailOf(uid)).toUpperCase(), role, can_see_costs });
  const as = <T,>(fn: Parameters<typeof withUser<T>>[2]) => withUser(pool, uid, fn);
  const b = await as((db) => rpc<string>(db, "accept_invite", { token }));
  expect(b).toBe(ctx.b);
  return {
    uid,
    rpc: <T = string>(fn: string, payload: Record<string, unknown>) => as((db) => rpc<T>(db, fn, { business_id: ctx.b, ...payload })),
    read: <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => as((db) => read<T>(db, sql, params)),
  };
}

async function stocked(ctx: Ctx) {
  const A = await ctx.product("Orange juice", { price: N(1_500) });
  await ctx.rpc("post_purchase", { date: "2026-04-01", items: [{ product_id: A, qty: 20, unit_cost: N(700) }] });
  return A;
}

describe("Roles", () => {
  it("Sales can sell but cannot buy stock or see costs", async () => {
    const ctx = await setup();
    const A = await stocked(ctx);
    const s = await join(ctx, "sales");
    const sale = await s.rpc("post_sale", { date: "2026-04-02", items: [{ product_id: A, qty: 2, unit_price: N(1_500) }] });
    expect(sale).toBeTruthy();
    await expect(s.rpc("post_purchase", { date: "2026-04-02", items: [{ product_id: A, qty: 1, unit_cost: N(700) }] })).rejects.toThrow(/permission/i);
    await expect(s.rpc("create_expense", { date: "2026-04-02", category_id: ctx.cat["Rent"], amount: N(1_000) })).rejects.toThrow();
    // Cost tables are invisible to Sales (RLS returns nothing)…
    expect(await s.read("select * from cost_layers where business_id = $1", [ctx.b])).toHaveLength(0);
    expect(await s.read("select * from sale_items where sale_id = $1", [sale])).toHaveLength(0);
    // …but the cost-free view shows the line.
    const pub = await s.read<Record<string, unknown>>("select * from v_sale_items_public where sale_id = $1", [sale]);
    expect(pub).toHaveLength(1);
    expect(Object.keys(pub[0]).some((k) => /cost|cogs/.test(k))).toBe(false);
    await expect(s.read("select fin_pnl($1,'2026-04-01','2026-04-30')", [ctx.b])).rejects.toThrow();
  });

  it("Viewer cannot post anything; Accountant cannot manage the team", async () => {
    const ctx = await setup();
    const A = await stocked(ctx);
    const v = await join(ctx, "viewer");
    await expect(v.rpc("post_sale", { date: "2026-04-02", items: [{ product_id: A, qty: 1, unit_price: N(1_500) }] })).rejects.toThrow(/permission/i);
    const acc = await join(ctx, "accountant", true);
    await expect(acc.rpc("create_invite", { email: "x@y.ng", role: "viewer" })).rejects.toThrow(/permission/i);
    const [m] = await acc.read<{ member_id: string }>("select member_id from team_members($1) where role = 'viewer'", [ctx.b]);
    await expect(acc.rpc("set_member_role", { member_id: m.member_id, role: "admin" })).rejects.toThrow(/permission/i);
    // Direct writes to the members table are blocked for everyone, even owners.
    await expect(ctx.as((db) => db.query("update business_members set role = 'owner' where business_id = $1", [ctx.b]))).rejects.toThrow();
    // Accountant can post a purchase.
    expect(await acc.rpc("post_purchase", { date: "2026-04-03", items: [{ product_id: A, qty: 1, unit_cost: N(700) }] })).toBeTruthy();
  });
});

describe("Invitations and team", () => {
  it("only the invited email can accept, and only once", async () => {
    const ctx = await setup();
    const token = await ctx.rpc<string>("create_invite", { email: "someone@juice.ng", role: "viewer" });
    const stranger = await createUser();
    await expect(withUser(pool, stranger, (db) => rpc(db, "accept_invite", { token }))).rejects.toThrow(/someone@juice\.ng/);
    const s = await join(ctx, "sales");
    await expect(ctx.rpc("create_invite", { email: await emailOf(s.uid), role: "viewer" })).rejects.toThrow(/already on your team/);
    const [inv] = await q<{ id: string }>(ctx, "select id from invitations where token = $1", [token]);
    await ctx.rpc("revoke_invite", { id: inv.id });
    const invited = await pool.query("insert into auth.users (email) values ('someone@juice.ng') on conflict do nothing returning id");
    const uid = invited.rows[0]?.id ?? (await pool.query("select id from auth.users where email='someone@juice.ng'")).rows[0].id;
    await expect(withUser(pool, uid, (db) => rpc(db, "accept_invite", { token }))).rejects.toThrow(/no longer valid/);
  });

  it("a business always keeps an owner; removals are audited", async () => {
    const ctx = await setup();
    const members = () => q<{ member_id: string; role: string; is_me: boolean }>(ctx, "select * from team_members($1)", [ctx.b]);
    const me = (await members()).find((m) => m.is_me)!;
    await expect(ctx.rpc("set_member_role", { member_id: me.member_id, role: "admin" })).rejects.toThrow(/at least one owner/);
    await expect(ctx.rpc("remove_member", { member_id: me.member_id })).rejects.toThrow(/only owner/);
    const adm = await join(ctx, "admin");
    const admRow = (await members()).find((m) => m.role === "admin")!;
    // An admin cannot touch the owner.
    await expect(adm.rpc("remove_member", { member_id: me.member_id })).rejects.toThrow(/owner/i);
    await ctx.rpc("remove_member", { member_id: admRow.member_id, reason: "Left the company" });
    expect((await members()).length).toBe(1);
    const audit = await q<{ action: string; reason: string }>(ctx, "select action, reason from audit_log where business_id=$1 and table_name='business_members' and action='remove'", [ctx.b]);
    expect(audit).toEqual([{ action: "remove", reason: "Left the company" }]);
    // Removed user loses access immediately.
    await expect(adm.rpc("post_sale", { date: "2026-04-02", items: [] })).rejects.toThrow();
  });
});

describe("Stock adjustments", () => {
  it("a write-off is a cost, a found item lowers cost, and stock still reconciles", async () => {
    const ctx = await setup();
    const A = await stocked(ctx); // 20 × ₦700
    await ctx.rpc("post_sale", { date: "2026-04-05", items: [{ product_id: A, qty: 5, unit_price: N(1_500) }] });
    const loss = await ctx.rpc<string>("post_stock_adjustment", { product_id: A, date: "2026-04-06", qty_change: -3, reason: "3 bottles broke" });
    await ctx.rpc("post_stock_adjustment", { product_id: A, date: "2026-04-07", qty_change: 1, unit_cost: N(700), reason: "Found one in the van" });
    await expect(ctx.rpc("post_stock_adjustment", { product_id: A, date: "2026-04-07", qty_change: -50, reason: "Too many" })).rejects.toThrow(/only have 13/);
    await expect(ctx.rpc("post_stock_adjustment", { product_id: A, date: "2026-04-07", qty_change: -1, reason: "x" })).rejects.toThrow(/reason/);

    const p = await ctx.pnl("2026-04-01", "2026-04-30");
    expect(p.cogs).toBe(N(700) * 5 + N(700) * 3 - N(700));
    expect(p.metrics.cogs.steps.map((x) => x.label)).toContain("Stock written off / adjustments");
    const val = async (d: string) => (await q<{ v: number }>(ctx, "select fin_inventory_value_at($1,$2) v", [ctx.b, d]))[0].v;
    expect(N(700) * 20 - (await val("2026-04-30"))).toBe(p.cogs); // opening 0 + purchases − closing = COGS
    const [inv] = await q<{ qty: number }>(ctx, "select on_hand as qty from fin_inventory($1) where product_id=$2", [ctx.b, A]);
    expect(Number(inv.qty)).toBe(13);

    // The daily series agrees with the P&L.
    const days = await q<{ cogs_known: number }>(ctx, "select * from fin_daily_series($1,'2026-04-01','2026-04-30')", [ctx.b]);
    expect(days.reduce((a, d) => a + Number(d.cogs_known), 0)).toBe(p.cogs);

    // Void the write-off: stock and COGS go back.
    await ctx.rpc("void_stock_adjustment", { id: loss, reason: "Counted again, they were fine" });
    const p2 = await ctx.pnl("2026-04-01", "2026-04-30");
    expect(p2.cogs).toBe(N(700) * 4);
    const [inv2] = await q<{ qty: number }>(ctx, "select on_hand as qty from fin_inventory($1) where product_id=$2", [ctx.b, A]);
    expect(Number(inv2.qty)).toBe(16);
    await expect(ctx.as((db) => db.query("delete from stock_adjustments where id=$1", [loss]))).rejects.toThrow();
  });
});

describe("Settings, alerts and audit", () => {
  it("settings go through a function; invoice numbering can't be touched directly", async () => {
    const ctx = await setup();
    await ctx.rpc("update_business_settings", { vat_registered: true, week_start: 1, default_payment_terms_days: 30, reason: "Registered for VAT" });
    const [biz] = await q<{ vat_registered: boolean; default_payment_terms_days: number }>(ctx, "select * from businesses where id=$1", [ctx.b]);
    expect(biz).toMatchObject({ vat_registered: true, default_payment_terms_days: 30 });
    const r = await ctx.as((db) => db.query("update businesses set next_invoice_no = 1 where id=$1", [ctx.b]).catch((e) => e));
    expect(r).toBeInstanceOf(Error);
    const acc = await join(ctx, "accountant", true);
    await expect(acc.rpc("update_business_settings", { name: "Hacked" })).rejects.toThrow(/permission/i);
    const [a] = await q<{ reason: string }>(ctx, "select reason from audit_log where table_name='businesses' and business_id=$1 and action='update' order by id desc limit 1", [ctx.b]);
    expect(a.reason).toBe("Registered for VAT");
  });

  it("cost alerts are hidden from Sales; only managers can sync; dismiss resets when the problem returns", async () => {
    const ctx = await setup();
    const s = await join(ctx, "sales");
    const alerts = [
      { key: "low_cash:all", kind: "low_cash", severity: "warning", message: "Cash is low", data: { costs: false } },
      { key: "margin_drop:2026-04-06", kind: "margin_drop", severity: "warning", message: "Margin fell", data: { costs: true } },
    ];
    await ctx.as((db) => db.query("select sync_alerts($1,$2::jsonb)", [ctx.b, JSON.stringify(alerts)]));
    await expect(s.read("select sync_alerts($1,'[]'::jsonb)", [ctx.b])).rejects.toThrow(/permission/i);
    expect((await s.read<{ kind: string }>("select kind from alerts where business_id=$1", [ctx.b])).map((x) => x.kind)).toEqual(["low_cash"]);
    const open = () => q<{ id: string; kind: string; read_at: string | null; resolved_at: string | null }>(ctx, "select * from alerts where business_id=$1 order by kind", [ctx.b]);
    const cash = (await open()).find((x) => x.kind === "low_cash")!;
    await s.rpc("dismiss_alert", { id: cash.id });
    expect((await open()).find((x) => x.kind === "low_cash")!.read_at).not.toBeNull();
    // Still true → stays dismissed. Clears → resolved. Comes back → shows again.
    const sync = (a: unknown[]) => ctx.as((db) => db.query("select sync_alerts($1,$2::jsonb)", [ctx.b, JSON.stringify(a)]));
    await sync(alerts);
    expect((await open()).find((x) => x.kind === "low_cash")!.read_at).not.toBeNull();
    await sync([alerts[1]]);
    expect((await open()).find((x) => x.kind === "low_cash")!.resolved_at).not.toBeNull();
    await sync(alerts);
    expect((await open()).find((x) => x.kind === "low_cash")).toMatchObject({ read_at: null, resolved_at: null });
    await expect(ctx.as((db) => db.query("update alerts set message='x' where business_id=$1", [ctx.b]))).rejects.toThrow();
  });

  it("the audit viewer shows who did what, to managers only", async () => {
    const ctx = await setup();
    const A = await stocked(ctx);
    const acc = await join(ctx, "accountant");
    const sale = await ctx.rpc<string>("post_sale", { date: "2026-04-02", items: [{ product_id: A, qty: 1, unit_price: N(1_500) }] });
    await ctx.rpc("void_document", { type: "sale", id: sale, reason: "Wrong customer" });
    const rows = await acc.read<{ table_name: string; action: string; reason: string; user_name: string }>("select * from audit_entries($1, $2::jsonb)", [ctx.b, JSON.stringify({ table: "sales" })]);
    expect(rows.find((r) => r.action === "void")).toMatchObject({ reason: "Wrong customer", user_name: expect.any(String) });
    // Accountants always see costs (only the Sales role has costs hidden), so cost rows are included.
    const all = await acc.read<{ table_name: string }>("select * from audit_entries($1)", [ctx.b]);
    expect(all.some((r) => r.table_name === "sale_items")).toBe(true);
    const owner = await q<{ table_name: string }>(ctx, "select * from audit_entries($1)", [ctx.b]);
    expect(owner.some((r) => r.table_name === "sale_items")).toBe(true);
    const s = await join(ctx, "sales");
    await expect(s.read("select * from audit_entries($1)", [ctx.b])).rejects.toThrow();
  });
});
