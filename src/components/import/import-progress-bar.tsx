"use client";

import { cn } from "@/lib/utils";

export function ImportProgressBar({
  current,
  total,
  className,
}: {
  current: number;
  total: number;
  className?: string;
}) {
  const pct = total === 0 ? 0 : Math.min(100, Math.round((current / total) * 100));
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Batch {current} of {total}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted">
        <div className="h-2 rounded-full bg-foreground/80" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
