"use client";
// Small, calm motion: numbers that count up, bars that grow. Always off when the person prefers reduced motion.
import { useEffect, useRef, useState } from "react";
import { formatMoney, type Kobo } from "@/lib/finance/money";
import { cn } from "./primitives";

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** A naira amount that counts up from zero the first time it appears (and eases to new values after). */
export function CountUpMoney({ value, className, compact }: { value: Kobo; className?: string; compact?: boolean }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  const first = useRef(true);
  useEffect(() => {
    if (reducedMotion()) { setShown(value); return; }
    const start = first.current ? 0 : from.current;
    first.current = false;
    const t0 = performance.now();
    const dur = 900;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <span className={cn("num", className)}>
      <span aria-hidden>{formatMoney(shown, { compact })}</span>
      <span className="sr-only">{formatMoney(value, { compact })}</span>
    </span>
  );
}

/** Mini bar chart (decorative summary; the numbers are always given in text nearby). */
export function MiniBars({ values, labels, className }: { values: number[]; labels: string[]; className?: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className={cn("flex items-end gap-1.5 h-14", className)} aria-hidden>
      {values.map((v, i) => {
        const last = i === values.length - 1;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end" title={labels[i]}>
            <span
              className={cn("w-full rounded-[5px] animate-grow", last ? "bg-accent" : "bg-accent-soft")}
              style={{ height: `${Math.max(6, (v / max) * 100)}%`, animationDelay: `${i * 45}ms` }}
            />
          </div>
        );
      })}
    </div>
  );
}
