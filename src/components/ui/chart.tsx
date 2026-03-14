"use client";

import * as React from "react";
import { ResponsiveContainer } from "recharts";

import { cn } from "@/lib/utils";

export type ChartConfig = Record<
  string,
  {
    label?: string;
    color?: string;
  }
>;

export function ChartContainer({
  config,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ReactNode;
}) {
  const chartVars = React.useMemo(() => {
    const vars: Record<string, string> = {};

    for (const [key, value] of Object.entries(config)) {
      if (value?.color) {
        vars[`--color-${key}`] = value.color;
      }
    }

    return vars;
  }, [config]);

  return (
    <div
      className={cn("w-full", className)}
      style={{ ...(chartVars as React.CSSProperties), ...style }}
      {...props}
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}

