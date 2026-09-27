"use client";
// Shown inside the app shell when a page fails, so navigation still works. Nothing the person entered is lost:
// every save is a single database transaction, so a failed page never leaves half a record behind.
import Link from "next/link";
import { useEffect } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/primitives";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <div role="alert" className="animate-rise max-w-md mx-auto text-center py-16">
      <span className="mx-auto size-12 rounded-full bg-warning-soft text-warning grid place-items-center mb-5"><TriangleAlert size={22} aria-hidden /></span>
      <h1 className="text-title font-semibold">{offline ? "You're offline" : "This page didn't load"}</h1>
      <p className="text-body text-ink-2 mt-2">
        {offline ? "Check your internet connection, then try again." : "Something went wrong on our side. Your records are safe — nothing was saved halfway."}
      </p>
      <div className="flex justify-center gap-2 mt-6">
        <Button onClick={reset}><RefreshCw size={16} aria-hidden />Try again</Button>
        <Link href="/dashboard" className="h-10 px-4 rounded-full bg-fill hover:bg-fill-hover grid place-items-center text-body font-medium">Go to dashboard</Link>
      </div>
      {error.digest && <p className="text-caption text-ink-3 mt-6">Reference: {error.digest}</p>}
    </div>
  );
}
