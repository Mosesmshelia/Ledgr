import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireCap } from "@/lib/server/session";
import { formOptions } from "@/lib/server/queries";
import { PurchaseForm } from "./purchase-form";

export const metadata = { title: "Add purchase" };

export default async function NewPurchase() {
  const ctx = await requireCap("record", "/inventory/purchases");
  const opts = await formOptions(ctx);
  return (
    <div className="animate-rise">
      <Link href="/inventory/purchases" className="tap inline-flex items-center gap-1 text-body text-accent mb-3"><ChevronLeft size={18} />Purchases</Link>
      <h1 className="text-title font-semibold">Add purchase</h1>
      <p className="text-body text-ink-2 mt-0.5 mb-5">Stock you bought. Transport, customs and packaging are added to what each item cost.</p>
      <PurchaseForm opts={opts} terms={ctx.business.default_payment_terms_days} />
    </div>
  );
}
