// Loading placeholders shaped like the real pages, so content "arrives" instead of popping in.
// Screen readers hear one polite "Loading…" instead of a pile of empty boxes.
import { cn } from "./primitives";

export function Bone({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

function Frame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading {label}…</span>
      {children}
    </div>
  );
}

function CardBone({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <div className={cn("bg-surface rounded-[16px] border border-hairline p-5", className)} aria-hidden>{children}</div>;
}

function Header({ actions = true }: { actions?: boolean }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-6">
      <div className="flex flex-col gap-2"><Bone className="h-7 w-52" /><Bone className="h-4 w-72 max-w-[60vw]" /></div>
      {actions && <Bone className="h-10 w-28 rounded-full hidden sm:block" />}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <Frame label="your dashboard">
      <Header />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <CardBone key={i} className={cn("p-4 min-h-[148px] flex flex-col gap-3", i === 4 && "col-span-2 lg:col-span-1")}>
            <Bone className="h-3.5 w-20" /><Bone className="h-8 w-28" /><Bone className="h-3 w-24 mt-auto" />
          </CardBone>
        ))}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
        {Array.from({ length: 4 }).map((_, i) => <CardBone key={i} className="p-4 flex flex-col gap-2.5"><Bone className="h-3.5 w-24" /><Bone className="h-6 w-20" /></CardBone>)}
      </div>
      <CardBone className="mt-3 flex flex-col gap-2.5"><Bone className="h-5 w-32" /><Bone className="h-4 w-full" /><Bone className="h-4 w-11/12" /><Bone className="h-4 w-2/3" /></CardBone>
      <CardBone className="mt-3"><Bone className="h-5 w-40 mb-5" /><Bone className="h-56 w-full rounded-[12px]" /></CardBone>
    </Frame>
  );
}

export function ListSkeleton({ label = "this page", rows = 8 }: { label?: string; rows?: number }) {
  return (
    <Frame label={label}>
      <Header />
      <div className="flex gap-2 mb-3"><Bone className="h-10 flex-1 max-w-sm rounded-[10px]" /><Bone className="h-10 w-24 rounded-full" /><Bone className="h-10 w-24 rounded-full hidden sm:block" /></div>
      <CardBone className="p-0 overflow-hidden">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-3.5 border-t border-hairline first:border-0">
            <div className="flex-1 flex flex-col gap-2"><Bone className="h-4 w-2/5" /><Bone className="h-3 w-1/4" /></div>
            <Bone className="h-6 w-16 rounded-full hidden sm:block" />
            <Bone className="h-4 w-20" />
          </div>
        ))}
      </CardBone>
    </Frame>
  );
}

export function ReportSkeleton({ label = "the report" }: { label?: string }) {
  return (
    <Frame label={label}>
      <Bone className="h-4 w-20 mb-4" />
      <Header />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        {Array.from({ length: 4 }).map((_, i) => <CardBone key={i} className="p-4 flex flex-col gap-2.5"><Bone className="h-3.5 w-20" /><Bone className="h-6 w-24" /></CardBone>)}
      </div>
      <CardBone className="flex flex-col gap-3">
        {Array.from({ length: 10 }).map((_, i) => <div key={i} className="flex justify-between gap-4"><Bone className={cn("h-4", i % 3 === 0 ? "w-1/3" : "w-1/2")} /><Bone className="h-4 w-24" /></div>)}
      </CardBone>
    </Frame>
  );
}

export function DetailSkeleton({ label = "details" }: { label?: string }) {
  return (
    <Frame label={label}>
      <Bone className="h-4 w-20 mb-4" />
      <Header />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <CardBone key={i} className="p-4 flex flex-col gap-2.5"><Bone className="h-3.5 w-16" /><Bone className="h-6 w-24" /></CardBone>)}
      </div>
      <CardBone className="mt-3 flex flex-col gap-3">{Array.from({ length: 6 }).map((_, i) => <Bone key={i} className="h-4 w-full" />)}</CardBone>
    </Frame>
  );
}

export function FormSkeleton({ label = "the form" }: { label?: string }) {
  return (
    <Frame label={label}>
      <Bone className="h-4 w-20 mb-4" />
      <Header actions={false} />
      <CardBone className="grid sm:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="flex flex-col gap-2"><Bone className="h-3.5 w-20" /><Bone className="h-11 w-full rounded-[10px]" /></div>)}
      </CardBone>
      <CardBone className="mt-3 flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="flex gap-3"><Bone className="h-11 flex-1 rounded-[10px]" /><Bone className="h-11 w-28 rounded-[10px]" /><Bone className="h-11 w-28 rounded-[10px]" /></div>)}
      </CardBone>
    </Frame>
  );
}
