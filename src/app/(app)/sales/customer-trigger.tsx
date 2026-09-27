"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { NewCustomerSheet } from "./new/sale-form";

export function CustomerSheetTrigger({ open: initial }: { open: boolean }) {
  const [open, setOpen] = useState(initial);
  const router = useRouter();
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} className="hidden sm:inline-flex"><UserPlus size={16} />Customer</Button>
      <NewCustomerSheet open={open} onClose={() => { setOpen(false); if (initial) router.replace("/sales"); }} />
    </>
  );
}
