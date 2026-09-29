import "server-only";
import { pool } from "./db";

/**
 * Who may join. "invite" (the live site): once the first account exists, only people with an invitation
 * can sign up or get in. "open" (default, local development and tests): anyone can create an account.
 */
export const accessMode = (): "invite" | "open" => (process.env.LEDGR_ACCESS === "invite" ? "invite" : "open");
/** Show the demo logins on the sign-in page (demo sites only). */
export const isDemo = () => process.env.LEDGR_DEMO === "true";

export const INVITE_ONLY_MESSAGE = "Ledgr is invite-only. Ask the business owner to send you an invitation link.";

async function one<T>(sql: string, params: unknown[]): Promise<T> {
  const { rows } = await pool.query(sql, params);
  return Object.values(rows[0])[0] as T;
}

/** May this email create an account right now? */
export async function canSignUp(email: string): Promise<boolean> {
  if (accessMode() === "open") return true;
  return (await one<boolean>("select public.app_is_fresh()", [])) || (await one<boolean>("select public.app_has_invite($1)", [email]));
}

/** May this signed-in user use the app (member, invited, or first-time owner finishing setup)? */
export async function hasAccess(userId: string): Promise<boolean> {
  if (accessMode() === "open") return true;
  return one<boolean>("select public.app_user_has_access($1)", [userId]);
}

/** Is sign-up open to the public on this site right now (for showing the "Create an account" link)? */
export async function signUpIsPublic(): Promise<boolean> {
  return accessMode() === "open" || one<boolean>("select public.app_is_fresh()", []);
}
