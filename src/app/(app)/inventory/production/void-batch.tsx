"use client";
import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { VoidSheet } from "@/app/(app)/sales/[id]/sale-actions";
import { formatMoney } from "@/lib/finance/money";

export function VoidBatchButton({ id, cost }: { id: string; cost: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="size-8 grid place-items-center rounded-[8px] text-ink-3 hover:bg-fill hover:text-ink" aria-label="Void batch"><MoreHorizontal size={16} /></button>
      <VoidSheet open={open} onClose={() => setOpen(false)} id={id} type="production"
        effect={`This removes the batch (${formatMoney(cost, { exact: true })}) from stock, returns the ingredients it used, and cancels any payments recorded with it.`} />
    </>
  );
}
