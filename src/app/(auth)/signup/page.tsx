import { signUp } from "@/app/actions/auth";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Create account" };
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; email?: string }> }) {
  const sp = await searchParams;
  const next = sp.next && /^\/invite\/[a-f0-9]+$/.test(sp.next) ? sp.next : undefined;
  return <AuthForm mode="signup" action={signUp} next={next} email={sp.email}
    {...(next ? { subtitle: "Create an account to join the team you were invited to." } : {})} />;
}
