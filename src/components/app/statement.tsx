import Link from "next/link";
import { Card, Money, cn } from "@/components/ui/primitives";
import { formatDate } from "@/lib/finance";

export interface StatementRow { date: string; kind: string; ref: string; description: string | null; doc_id: string | null; debit: number; credit: number; balance: number }

const LABEL: Record<string, string> = { opening: "Opening balance", invoice: "Invoice", payment: "Payment", return: "Return", refund: "Refund", purchase: "Purchase" };

/** Running-balance statement. For customers: debit = they owe more; for suppliers: credit = you owe more. */
export function StatementTable({ rows, party }: { rows: StatementRow[]; party: "customer" | "supplier" }) {
  const closing = rows.at(-1)?.balance ?? 0;
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
        <table className="w-full text-body min-w-[600px]">
          <thead>
            <tr className="text-caption text-ink-2 text-left">
              <th className="font-medium py-2.5 pl-5">Date</th><th className="font-medium">Details</th>
              <th className="font-medium text-right">{party === "customer" ? "Charged" : "Paid"}</th>
              <th className="font-medium text-right">{party === "customer" ? "Paid / credited" : "Billed"}</th>
              <th className="font-medium text-right pr-5">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const href = r.doc_id && r.kind === "invoice" ? `/sales/${r.doc_id}` : null;
              return (
                <tr key={i} className={cn("border-t border-hairline", r.kind === "opening" && "bg-surface-2")}>
                  <td className="py-2.5 pl-5 num whitespace-nowrap">{formatDate(r.date, true)}</td>
                  <td className="py-2.5">
                    <span className={r.kind === "opening" ? "text-ink-2" : ""}>{LABEL[r.kind] ?? r.kind}</span>
                    {r.ref && <> · {href ? <Link href={href} className="text-accent">{r.ref}</Link> : <span className="text-ink-2">{r.ref}</span>}</>}
                    {r.description && r.kind !== "opening" && <div className="text-caption text-ink-3 truncate max-w-[340px]">{r.description}</div>}
                  </td>
                  <td className="text-right num">{r.debit ? <Money value={r.debit} exact /> : ""}</td>
                  <td className="text-right num">{r.credit ? <Money value={r.credit} exact /> : ""}</td>
                  <td className={cn("text-right num pr-5", r.balance < 0 && "text-positive")}><Money value={r.balance} exact /></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-hairline-strong font-semibold">
              <td className="py-3 pl-5" colSpan={4}>{party === "customer" ? (closing >= 0 ? "Amount due" : "In credit") : closing >= 0 ? "You owe" : "Supplier owes you"}</td>
              <td className="text-right num pr-5"><Money value={Math.abs(closing)} exact /></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

export function StatementRange({ base, from, to, today }: { base: string; from: string; to: string; today: string }) {
  const presets = [
    { l: "3 months", f: addDaysIso(today, -89) }, { l: "This year", f: today.slice(0, 4) + "-01-01" }, { l: "All time", f: "2000-01-01" },
  ];
  return (
    <div className="flex flex-wrap gap-1.5 print:hidden">
      {presets.map((p) => (
        <Link key={p.l} href={`${base}?from=${p.f}&to=${today}`} className={cn("h-8 px-3 rounded-full text-caption font-medium grid place-items-center border",
          from === p.f && to === today ? "bg-ink text-bg border-ink" : "border-hairline-strong text-ink-2 hover:text-ink")}>{p.l}</Link>
      ))}
    </div>
  );
}

function addDaysIso(d: string, n: number) {
  const t = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
