// Database access. Every request runs inside a transaction as the Postgres role `authenticated`
// with the user's id in `request.jwt.claims` — exactly how Supabase's API applies Row Level Security.
// Pointing DATABASE_URL at a Supabase Postgres connection works the same way in production.
import { Pool, types, type PoolClient } from "pg";

// bigint (kobo) and numeric (quantities) come back as JS numbers. Safe: kobo stays far below 2^53.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));
types.setTypeParser(1082, (v) => v); // date → 'YYYY-MM-DD' string, never a JS Date (no timezone shifts)

export type Db = PoolClient;

export function createPool(connectionString?: string) {
  const url = connectionString ?? process.env.DATABASE_URL ?? "postgres://postgres@localhost:54322/ledgr";
  const hosted = !/localhost|127\.0\.0\.1/.test(url);
  return new Pool({
    connectionString: url.replace(/[?&]sslmode=[^&]*/, ""),
    // Hosted databases (Supabase) require an encrypted connection. Serverless functions keep few connections.
    ssl: hosted ? { rejectUnauthorized: false } : undefined,
    max: hosted ? 3 : 10,
    idleTimeoutMillis: hosted ? 10_000 : 30_000,
  });
}

export async function withUser<T>(pool: Pool, userId: string | null, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(userId ? { sub: userId, role: "authenticated" } : { role: "anon" }),
    ]);
    await client.query(userId ? "set local role authenticated" : "set local role anon");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Call a posting function that takes one jsonb argument. */
export async function rpc<T = unknown>(db: Db, fn: string, payload: Record<string, unknown>): Promise<T> {
  if (!/^[a-z_]+$/.test(fn)) throw new Error("bad function name");
  const { rows } = await db.query(`select public.${fn}($1::jsonb) as r`, [JSON.stringify(payload)]);
  return rows[0]?.r as T;
}

/** Call a read function that returns a table or json. */
export async function read<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await db.query(sql, params);
  return rows as T[];
}

/** Turn a Postgres error into the plain-English message we wrote in the SQL. */
export function humanError(e: unknown): { message: string; code?: string } {
  const err = e as { message?: string; hint?: string; code?: string };
  if (err?.hint === "INSUFFICIENT_STOCK") return { message: err.message ?? "Not enough stock.", code: "INSUFFICIENT_STOCK" };
  if (err?.code === "23514") return { message: "Some values aren't valid. Please check the amounts and try again." };
  if (err?.code === "42501") return { message: "You don't have permission to do this." };
  if (err?.code === "23505") return { message: "That name is already used. Pick a different one." };
  return { message: err?.message ?? "Something went wrong. Please try again." };
}
