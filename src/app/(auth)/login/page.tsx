import { signIn } from "@/app/actions/auth";
import { AuthForm } from "../auth-form";
import { isDemo, signUpIsPublic, INVITE_ONLY_MESSAGE } from "@/lib/server/access";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in" };
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; email?: string; denied?: string }> }) {
  const sp = await searchParams;
  const [demo, publicSignUp] = [isDemo(), await signUpIsPublic()];
  const next = sp.next && /^\/invite\/[a-f0-9]+$/.test(sp.next) ? sp.next : undefined;
  return <AuthForm mode="login" action={signIn} next={next} email={sp.email} demo={demo} allowSignUp={publicSignUp || !!next}
    notice={sp.denied ? INVITE_ONLY_MESSAGE : undefined}
    {...(next ? { subtitle: "Sign in to join the team you were invited to." } : {})} />;
}
