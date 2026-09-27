import "server-only";
import { revalidatePath } from "next/cache";
import { requireCtx, type Ctx } from "@/lib/server/session";
import { humanError, rpc } from "@/lib/server/db";
import { markAlertsStale } from "@/lib/server/alerts";

export type ActionResult<T = string> = { ok: true; data: T } | { ok: false; error: string; code?: string };

/** Run a posting function as the signed-in user, turn DB errors into plain English, refresh pages. */
export async function post<T = string>(fn: string, payload: Record<string, unknown>, revalidate: string[] = ["/"]): Promise<ActionResult<T>> {
  const ctx = await requireCtx();
  try {
    const data = await ctx.db((db) => rpc<T>(db, fn, { business_id: ctx.business.id, ...payload }));
    markAlertsStale(ctx.business.id);
    for (const p of revalidate) revalidatePath(p, p === "/" ? "layout" : "page");
    return { ok: true, data };
  } catch (e) {
    const h = humanError(e);
    return { ok: false, error: h.message, code: h.code };
  }
}

export async function withCtx<T>(fn: (ctx: Ctx) => Promise<T>): Promise<ActionResult<T>> {
  const ctx = await requireCtx();
  try {
    const data = await fn(ctx);
    markAlertsStale(ctx.business.id);
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    const h = humanError(e);
    return { ok: false, error: h.message, code: h.code };
  }
}
