import { after } from "next/server";
import { headers } from "next/headers";
import { AppShell } from "@/components/app/shell";
import { requireCtx } from "@/lib/server/session";
import { refreshAlerts, listAlerts } from "@/lib/server/alerts";
import { signOut } from "@/app/actions/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  // On the dashboard (where alerts are shown in full) re-check them before rendering; everywhere else
  // re-check after the page has been sent, so nobody waits for it. Checks are throttled either way.
  const path = (await headers()).get("x-ledgr-path") ?? "";
  if (path.startsWith("/dashboard")) await refreshAlerts(ctx);
  else after(() => refreshAlerts(ctx));
  const alerts = await listAlerts(ctx);
  return (
    <AppShell businessName={ctx.business.name} userName={ctx.displayName} role={ctx.role} alerts={alerts} signOut={signOut}>
      {children}
    </AppShell>
  );
}
