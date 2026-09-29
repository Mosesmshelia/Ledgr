import { signIn, signUp } from "@/app/actions/auth";
import { AuthForm } from "../auth-form";
import { signUpIsPublic, INVITE_ONLY_MESSAGE } from "@/lib/server/access";

export const dynamic = "force-dynamic";

export const metadata = { title: "Create account" };
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; email?: string }> }) {
  const sp = await searchParams;
  const next = sp.next && /^\/invite\/[a-f0-9]+$/.test(sp.next) ? sp.next : undefined;
  const fresh = await signUpIsPublic();
  if (!next && !fresh) return <AuthForm mode="login" action={signIn} notice={INVITE_ONLY_MESSAGE} allowSignUp={false} />;
  return <AuthForm mode="signup" action={signUp} next={next} email={sp.email} allowSignUp
    {...(!next ? { title: "Set up Ledgr", subtitle: "You're the first person here, so this account will own the business." } : {})}
    {...(next ? { subtitle: "Create an account to join the team you were invited to." } : {})} />;
}
