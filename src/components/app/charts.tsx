"use client";
// Trend charts. Dataviz rules: one y-axis per chart, thin rounded bars with a 2px gap, 2px lines,
// validated series colours (blue = money in / gross, orange = money out, aqua = net), a legend,
// a hover tooltip, and a table view for every chart (colour is never the only way to read it).
import { useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/finance/money";
import { cn } from "@/components/ui/primitives";
import type { Bucket } from "@/lib/finance/summary";

type Gran = "daily" | "weekly" | "monthly";
const GRAN_LABEL: Record<Gran, string> = { daily: "Daily · 30 days", weekly: "Weekly · 12 weeks", monthly: "Monthly" };

const axis = { tickLine: false, axisLine: false, tick: { fill: "var(--text-3)", fontSize: 11 } } as const;
const yFmt = (v: number) => formatMoney(v, { compact: true });

export function TrendSection({ trends }: { trends: Record<Gran, Bucket[]> }) {
  const [gran, setGran] = useState<Gran>("weekly");
  const data = trends[gran];
  const prefix = gran === "weekly" ? "Week of " : "";
  return (
    <section aria-label="Trends" className="mt-3">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 mt-6">
        <h2 className="text-headline font-semibold">Trends</h2>
        <div role="tablist" aria-label="Chart range" className="inline-flex p-0.5 rounded-[10px] bg-fill">
          {(Object.keys(GRAN_LABEL) as Gran[]).map((g) => (
            <button key={g} role="tab" aria-selected={gran === g} onClick={() => setGran(g)}
              className={cn("h-8 px-3 rounded-[8px] text-caption font-medium whitespace-nowrap transition-all", gran === g ? "bg-surface text-ink shadow-[0_1px_3px_rgba(0,0,0,0.12)]" : "text-ink-2 hover:text-ink")}>
              {GRAN_LABEL[g]}
            </button>
          ))}
        </div>
      </div>
      <div className="grid lg:grid-cols-2 gap-3">
        <ChartCard title="Revenue vs costs" subtitle="Costs = goods sold + operating expenses" className="lg:col-span-2"
          legend={[["bg-series-1", "Revenue"], ["bg-series-2", "Costs"]]}
          table={<Table rows={data} prefix={prefix} cols={[["Revenue", (b) => b.revenue], ["Costs", (b) => b.cogs + b.opex], ["Profit", (b) => b.netOperating]]} />}>
          <BarChart data={data} barGap={2} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={14} />
            <YAxis {...axis} width={52} tickFormatter={yFmt} />
            <Tooltip cursor={{ fill: "var(--fill)", radius: 6 }} content={(p) => <Tip {...p} prefix={prefix} rows={(b) => [["bg-series-1", "Revenue", b.revenue], ["bg-series-2", "Costs", b.cogs + b.opex], [null, "Profit", b.netOperating]]} />} />
            <Bar dataKey="revenue" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            <Bar dataKey={(b: Bucket) => b.cogs + b.opex} name="costs" fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
          </BarChart>
        </ChartCard>

        <ChartCard title="Profit trend" subtitle="Gross profit and net profit"
          legend={[["bg-series-1", "Gross profit"], ["bg-series-3", "Net profit"]]}
          table={<Table rows={data} prefix={prefix} cols={[["Gross profit", (b) => b.grossProfit], ["Net profit", (b) => b.netProfit]]} />}>
          <LineChart data={data}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={14} />
            <YAxis {...axis} width={52} tickFormatter={yFmt} />
            <ReferenceLine y={0} stroke="var(--hairline-strong)" />
            <Tooltip cursor={{ stroke: "var(--hairline-strong)" }} content={(p) => <Tip {...p} prefix={prefix} rows={(b) => [["bg-series-1", "Gross profit", b.grossProfit], ["bg-series-3", "Net profit", b.netProfit]]} />} />
            <Line dataKey="grossProfit" stroke="var(--series-1)" strokeWidth={2} dot={data.length <= 14 ? { r: 3, strokeWidth: 0, fill: "var(--series-1)" } : false} activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
            <Line dataKey="netProfit" stroke="var(--series-3)" strokeWidth={2} dot={data.length <= 14 ? { r: 3, strokeWidth: 0, fill: "var(--series-3)" } : false} activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        </ChartCard>

        <ChartCard title="Cash flow" subtitle="Money in vs money out (transfers between your accounts excluded)"
          legend={[["bg-series-1", "Money in"], ["bg-series-2", "Money out"]]}
          table={<Table rows={data} prefix={prefix} cols={[["In", (b) => b.cashIn], ["Out", (b) => b.cashOut], ["Net", (b) => b.cashIn - b.cashOut]]} />}>
          <BarChart data={data} barGap={2} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={14} />
            <YAxis {...axis} width={52} tickFormatter={yFmt} />
            <Tooltip cursor={{ fill: "var(--fill)", radius: 6 }} content={(p) => <Tip {...p} prefix={prefix} rows={(b) => [["bg-series-1", "Money in", b.cashIn], ["bg-series-2", "Money out", b.cashOut], [null, "Net", b.cashIn - b.cashOut]]} />} />
            <Bar dataKey="cashIn" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            <Bar dataKey="cashOut" fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
          </BarChart>
        </ChartCard>
      </div>
    </section>
  );
}

function ChartCard({ title, subtitle, legend, table, children, className }: { title: string; subtitle: string; legend: [string, string][]; table: ReactNode; children: React.ReactElement; className?: string }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <div className={cn("bg-surface rounded-[16px] border border-hairline p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-headline font-semibold">{title}</h3>
          <p className="text-caption text-ink-2">{subtitle}</p>
        </div>
        <button onClick={() => setShowTable(!showTable)} className="tap text-caption text-accent font-medium shrink-0">{showTable ? "Chart" : "Table"}</button>
      </div>
      <div className="flex gap-4 text-caption text-ink-2 mt-3 mb-2">
        {legend.map(([c, l]) => <span key={l} className="inline-flex items-center gap-1.5"><span className={cn("size-2.5 rounded-[3px]", c)} />{l}</span>)}
      </div>
      {showTable ? <div className="max-h-[240px] overflow-y-auto">{table}</div> : (
        <div className="h-[240px] -ml-2" role="img" aria-label={`${title} chart. Use the Table button for the numbers.`}>
          <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function Table({ rows, cols, prefix }: { rows: Bucket[]; cols: [string, (b: Bucket) => number][]; prefix: string }) {
  return (
    <table className="w-full text-caption num">
      <thead className="sticky top-0 bg-surface"><tr className="text-ink-2 text-left"><th className="py-2 font-medium">{prefix ? "Week of" : "Period"}</th>{cols.map(([l]) => <th key={l} className="font-medium text-right">{l}</th>)}</tr></thead>
      <tbody>{[...rows].reverse().map((b) => (
        <tr key={b.from} className="border-t border-hairline">
          <td className="py-1.5">{b.label}{b.incomplete && <span className="text-warning" title="Some sales are missing cost"> *</span>}</td>
          {cols.map(([l, f]) => <td key={l} className={cn("text-right", f(b) < 0 && "text-negative")}>{formatMoney(f(b))}</td>)}
        </tr>
      ))}</tbody>
    </table>
  );
}

type TipRow = [string | null, string, number];
function Tip({ active, payload, label, prefix, rows }: { active?: boolean; payload?: readonly { payload?: unknown }[]; label?: string | number; prefix: string; rows: (b: Bucket) => TipRow[] }) {
  if (!active || !payload?.length) return null;
  const b = payload[0].payload as Bucket;
  return (
    <div className="bg-raised border border-hairline rounded-[10px] shadow-[var(--shadow-sheet)] px-3 py-2 text-caption num min-w-48">
      <div className="font-semibold mb-1">{prefix}{label}</div>
      {rows(b).map(([c, l, v]) => (
        <div key={l} className={cn("flex justify-between gap-4", !c && "border-t border-hairline mt-1 pt-1")}>
          <span className="inline-flex items-center gap-1.5 text-ink-2">{c && <span className={cn("size-2 rounded-[2px]", c)} />}{l}</span>
          <span className={cn(!c && "font-medium", v < 0 && "text-negative")}>{formatMoney(v)}</span>
        </div>
      ))}
      {b.incomplete && <div className="text-warning mt-1">Some sales are missing cost</div>}
    </div>
  );
}

/** Revenue over time for Analytics: one series, one axis, table view available. */
export function SalesOverTime({ data }: { data: { label: string; revenue: number; sales: number; units: number }[] }) {
  const [table, setTable] = useState(false);
  return (
    <div className="bg-surface rounded-[16px] border border-hairline p-5">
      <div className="flex items-start justify-between gap-3">
        <div><h3 className="text-headline font-semibold">Revenue over time</h3><p className="text-caption text-ink-2">Net of discounts and returns, excluding VAT</p></div>
        <button onClick={() => setTable(!table)} className="tap text-caption text-accent font-medium">{table ? "Chart" : "Table"}</button>
      </div>
      {table ? (
        <div className="max-h-[260px] overflow-y-auto mt-3">
          <table className="w-full text-caption num">
            <thead className="sticky top-0 bg-surface"><tr className="text-ink-2 text-left"><th className="py-2 font-medium">Period</th><th className="font-medium text-right">Sales</th><th className="font-medium text-right">Units</th><th className="font-medium text-right">Revenue</th></tr></thead>
            <tbody>{[...data].reverse().map((d) => <tr key={d.label} className="border-t border-hairline"><td className="py-1.5">{d.label}</td><td className="text-right">{d.sales}</td><td className="text-right">{d.units.toLocaleString()}</td><td className="text-right">{formatMoney(d.revenue)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="h-[260px] -ml-2 mt-3" role="img" aria-label="Revenue over time. Use the Table button for the numbers.">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barCategoryGap="20%">
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={14} />
              <YAxis {...axis} width={52} tickFormatter={yFmt} />
              <Tooltip cursor={{ fill: "var(--fill)", radius: 6 }} content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as { revenue: number; sales: number; units: number };
                return (
                  <div className="bg-raised border border-hairline rounded-[10px] shadow-[var(--shadow-sheet)] px-3 py-2 text-caption num min-w-40">
                    <div className="font-semibold mb-1">{label}</div>
                    <div className="flex justify-between gap-4"><span className="text-ink-2">Revenue</span><span className="font-medium">{formatMoney(d.revenue)}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-ink-2">Sales</span><span>{d.sales}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-ink-2">Units</span><span>{d.units.toLocaleString()}</span></div>
                  </div>
                );
              }} />
              <Bar dataKey="revenue" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
