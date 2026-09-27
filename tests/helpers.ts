import { createPool, withUser, rpc, read, type Db } from "@/lib/db/core";
import { calculatePnl, type PnlInputs } from "@/lib/finance";

export const pool = createPool("postgres://postgres@localhost:54322/ledgr_test");

/** ₦ → kobo, so tests read like the spec. */
export const N = (naira: number) => Math.round(naira * 100);

let counter = 0;
export async function createUser(): Promise<string> {
  const { rows } = await pool.query(
    "insert into auth.users (email) values ($1) returning id",
    [`user${Date.now()}_${counter++}@test.local`],
  );
  return rows[0].id;
}

export interface Ctx {
  uid: string;
  b: string;
  cash: string;
  bank: string;
  walkIn: string;
  cat: Record<string, string>;
  as: <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
  product: (name: string, opts?: { price?: number; standard_cost?: number | null; unit?: string; is_sellable?: boolean }) => Promise<string>;
  customer: (name: string, terms?: number) => Promise<string>;
  supplier: (name: string) => Promise<string>;
  pnl: (from: string, to: string) => Promise<ReturnType<typeof calculatePnl>>;
  rpc: <T = string>(fn: string, payload: Record<string, unknown>) => Promise<T>;
}

export async function setup(opts: Record<string, unknown> = {}): Promise<Ctx> {
  const uid = await createUser();
  const as = <T,>(fn: (db: Db) => Promise<T>) => withUser(pool, uid, fn);
  const b = await as((db) =>
    rpc<string>(db, "create_business", {
      name: "Test Juice Co", owner_name: "Moses Test",
      accounts: [{ name: "Cash", type: "cash", opening_date: "2026-01-01" }, { name: "Bank", type: "bank", opening_date: "2026-01-01" }],
      ...opts,
    }),
  );
  const accounts = await as((db) => read<{ id: string; name: string }>(db, "select id, name from cash_accounts where business_id = $1", [b]));
  const walkIn = (await as((db) => read<{ id: string }>(db, "select id from customers where business_id = $1 and is_walk_in", [b])))[0].id;
  const cats = await as((db) => read<{ id: string; name: string }>(db, "select id, name from expense_categories where business_id = $1", [b]));
  const cat = Object.fromEntries(cats.map((c) => [c.name, c.id]));
  const ctx: Ctx = {
    uid, b, walkIn, cat, as,
    cash: accounts.find((a) => a.name === "Cash")!.id,
    bank: accounts.find((a) => a.name === "Bank")!.id,
    product: async (name, o = {}) =>
      (await as((db) => read<{ id: string }>(db,
        "insert into products (business_id, name, selling_price, standard_cost, unit, is_sellable) values ($1,$2,$3,$4,$5,$6) returning id",
        [b, name, o.price ?? null, o.standard_cost ?? null, o.unit ?? "unit", o.is_sellable ?? true])))[0].id,
    customer: async (name, terms) =>
      (await as((db) => read<{ id: string }>(db, "insert into customers (business_id, name, payment_terms_days) values ($1,$2,$3) returning id", [b, name, terms ?? null])))[0].id,
    supplier: async (name) =>
      (await as((db) => read<{ id: string }>(db, "insert into suppliers (business_id, name) values ($1,$2) returning id", [b, name])))[0].id,
    pnl: async (from, to) => {
      const [row] = await as((db) => read<{ r: PnlInputs }>(db, "select public.fin_pnl($1,$2,$3) as r", [b, from, to]));
      return calculatePnl(row.r);
    },
    rpc: (fn, payload) => as((db) => rpc(db, fn, { business_id: b, ...payload })),
  };
  return ctx;
}

export async function q<T = Record<string, unknown>>(ctx: Ctx, sql: string, params: unknown[] = []) {
  return ctx.as((db) => read<T>(db, sql, params));
}
