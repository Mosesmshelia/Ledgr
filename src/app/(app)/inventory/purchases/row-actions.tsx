"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { recordPayment } from "@/app/actions/ledger";
import { Button, Field, Input } from "@/components/ui/primitives";
import { Chips, MoneyInput } from "@/components/ui/inputs";
import { Sheet } from "@/components/ui/sheet";
import { VoidSheet } from "@/app/(app)/sales/[id]/sale-actions";
import { formatMoney } from "@/lib/finance/money";

export function PurchaseRowActions({ id, supplierId, outstanding, total, accounts, today }: { id: string; supplierId: string | null; outstanding: number; total: number; accounts: { id: string; name: string }[]; today: string }) {
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState<null | "pay" | "void">(null);
  const [amount, setAmount] = useState<number | null>(outstanding);
  const [account, setAccount] = useState(accounts[0]?.id);
  const [date, setDate] = useState(today);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="relative">
      <button onClick={() => setMenu(!menu)} className="size-8 grid place-items-center rounded-[8px] text-ink-3 hover:bg-fill hover:text-ink" aria-label="Purchase actions"><MoreHorizontal size={17} /></button>
      {menu && (
        <div className="absolute right-0 top-9 z-20 w-48 bg-raised border border-hairline rounded-[12px] shadow-[var(--shadow-sheet)] p-1" onMouseLeave={() => setMenu(false)}>
          {outstanding > 0 && supplierId && <button className="w-full text-left h-10 px-3 rounded-[8px] hover:bg-fill text-body" onClick={() => { setMenu(false); setSheet("pay"); }}>Pay supplier</button>}
          <button className="w-full text-left h-10 px-3 rounded-[8px] hover:bg-fill text-body text-negative" onClick={() => { setMenu(false); setSheet("void"); }}>Void purchase</button>
        </div>
      )}
      <Sheet open={sheet === "pay"} onClose={() => setSheet(null)} title="Pay supplier" subtitle={`${formatMoney(outstanding, { exact: true })} left to pay`}
        footer={<Button size="lg" className="w-full" disabled={pending} onClick={() => start(async () => {
          if (!amount || !account || !supplierId) return setErr("Enter the amount and choose an account.");
          const r = await recordPayment({ party: "supplier", party_id: supplierId, account_id: account, date, amount, allocations: [{ target_id: id, amount }] });
          if (!r.ok) return setErr(r.error);
          setSheet(null); router.refresh();
        })}>{pending ? "Saving…" : "Save payment"}</Button>}>
        <div className="flex flex-col gap-4">
          <Field label="Amount paid"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
          <Field label="Paid from"><Chips label="Account" value={account ?? null} onChange={setAccount} options={accounts.map((a) => ({ value: a.id, label: a.name }))} /></Field>
          <Field label="Date" htmlFor="sd"><Input id="sd" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
          {err && <p role="alert" className="text-caption text-negative">{err}</p>}
        </div>
      </Sheet>
      <VoidSheet open={sheet === "void"} onClose={() => setSheet(null)} id={id} type="purchase"
        effect={`This removes ${formatMoney(total, { exact: true })} of stock from your records and cancels payments recorded with it. It only works if none of this stock has been sold or used yet.`} />
    </div>
  );
}
