import "server-only";
import { Pool } from "pg";
import { createPool, withUser, rpc, read, humanError, type Db } from "@/lib/db/core";

const g = globalThis as unknown as { __ledgrPool?: Pool };
/** One pool. Sign-in/sign-up use narrow database functions (migration 0010), so no privileged connection is needed. */
export const pool = (g.__ledgrPool ??= createPool(process.env.DATABASE_URL));

export { withUser, rpc, read, humanError, type Db };
