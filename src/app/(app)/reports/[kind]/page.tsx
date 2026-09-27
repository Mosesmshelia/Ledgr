import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireCtx } from "@/lib/server/session";
import { can } from "@/lib/permissions";
import { buildReport, REPORTS } from "@/lib/server/report-defs";
import { PeriodSelector } from "@/components/app/period-selector";
import { ReportMeta } from "@/components/app/report-header";
import { ExportMenu } from "@/components/app/export-menu";
import { ReportFilters, AsAtPicker } from "@/components/app/report-controls";
import { Figures, SectionView, SummaryCard } from "@/components/app/report-view";
import { parsePeriodParams } from "@/lib/period-params";
import { addMonths, todayIn } from "@/lib/finance";

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  return { title: REPORTS[kind]?.title ?? "Report" };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default async function ReportPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx();
  const { kind } = await params;
  const sp = await searchParams;
  const r = await buildReport(ctx, kind, sp);
  if (!r) notFound();
  const today = todayIn(ctx.business.timezone);
  const query = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  const { key, custom } = parsePeriodParams(sp, REPORTS[kind].defaultPeriod);
  const month = r.from.slice(0, 7);

  return (
    <div className="animate-rise">
      <Link href="/reports" className="tap inline-flex items-center gap-1 text-body text-accent mb-3 print:hidden"><ChevronLeft size={18} />Reports</Link>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h1 className="text-title font-semibold">{r.title}</h1>
          <p className="text-body text-ink-2">{REPORTS[kind].description}</p>
        </div>
        <ExportMenu kind={kind} query={query} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        {r.periodMode === "range" && <PeriodSelector value={key} basePath={`/reports/${kind}`} from={custom?.from} to={custom?.to} today={today} />}
        {r.periodMode === "month" && (
          <div className="flex items-center gap-2 print:hidden">
            <Link href={`/reports/${kind}?month=${addMonths(month + "-01", -1).slice(0, 7)}`} className="size-9 grid place-items-center rounded-[10px] bg-fill hover:bg-fill-hover" aria-label="Previous month"><ChevronLeft size={17} /></Link>
            <span className="text-body font-medium min-w-36 text-center">{MONTHS[Number(month.slice(5)) - 1]} {month.slice(0, 4)}</span>
            {month < today.slice(0, 7)
              ? <Link href={`/reports/${kind}?month=${addMonths(month + "-01", 1).slice(0, 7)}`} className="size-9 grid place-items-center rounded-[10px] bg-fill hover:bg-fill-hover" aria-label="Next month"><ChevronRight size={17} /></Link>
              : <span className="size-9 grid place-items-center rounded-[10px] bg-fill opacity-40" aria-hidden><ChevronRight size={17} /></span>}
          </div>
        )}
        {r.periodMode === "asAt" && <AsAtPicker value={r.to} max={today} />}
        <ReportFilters filters={r.filters ?? []} searchable={r.sections.some((s) => s.searchable)} />
      </div>

      <ReportMeta business={r.business} from={r.from} to={r.to} status={r.status} note={r.statusNote} />
      {r.statusNote && <p className="text-caption text-warning -mt-2 mb-3">{r.statusNote}</p>}
      {kind === "budget" && can(ctx.role, "record") && <p className="text-body mb-3 print:hidden"><Link href={`/reports/budget/edit?month=${month}`} className="text-accent font-medium">Set or change budgets for this month →</Link></p>}
      <Figures r={r} />
      <SummaryCard lines={r.summary} />
      {r.sections.map((s, i) => <SectionView key={i} s={s} />)}
    </div>
  );
}
