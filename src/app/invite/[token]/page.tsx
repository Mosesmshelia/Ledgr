import Link from "next/link";
import { pool } from "@/lib/server/db";
import { getUserId } from "@/lib/server/session";
import { ROLE_INFO, type Role } from "@/lib/permissions";
import { AcceptButton } from "./accept-button";

export const metadata = { title: "Join a team" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // The token itself is the secret; we only reveal the business name, role and invited email.
  const { rows: [inv] } = /^[a-f0-9]{16,64}$/.test(token) ? await pool.query("select * from public.app_invite_info($1)", [token]) : { rows: [] };
  const userId = await getUserId();
  const me = userId ? (await pool.query("select public.app_user_email($1) as email", [userId])).rows[0]?.email as string | undefined : undefined;
  const next = `/invite/${token}`;
  const problem = !inv ? "This invitation link isn't valid. Check you copied all of it."
    : inv.revoked_at ? "This invitation was cancelled. Ask for a new one."
    : inv.accepted_at ? "This invitation has already been used."
    : new Date(inv.expires_at) < new Date() ? "This invitation has expired. Ask for a new one." : null;

  return (
    <div className="min-h-dvh grid place-items-center px-4 py-10">
      <div className="w-full max-w-[400px] animate-rise text-center">
        <span className="mx-auto size-12 rounded-[14px] bg-accent text-on-accent grid place-items-center font-semibold text-xl mb-5">L</span>
        {problem ? (
          <>
            <h1 className="text-title font-semibold">Can&apos;t use this link</h1>
            <p className="text-body text-ink-2 mt-2">{problem}</p>
            <Link href={userId ? "/dashboard" : "/login"} className="inline-block mt-6 text-accent font-medium">{userId ? "Go to Ledgr" : "Sign in"}</Link>
          </>
        ) : (
          <>
            <h1 className="text-title font-semibold">Join {inv.business}</h1>
            <p className="text-body text-ink-2 mt-2">You&apos;ve been invited as <span className="text-ink font-medium">{ROLE_INFO[inv.role as Role].label}</span>. {ROLE_INFO[inv.role as Role].summary}</p>
            <div className="bg-surface rounded-[16px] border border-hairline p-5 mt-6 text-left">
              <div className="text-caption text-ink-2">Invitation for</div>
              <div className="text-body font-medium">{inv.email}</div>
              {!userId ? (
                <div className="flex flex-col gap-2 mt-5">
                  <Link href={`/signup?next=${encodeURIComponent(next)}&email=${encodeURIComponent(inv.email)}`} className="h-12 rounded-[12px] bg-accent text-on-accent grid place-items-center font-medium">Create an account</Link>
                  <Link href={`/login?next=${encodeURIComponent(next)}&email=${encodeURIComponent(inv.email)}`} className="h-12 rounded-[12px] bg-fill grid place-items-center font-medium">I already have an account</Link>
                </div>
              ) : me !== inv.email ? (
                <p className="text-caption text-negative mt-4">You&apos;re signed in as {me}. Sign out and sign in with {inv.email} to accept.</p>
              ) : (
                <div className="mt-5"><AcceptButton token={token} /></div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
