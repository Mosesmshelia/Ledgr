import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireCap } from "@/lib/server/session";
import { formOptions } from "@/lib/server/queries";
import { SaleForm } from "./sale-form";

export const metadata = { title: "New sale" };

export default async function NewSale() {
  const ctx = await requireCap("sell", "/sales");
  const opts = await formOptions(ctx);
  const b = ctx.business;
  return (
    <div className="animate-rise">
      <Link href="/sales" className="tap inline-flex items-center gap-1 text-body text-accent mb-3"><ChevronLeft size={18} />Sales</Link>
      <h1 className="text-title font-semibold mb-5">New sale</h1>
      <SaleForm opts={opts} canSeeCosts={ctx.canSeeCosts} defaultTerms={b.default_payment_terms_days}
        vat={b.vat_registered ? { rateBp: b.vat_rate_bp, inclusive: b.prices_include_vat } : null} />
    </div>
  );
}
