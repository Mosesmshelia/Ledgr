"use client";
import { useActionState } from "react";
import Link from "next/link";
import { Button, Field, Input } from "@/components/ui/primitives";
import type { AuthState } from "@/app/actions/auth";

export function AuthForm({ mode, action, next, email, title, subtitle, demo = false, allowSignUp = true, notice }: {
  mode: "login" | "signup"; action: (s: AuthState, f: FormData) => Promise<AuthState>;
  next?: string; email?: string; title?: string; subtitle?: string;
  /** Show the demo logins (demo sites only). */ demo?: boolean;
  /** Show the "Create an account" link (hidden when the site is invite-only). */ allowSignUp?: boolean;
  /** A message shown above the form, e.g. "invite-only". */ notice?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <div className="min-h-dvh grid place-items-center px-4 py-10">
      <div className="w-full max-w-[380px] animate-rise">
        <div className="flex flex-col items-center text-center mb-8">
          <span className="size-12 rounded-[14px] bg-accent text-on-accent grid place-items-center font-semibold text-xl mb-5">L</span>
          <h1 className="text-title font-semibold">{title ?? (mode === "login" ? "Welcome back" : "Create your account")}</h1>
          <p className="text-body text-ink-2 mt-1">{subtitle ?? (mode === "login" ? "Sign in to see how your business is doing." : "Know your numbers in minutes.")}</p>
        </div>
        {notice && <p role="status" className="mb-4 rounded-[12px] bg-accent-soft text-ink px-4 py-3 text-body">{notice}</p>}
        <form action={formAction} className="bg-surface rounded-[16px] border border-hairline p-5 flex flex-col gap-4">
          {next && <input type="hidden" name="next" value={next} />}
          {mode === "signup" && (
            <Field label="Your name" htmlFor="name"><Input id="name" name="name" autoComplete="name" required placeholder="Moses Mshelia" /></Field>
          )}
          <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state?.email ?? email} placeholder="you@business.ng" /></Field>
          <Field label="Password" htmlFor="password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
            <Input id="password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} />
          </Field>
          {state?.error && <p role="alert" className="text-caption text-negative -mt-1">{state.error}</p>}
          <Button type="submit" size="lg" disabled={pending} className="mt-1">{pending ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</Button>
        </form>
        <p className="text-center text-body text-ink-2 mt-5">
          {mode === "login" ? (allowSignUp ? <>New to Ledgr? <Link href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"} className="text-accent font-medium">Create an account</Link></> : null) : <>Already have an account? <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="text-accent font-medium">Sign in</Link></>}
        </p>
        {mode === "login" && !next && demo && (
          <p className="text-center text-caption text-ink-3 mt-6">Demo: demo@ledgr.ng · ledgr-demo<br />Also accountant@, sales@ and viewer@ledgr.ng, same password</p>
        )}
      </div>
    </div>
  );
}
