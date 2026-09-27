import "server-only";
import { cookies, headers } from "next/headers";
import { routeFallback } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { cache } from "react";
import { pool, withUser, read, type Db } from "./db";

// Local-dev session: a signed, httpOnly cookie holding the user id.
// In production this is swapped for Supabase Auth's session (see DECISIONS D-18) — nothing else changes.
const COOKIE = "ledgr_session";
const BIZ_COOKIE = "ledgr_business";
const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET ?? "dev-only-secret-change-me-0123456789abcdef");

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("30d").sign(secret());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
}

export async function destroySession() {
  const c = await cookies();
  c.delete(COOKIE);
  c.delete(BIZ_COOKIE);
}

export const getUserId = cache(async (): Promise<string | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
});

export interface Business {
  id: string; name: string; currency: string; timezone: string; week_start: number;
  vat_registered: boolean; vat_rate_bp: number; prices_include_vat: boolean; default_payment_terms_days: number;
  onboarding_completed_at: string | null;
}
export interface Ctx {
  userId: string;
  displayName: string;
  business: Business;
  role: "owner" | "admin" | "accountant" | "sales" | "viewer";
  canSeeCosts: boolean;
  /** Run queries as this user (RLS applies). */
  db: <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
  q: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
}

/** The signed-in user and their current business. Redirects to sign-in / onboarding when needed. */
export const requireCtx = cache(async (opts: { allowNoBusiness?: boolean } = {}): Promise<Ctx> => {
  const userId = await getUserId();
  if (!userId) redirect("/login");
  const db = <T,>(fn: (db: Db) => Promise<T>) => withUser(pool, userId, fn);
  const q = <T = Record<string, unknown>,>(sql: string, params: unknown[] = []) => db((c) => read<T>(c, sql, params));
  const preferred = (await cookies()).get(BIZ_COOKIE)?.value ?? null;
  const rows = await q<Business & { role: Ctx["role"]; can_see_costs: boolean; display_name: string | null }>(
    `select b.*, m.role, m.can_see_costs, p.display_name
     from business_members m join businesses b on b.id = m.business_id
     left join profiles p on p.user_id = m.user_id
     where m.user_id = auth.uid() order by (b.id::text = $1) desc, m.created_at limit 1`, [preferred ?? ""]);
  if (!rows.length) {
    if (opts.allowNoBusiness) return { userId, displayName: "", business: null as unknown as Business, role: "owner", canSeeCosts: true, db, q };
    redirect("/onboarding");
  }
  const r = rows[0];
  // Central route guard: runs before any page query, because every page and layout calls requireCtx.
  const path = (await headers()).get("x-ledgr-path");
  if (path) { const to = routeFallback(r.role, path); if (to) redirect(to); }
  return {
    userId,
    displayName: r.display_name ?? "",
    business: r,
    role: r.role,
    canSeeCosts: ["owner", "admin", "accountant", "viewer"].includes(r.role) || r.can_see_costs,
    db, q,
  };
});

/** Like requireCtx, but sends people without this capability back to their home screen. */
export async function requireCap(cap: import("@/lib/permissions").Capability, fallback = "/dashboard"): Promise<Ctx> {
  const { can } = await import("@/lib/permissions");
  const ctx = await requireCtx(); // route rules already applied here; this adds page-specific checks
  if (!can(ctx.role, cap)) redirect(fallback);
  return ctx;
}
