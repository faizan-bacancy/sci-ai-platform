"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DatePicker } from "@/components/shared/date-picker";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/browser";

function startOfMonth(date: Date) {
  const value = new Date(date.getFullYear(), date.getMonth(), 1);
  return value.toISOString().slice(0, 10);
}

function endOfMonth(date: Date) {
  const value = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return value.toISOString().slice(0, 10);
}

type SupplierPerformanceRow = {
  supplier_id: string;
  period_start: string;
  period_end: string;
  on_time_delivery_rate: number;
  quality_rate: number;
  fill_rate: number;
  avg_lead_time_days: number;
  total_orders: number;
  composite_score: number;
  trend: "improving" | "stable" | "declining";
  supplier?: { company_name: string };
};

async function fetchSupplierPerformance(periodStart: string, periodEnd: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("supplier_performance_scores")
    .select(
      "supplier_id,period_start,period_end,on_time_delivery_rate,quality_rate,fill_rate,avg_lead_time_days,total_orders,composite_score,trend,supplier:suppliers(company_name)",
    )
    .gte("period_start", periodStart)
    .lte("period_end", periodEnd)
    .order("period_end", { ascending: false });

  if (error) throw new Error(error.message);

  const latestBySupplier = new Map<string, SupplierPerformanceRow>();
  for (const row of (data ?? []) as unknown as SupplierPerformanceRow[]) {
    const existing = latestBySupplier.get(row.supplier_id);
    if (!existing || new Date(row.period_end).getTime() > new Date(existing.period_end).getTime()) {
      latestBySupplier.set(row.supplier_id, row);
    }
  }

  return Array.from(latestBySupplier.values()).sort((a, b) => b.composite_score - a.composite_score);
}

function trendBadge(trend: SupplierPerformanceRow["trend"]) {
  if (trend === "improving") return <StatusBadge label="Improving ↑" variant="secondary" />;
  if (trend === "declining") return <StatusBadge label="Declining ↓" variant="destructive" />;
  return <StatusBadge label="Stable →" variant="outline" />;
}

const supplierChartConfig = {
  onTime: { label: "On time %", color: "#16a34a" },
  quality: { label: "Quality %", color: "#2563eb" },
  fillRate: { label: "Fill %", color: "#f59e0b" },
} satisfies ChartConfig;

export function SupplierPerformancePage() {
  const router = useRouter();
  const now = new Date();

  const [periodStart, setPeriodStart] = useState(startOfMonth(now));
  const [mounted, setMounted] = useState(false);
  const [periodEnd, setPeriodEnd] = useState(endOfMonth(now));

  useEffect(() => {
    setMounted(true);
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ["supplier_performance", periodStart, periodEnd],
    queryFn: () => fetchSupplierPerformance(periodStart, periodEnd),
  });

  const chartData = useMemo(
    () =>
      (data ?? []).map((row) => ({
        name: row.supplier?.company_name ?? row.supplier_id.slice(0, 8),
        onTime: Number((row.on_time_delivery_rate * 100).toFixed(1)),
        quality: Number((row.quality_rate * 100).toFixed(1)),
        fillRate: Number((row.fill_rate * 100).toFixed(1)),
      })),
    [data],
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Supplier Performance" subtitle="Compare supplier reliability and service levels." />

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
        <div className="space-y-1">
          <div className="text-xs uppercase text-muted-foreground">From</div>
          <DatePicker value={periodStart} onChange={setPeriodStart} />
        </div>
        <div className="space-y-1">
          <div className="text-xs uppercase text-muted-foreground">To</div>
          <DatePicker value={periodEnd} onChange={setPeriodEnd} />
        </div>
      </div>

      <div className="rounded-lg border bg-gradient-to-br from-emerald-50/40 via-blue-50/30 to-amber-50/40 p-4 dark:from-emerald-950/10 dark:via-blue-950/10 dark:to-amber-950/10">
        <div className="mb-3 text-sm font-medium">Supplier metric comparison</div>
        <div className="h-72 w-full">
          {mounted ? (
            <ChartContainer config={supplierChartConfig} className="h-72 w-full">
              <BarChart data={chartData}>
                <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="name"
                  tick={false}
                  tickLine={false}
                  axisLine={false}
                  height={8}
                />
                <YAxis domain={[0, 100]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                <Tooltip
                  formatter={(value, metric) => [`${Number(value ?? 0).toFixed(1)}%`, String(metric)]}
                  labelFormatter={(label) => `Supplier: ${String(label ?? "-")}`}
                  contentStyle={{
                    borderRadius: "0.5rem",
                    border: "1px solid hsl(var(--border))",
                    backgroundColor: "hsl(var(--card))",
                  }}
                />
                <Legend />
                <Bar dataKey="onTime" name="On time %" fill="#16a34a" radius={[4, 4, 0, 0]} />
                <Bar dataKey="quality" name="Quality %" fill="#2563eb" radius={[4, 4, 0, 0]} />
                <Bar dataKey="fillRate" name="Fill %" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          ) : (
            <div className="h-full w-full animate-pulse rounded-md bg-muted/30" />
          )}
        </div>
      </div>

      {error ? <div className="rounded-md border p-4 text-sm text-destructive">{(error as Error).message}</div> : null}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Supplier</TableHead>
              <TableHead>Composite</TableHead>
              <TableHead>On time</TableHead>
              <TableHead>Quality</TableHead>
              <TableHead>Fill rate</TableHead>
              <TableHead>Lead time (days)</TableHead>
              <TableHead>Trend</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">Loading supplier performance...</TableCell>
              </TableRow>
            ) : (data ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">No performance records for selected range.</TableCell>
              </TableRow>
            ) : (
              (data ?? []).map((row) => (
                <TableRow key={`${row.supplier_id}-${row.period_end}`} className="cursor-pointer" onClick={() => router.push(`/suppliers/${row.supplier_id}`)}>
                  <TableCell className="font-medium">{row.supplier?.company_name ?? row.supplier_id}</TableCell>
                  <TableCell>{(row.composite_score * 100).toFixed(1)}%</TableCell>
                  <TableCell>{(row.on_time_delivery_rate * 100).toFixed(1)}%</TableCell>
                  <TableCell>{(row.quality_rate * 100).toFixed(1)}%</TableCell>
                  <TableCell>{(row.fill_rate * 100).toFixed(1)}%</TableCell>
                  <TableCell>{Number(row.avg_lead_time_days).toFixed(1)}</TableCell>
                  <TableCell>{trendBadge(row.trend)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}







