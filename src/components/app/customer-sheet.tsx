"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveCustomer } from "@/app/actions/ledger";
import { Button, Field, Input } from "@/components/ui/primitives";
import { Sheet } from "@/components/ui/sheet";

export function NewCustomerSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (c: { id: string; name: string }) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [terms, setTerms] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Sheet open={open} onClose={onClose} title="New customer"
      footer={<Button className="w-full" size="lg" disabled={pending} onClick={() => start(async () => {
        const r = await saveCustomer({ name, phone, payment_terms_days: terms ? Number(terms) : null });
        if (!r.ok) return setErr(r.error);
        onCreated?.(r.data); setName(""); setPhone(""); setTerms(""); setErr(null); onClose(); router.refresh();
      })}>{pending ? "Saving…" : "Add customer"}</Button>}>
      <div className="flex flex-col gap-4">
        <Field label="Name" htmlFor="cn"><Input id="cn" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Greenleaf Supermarket" /></Field>
        <Field label="Phone (optional)" htmlFor="cp"><Input id="cp" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803 000 0000" /></Field>
        <Field label="Days to pay (optional)" htmlFor="ct" hint="Used for due dates on credit sales."><Input id="ct" inputMode="numeric" value={terms} onChange={(e) => setTerms(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 14" /></Field>
        {err && <p role="alert" className="text-caption text-negative">{err}</p>}
      </div>
    </Sheet>
  );
}
