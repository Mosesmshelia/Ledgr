"use client";
import { useState, useTransition } from "react";
import { acceptInvite } from "@/app/actions/control";
import { Button } from "@/components/ui/primitives";

export function AcceptButton({ token }: { token: string }) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button size="lg" className="w-full" disabled={pending} onClick={() => start(async () => {
        const r = await acceptInvite(token);
        if (r && !r.ok) setErr(r.error);
      })}>{pending ? "Joining…" : "Accept and join"}</Button>
      {err && <p role="alert" className="text-caption text-negative mt-2">{err}</p>}
    </>
  );
}
