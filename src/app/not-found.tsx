import Link from "next/link";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className="min-h-dvh grid place-items-center px-4">
      <div className="max-w-sm text-center animate-rise">
        <span className="mx-auto size-12 rounded-[14px] bg-accent text-on-accent grid place-items-center font-semibold text-xl mb-5">L</span>
        <h1 className="text-title font-semibold">We couldn&apos;t find that</h1>
        <p className="text-body text-ink-2 mt-2">The page or record may have been moved, or the link is incomplete. Voided records are never deleted, so check your lists.</p>
        <Link href="/dashboard" className="inline-flex mt-6 h-11 px-5 rounded-full bg-accent text-on-accent items-center font-medium">Go to dashboard</Link>
      </div>
    </div>
  );
}
