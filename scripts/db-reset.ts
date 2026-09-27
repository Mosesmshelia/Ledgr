// Recreates a local database and applies the Supabase shim + all migrations in order.
// Usage: tsx scripts/db-reset.ts [dbname]   (default: ledgr)
import { Client } from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export async function resetDatabase(dbName: string) {
  const host = process.env.PGHOST ?? "localhost";
  const port = Number(process.env.PGPORT ?? 54322);
  const admin = new Client({ host, port, user: "postgres", database: "postgres" });
  await admin.connect();
  await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [dbName]);
  await admin.query(`drop database if exists "${dbName}"`);
  await admin.query(`create database "${dbName}"`);
  await admin.end();

  const db = new Client({ host, port, user: "postgres", database: dbName });
  await db.connect();
  const root = join(__dirname, "..", "supabase");
  const files = [
    join(root, "local", "000_supabase_shim.sql"),
    ...readdirSync(join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort().map((f) => join(root, "migrations", f)),
  ];
  for (const f of files) {
    try {
      await db.query(readFileSync(f, "utf8"));
    } catch (e) {
      const err = e as { message: string; position?: string };
      throw new Error(`${f}: ${err.message} (position ${err.position ?? "?"})`);
    }
  }
  await db.end();
  return files.length;
}

if (require.main === module) {
  const name = process.argv[2] ?? "ledgr";
  resetDatabase(name).then((n) => console.log(`✓ ${name}: applied ${n} files`)).catch((e) => { console.error(e.message); process.exit(1); });
}
