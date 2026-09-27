"use client";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/primitives";

export function PrintButton({ label = "Print / save PDF" }: { label?: string }) {
  return <Button variant="secondary" onClick={() => window.print()} className="print:hidden"><Printer size={16} />{label}</Button>;
}
