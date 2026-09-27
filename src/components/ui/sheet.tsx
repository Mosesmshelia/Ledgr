"use client";
// Sheet: a bottom sheet on phones, a centred panel on larger screens.
// Built on <dialog> so focus trapping, Esc to close and screen-reader semantics come for free.
import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "./primitives";

export function Sheet({ open, onClose, title, subtitle, children, footer, wide }: {
  open: boolean; onClose: () => void; title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      aria-labelledby={titleId}
      className={cn(
        "backdrop:bg-black/40 backdrop:backdrop-blur-[2px] bg-transparent p-0 m-0 max-w-none max-h-none w-full h-full",
        "open:flex items-end sm:items-center justify-center",
      )}
    >
      <div
        className={cn(
          "bg-raised text-ink w-full sm:w-[min(92vw,var(--w))] max-h-[92dvh] flex flex-col shadow-[var(--shadow-sheet)]",
          "rounded-t-[16px] sm:rounded-[16px] animate-[sheet-in_220ms_var(--ease-apple)]",
        )}
        style={{ ["--w" as string]: wide ? "720px" : "480px" }}
      >
        <div className="sm:hidden mx-auto mt-2 h-1 w-9 rounded-full bg-hairline-strong" aria-hidden />
        <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
          <div>
            <h2 id={titleId} className="text-headline font-semibold">{title}</h2>
            {subtitle && <div className="text-caption text-ink-2 mt-0.5">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="size-8 -mr-1 rounded-full bg-fill grid place-items-center text-ink-2 hover:bg-fill-hover" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 pb-5 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-hairline pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </dialog>
  );
}
