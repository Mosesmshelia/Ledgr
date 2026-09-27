import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { Completeness } from "@/lib/finance/pnl";
import { formatRange } from "@/lib/finance/periods";
import { cn } from "@/components/ui/primitives";

/** Every report states its business, period, currency, when it was generated and how complete its data is (brief §81). */
export function ReportMeta({ business, from, to, status, note, currency = "NGN" }: { business: string; from: string; to: string; status: Completeness; note?: string; currency?: string }) {
  const generated = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date());
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-ink-2 mb-4">
      <span className="font-medium text-ink">{business}</span>
      <span>{formatRange(from, to)}</span>
      <span>Currency: {currency === "NGN" ? "Naira (₦)" : currency}</span>
      <span>Generated {generated}</span>
      <span className={cn("inline-flex items-center gap-1", status === "complete" ? "text-positive" : status === "partial" ? "text-ink-2" : "text-warning")} title={note}>
        {status === "complete" ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
        {status === "complete" ? "Fully calculated" : status === "partial" ? "Partly estimated" : "Missing cost data"}
      </span>
    </div>
  );
}
