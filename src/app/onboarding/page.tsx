import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/server/session";
import { todayIn } from "@/lib/finance";
import { Wizard } from "./wizard";

export const metadata = { title: "Set up your business" };

export default async function Onboarding() {
  const ctx = await requireCtx({ allowNoBusiness: true });
  if (ctx.business) redirect("/dashboard");
  const [profile] = await ctx.q<{ full_name: string | null }>("select full_name from profiles where user_id = auth.uid()");
  return <Wizard today={todayIn("Africa/Lagos")} ownerName={profile?.full_name ?? ""} />;
}
