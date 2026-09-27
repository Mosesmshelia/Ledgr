import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireCap } from "@/lib/server/session";
import { formOptions } from "@/lib/server/queries";
import { ProductionForm } from "./production-form";

export const metadata = { title: "New production batch" };

export default async function NewBatch() {
  const ctx = await requireCap("record", "/inventory/production");
  const opts = await formOptions(ctx);
  return (
    <div className="animate-rise">
      <Link href="/inventory/production" className="tap inline-flex items-center gap-1 text-body text-accent mb-3"><ChevronLeft size={18} />Production</Link>
      <h1 className="text-title font-semibold">New production batch</h1>
      <p className="text-body text-ink-2 mt-0.5 mb-5">Ingredients come out of stock at their real cost. Labour and other direct costs are added on top.</p>
      <ProductionForm opts={opts} />
    </div>
  );
}
