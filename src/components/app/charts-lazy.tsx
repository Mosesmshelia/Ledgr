"use client";
// Charts load as a separate download after the page's numbers are on screen (the chart library is the
// biggest piece of JavaScript in the app). A same-sized placeholder avoids any layout jump.
import dynamic from "next/dynamic";
import { Bone } from "@/components/ui/skeleton";

const Placeholder = ({ h }: { h: string }) => (
  <div className="bg-surface rounded-[16px] border border-hairline p-5 mt-3" role="status" aria-label="Loading chart">
    <Bone className="h-5 w-40 mb-5" /><Bone className={`${h} w-full rounded-[12px]`} />
  </div>
);

export const TrendSection = dynamic(() => import("./charts").then((m) => m.TrendSection), { loading: () => <Placeholder h="h-[520px]" /> });
export const SalesOverTime = dynamic(() => import("./charts").then((m) => m.SalesOverTime), { loading: () => <Placeholder h="h-64" /> });
