import Link from "next/link";
import type { ReportData, Section, Row } from "@/lib/reports/types";
import { formatCell, isNumeric } from "@/lib/reports/format";
import { formatMoney, formatPercent } from "@/lib/finance/money";
import { Card, cn } from "@/components/ui/primitives";
import { Sparkles } from "lucide-react";

const ROW: Record<string, string> = {
  header: "text-overline uppercase font-semibold text-ink-2 [&>td]:pt-5 [&>td]:pb-1 border-0",
  total: "font-semibold border-t border-hairline-strong",
  grand: "font-semibold text-headline border-t-2 border-ink/60",
  muted: "text-caption text-ink-2 border-0",
  warning: "text-warning",
  indent: "",
  normal: "",
};

export function Figures({ r }: { r: ReportData }) {
  if (!r.figures?.length) return null;
  return (
    <div className={cn("grid grid-cols-2 gap-3 mb-3", r.figures.length === 4 ? "lg:grid-cols-4" : r.figures.length >= 5 ? "lg:grid-cols-6" : "lg:grid-cols-3")}>
      {r.figures.map((f) => (
        <div key={f.label} className="bg-surface rounded-[16px] border border-hairline p-4">
          <div className="text-caption font-medium text-ink-2">{f.label}</div>
          <div className={cn("text-title font-semibold num mt-1", f.tone === "negative" && "text-negative", f.tone === "warning" && "text-warning")}
            title={f.type === "money" && f.value !== null ? formatMoney(f.value, { exact: true }) : undefined}>
            {f.value === null ? "—" : f.type === "money" ? formatMoney(f.value, { compact: Math.abs(f.value) >= 100_000_000 }) : f.type === "pct" ? formatPercent(f.value, 1) : f.value.toLocaleString("en-NG")}
          </div>
          {f.sub && <div className="text-caption text-ink-3 mt-0.5 truncate">{f.sub}</div>}
        </div>
      ))}
    </div>
  );
}

export function SummaryCard({ lines }: { lines?: string[] }) {
  if (!lines?.length) return null;
  return (
    <Card className="p-5 mb-3">
      <h2 className="text-headline font-semibold flex items-center gap-2 mb-2"><Sparkles size={17} className="text-accent" />In plain English</h2>
      {lines.map((l, i) => <p key={i} className="text-body leading-7">{l}</p>)}
    </Card>
  );
}

export function SectionView({ s }: { s: Section }) {
  const statement = s.kind === "statement";
  const cell = (row: Row, isTotal = false) => s.columns.map((c, i) => {
    const text = formatCell(c, row, { statement, exact: statement });
    const neg = c.type === "money" && typeof row[c.key] === "number" && (row[c.key] as number) < 0 && (row._style === "grand" || isTotal) && !row._pct;
    return (
      <td key={c.key} className={cn("py-2.5 px-3 first:pl-5 last:pr-5", isNumeric(c) ? "text-right whitespace-nowrap" : "", c.type === "date" && "whitespace-nowrap",
        i === 0 && "min-w-[150px]", i === 0 && row._style === "indent" && "pl-9 first:pl-9 text-ink-2", neg && "text-negative",
        c.type === "text" && i > 0 && "max-w-[320px] truncate whitespace-nowrap")}>
        {i === 0 && row._href ? <Link href={row._href} className="tap hover:text-accent">{text}</Link> : text}
      </td>
    );
  });
  return (
    <Card className="overflow-hidden mb-3">
      {(s.title || s.subtitle) && (
        <div className="px-5 pt-4 pb-1">
          {s.title && <h2 className="text-headline font-semibold">{s.title}</h2>}
          {s.subtitle && <p className="text-caption text-ink-2">{s.subtitle}</p>}
        </div>
      )}
      {s.rows.length === 0 ? <p className="px-5 py-6 text-body text-ink-2">Nothing to show for this period.</p> : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
          <table className="w-full text-body num">
            {s.columns.some((c) => c.label) && (
              <thead>
                <tr className="text-caption text-ink-2">
                  {s.columns.map((c) => <th key={c.key} className={cn("font-medium py-2.5 px-3 first:pl-5 last:pr-5 whitespace-nowrap", isNumeric(c) ? "text-right" : "text-left")}>{c.label}</th>)}
                </tr>
              </thead>
            )}
            <tbody>
              {s.rows.map((row, i) => <tr key={i} className={cn("border-t border-hairline", ROW[row._style ?? "normal"])}>{cell(row)}</tr>)}
              {s.totals && <tr className={ROW.total}>{cell(s.totals, true)}</tr>}
            </tbody>
          </table>
        </div>
      )}
      {s.note && <p className="px-5 py-3 text-caption text-ink-3 border-t border-hairline">{s.note}</p>}
    </Card>
  );
}
