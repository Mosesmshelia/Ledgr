// Export any report as PDF, CSV or Excel. Same definition as the screen, so the numbers are identical.
import { requireCtx } from "@/lib/server/session";
import { can } from "@/lib/permissions";
import { buildReport, reportFileName } from "@/lib/server/report-defs";
import { toCSV } from "@/lib/reports/export-csv";
import { toXLSX } from "@/lib/reports/export-xlsx";
import { toPDF } from "@/lib/reports/export-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx.role, "reports")) return Response.json({ error: "You don't have permission to see reports." }, { status: 403 });
  const { kind } = await params;
  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "pdf";
  const p = Object.fromEntries(url.searchParams.entries());
  const report = await buildReport(ctx, kind, p);
  if (!report) return new Response("Report not found", { status: 404 });

  if (format === "json") {
    // Machine-readable (kobo integers) — used by the verification script and, later, the AI assistant.
    return Response.json(report);
  }
  if (format === "csv") {
    return new Response(toCSV(report), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${reportFileName(report, "csv")}"` } });
  }
  if (format === "xlsx") {
    const buf = await toXLSX(report);
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${reportFileName(report, "xlsx")}"` } });
  }
  if (format === "pdf") {
    const buf = await toPDF(report);
    const inline = url.searchParams.get("inline") === "1";
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${reportFileName(report, "pdf")}"` } });
  }
  return new Response("Unknown format", { status: 400 });
}
