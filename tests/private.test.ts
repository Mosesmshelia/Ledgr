// Private use: invite-only access and sign-in lock-out (migration 0012).
import { describe, it, expect, afterAll } from "vitest";
import { pool, setup } from "./helpers";

afterAll(() => pool.end());
const one = async <T,>(sql: string, p: unknown[] = []) => Object.values((await pool.query(sql, p)).rows[0])[0] as T;

describe("Private use", () => {
  it("locks an email after 8 wrong passwords, and a right password clears the count", async () => {
    const email = `lock-${Date.now()}@test.ng`;
    const id = await one<string>("select public.app_sign_up($1, 'right-password-1', 'Lock Test')", [email]);
    expect(await one<string>("select public.app_sign_in($1, 'right-password-1')", [email])).toBe(id);
    for (let i = 0; i < 8; i++) expect(await one<string | null>("select public.app_sign_in($1, 'wrong-pass')", [email])).toBeNull();
    await expect(pool.query("select public.app_sign_in($1, 'right-password-1')", [email])).rejects.toThrow(/wait 15 minutes/);
    // Other emails are unaffected.
    expect(await one<string | null>("select public.app_sign_in('nobody@test.ng', 'x-password')")).toBeNull();
    await pool.query("delete from public.login_failures where email = $1", [email]);
    expect(await one<string>("select public.app_sign_in(upper($1), 'right-password-1')", [email])).toBe(id);
  });

  it("invite-only: a stranger has no access; an invited person does until they join; members always do", async () => {
    const ctx = await setup();
    const strangerEmail = `stranger-${Date.now()}@test.ng`;
    const stranger = await one<string>("select public.app_sign_up($1, 'password-123', 'Stranger')", [strangerEmail]);
    expect(await one<boolean>("select public.app_user_has_access($1)", [stranger])).toBe(false);
    expect(await one<boolean>("select public.app_has_invite($1)", [strangerEmail])).toBe(false);
    await ctx.rpc("create_invite", { email: strangerEmail.toUpperCase(), role: "sales" });
    expect(await one<boolean>("select public.app_has_invite($1)", [strangerEmail])).toBe(true);
    expect(await one<boolean>("select public.app_user_has_access($1)", [stranger])).toBe(true);
    expect(await one<boolean>("select public.app_user_has_access($1)", [ctx.uid])).toBe(true);
    expect(await one<boolean>("select public.app_is_fresh()")).toBe(false);
    // The API roles can't call any of these.
    for (const role of ["anon", "authenticated"]) {
      const c = await pool.connect();
      try {
        await c.query("begin"); await c.query(`set local role ${role}`);
        await expect(c.query("select public.app_user_has_access($1)", [stranger])).rejects.toThrow(/permission denied/);
      } finally { await c.query("rollback"); c.release(); }
    }
  });
});
