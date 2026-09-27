"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { pool, humanError } from "@/lib/server/db";
import { createSession, destroySession } from "@/lib/server/session";

export type AuthState = { error?: string; email?: string } | undefined;

/** Only allow redirects back to an invitation page — never an arbitrary URL. */
function safeNext(v: FormDataEntryValue | null): string | null {
  const s = typeof v === "string" ? v : "";
  return /^\/invite\/[a-f0-9]{16,64}$/.test(s) ? s : null;
}

const creds = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export async function signIn(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = creds.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message, email: String(form.get("email") ?? "") };
  const { rows } = await pool.query<{ id: string | null }>("select public.app_sign_in($1, $2) as id", [parsed.data.email, parsed.data.password]);
  if (!rows[0]?.id) return { error: "That email and password don't match.", email: parsed.data.email };
  await createSession(rows[0].id);
  redirect(safeNext(form.get("next")) ?? "/dashboard");
}

export async function signUp(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = creds.extend({ name: z.string().trim().min(2, "Enter your name.") })
    .safeParse({ email: form.get("email"), password: form.get("password"), name: form.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0].message, email: String(form.get("email") ?? "") };
  let rows: { id: string }[];
  try {
    ({ rows } = await pool.query<{ id: string }>("select public.app_sign_up($1, $2, $3) as id", [parsed.data.email, parsed.data.password, parsed.data.name]));
  } catch (e) {
    return { error: humanError(e).message, email: parsed.data.email };
  }
  await createSession(rows[0].id);
  redirect(safeNext(form.get("next")) ?? "/onboarding");
}

export async function signOut() {
  await destroySession();
  redirect("/login");
}
