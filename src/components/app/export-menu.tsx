"use client";
import { useState } from "react";
import { Download, FileSpreadsheet, FileText, Sheet as SheetIcon } from "lucide-react";
import { cn } from "@/components/ui/primitives";
import { PrintButton } from "./print-button";

/** PDF / Excel / CSV downloads for a report, carrying the current filters. */
export function ExportMenu({ kind, query }: { kind: string; query: string }) {
  const [open, setOpen] = useState(false);
  const href = (f: string) => `/api/reports/${kind}?format=${f}${query ? "&" + query : ""}`;
  const items = [
    { f: "pdf", label: "PDF", hint: "To share or print", icon: FileText },
    { f: "xlsx", label: "Excel", hint: "Real numbers you can work with", icon: FileSpreadsheet },
    { f: "csv", label: "CSV", hint: "For any spreadsheet or accounting app", icon: SheetIcon },
  ];
  return (
    <div className="relative flex items-center gap-2 print:hidden">
      <PrintButton label="Print" />
      <button onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}
        className="inline-flex items-center gap-2 h-10 px-4 rounded-[10px] bg-accent text-on-accent text-body font-medium hover:bg-accent-hover active:scale-[0.98] transition">
        <Download size={16} />Export
      </button>
      {open && (
        <div role="menu" onMouseLeave={() => setOpen(false)}
          className="absolute right-0 top-12 z-30 w-64 bg-raised border border-hairline rounded-[14px] shadow-[var(--shadow-sheet)] p-1.5 animate-[rise_150ms_var(--ease-apple)]">
          {items.map((i) => (
            <a key={i.f} role="menuitem" href={href(i.f)} download onClick={() => setOpen(false)}
              className={cn("flex items-center gap-3 rounded-[10px] px-3 py-2.5 hover:bg-fill")}>
              <span className="size-8 rounded-full bg-accent-soft text-accent grid place-items-center"><i.icon size={16} /></span>
              <span className="flex flex-col"><span className="text-body font-medium">{i.label}</span><span className="text-caption text-ink-2">{i.hint}</span></span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
