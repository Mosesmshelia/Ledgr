"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { saveBudgets } from "@/app/actions/ledger";
import { Button, Card, cn } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/inputs";
import { formatMoney } from "@/lib/finance/money";

interface Line { line: "revenue" | "cogs" | "category"; category_id: string | null; label: string; hint: string; last: number; value: number | null; previous: number | null }
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function BudgetEditor({ month, lines }: { month: string; lines: Line[] }) {
  const [values, setValues] = useState<(number | null)[]>(lines.map((l) => l.value));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const hasPrev = lines.some((l) => l.previous !== null);
  const opex = values.slice(2).reduce<number>((a, v) => a + (v ?? 0), 0);
  const label = `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-title font-semibold">Budgets for {label}</h1>
          <p className="text-body text-ink-2">Leave a line empty to have no budget for it. Last month&apos;s actual is shown as a guide.</p>
        </div>
        {hasPrev && <Button variant="secondary" onClick={() => setValues(lines.map((l) => l.previous))}><Copy size={15} />Copy last month</Button>}
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-body">
          <thead><tr className="text-caption text-ink-2 text-left"><th className="font-medium py-2.5 pl-5">Line</th><th className="font-medium text-right hidden sm:table-cell">Last month actual</th><th className="font-medium text-right pr-5 w-48">Budget</th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.line + (l.category_id ?? "")} className={cn("border-t border-hairline", i === 2 && "border-t-hairline-strong")}>
                <td className="py-2 pl-5">{i === 2 && <div className="text-overline uppercase font-semibold text-ink-2 pt-2 pb-1">Operating expenses</div>}{l.label}{l.hint && <div className="text-caption text-ink-3">{l.hint}</div>}</td>
                <td className="text-right num text-ink-2 hidden sm:table-cell">{formatMoney(l.last)}</td>
                <td className="py-2 pr-5"><MoneyInput value={values[i]} onChange={(v) => setValues(values.map((x, j) => (j === i ? v : x)))} placeholder="No budget" aria-label={`${l.label} budget`} /></td>
              </tr>
            ))}
            <tr className="border-t border-hairline-strong font-semibold"><td className="py-3 pl-5">Total operating expenses</td><td className="hidden sm:table-cell" /><td className="text-right pr-5 num">{formatMoney(opex)}</td></tr>
          </tbody>
        </table>
      </Card>
      <div className="flex items-center justify-end gap-3 mt-4">
        {msg && <span className={cn("text-caption", msg.ok ? "text-positive" : "text-negative")}>{msg.text}</span>}
        <Button size="lg" disabled={pending} onClick={() => start(async () => {
          const r = await saveBudgets({ month, lines: lines.map((l, i) => ({ line: l.line, category_id: l.category_id, amount: values[i] })) });
          if (!r.ok) return setMsg({ ok: false, text: r.error });
          setMsg({ ok: true, text: `Saved ${r.data} budget line${r.data === 1 ? "" : "s"}.` });
          router.push(`/reports/budget?month=${month}`);
        })}>{pending ? "Saving…" : "Save budgets"}</Button>
      </div>
    </>
  );
}
