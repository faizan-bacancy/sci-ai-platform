"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bar, BarChart, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, CalendarRange, PackageSearch, Wallet } from "lucide-react";

import type { DashboardPayload } from "./dashboard-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const RANGE_OPTIONS = [
  { label: "Last 7 days", value: "7" },
  { label: "Last 30 days", value: "30" },
  { label: "Last 90 days", value: "90" },
] as const;

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    value,
  );
}

function formatShortNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatDateLabel(value: string) {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${month}/${day}`;
}

function statusBadge(status: DashboardPayload["openPurchaseOrders"][number]["status"]) {
  if (status === "draft") return <Badge variant="outline">Draft</Badge>;
  if (status === "sent") return <Badge variant="secondary">Sent</Badge>;
  if (status === "confirmed") return <Badge variant="secondary">Confirmed</Badge>;
  if (status === "partially_received") return <Badge variant="secondary">Partially received</Badge>;
  if (status === "received") return <Badge>Received</Badge>;
  return <Badge variant="destructive">Cancelled</Badge>;
}

function riskBadge(status: DashboardPayload["riskDistribution"][number]["status"]) {
  if (status === "Stockout") return <Badge variant="destructive">Stockout</Badge>;
  if (status === "At Risk") return <Badge className="bg-amber-100 text-amber-900">At Risk</Badge>;
  return <Badge className="bg-emerald-100 text-emerald-900">Healthy</Badge>;
}

export function DashboardPage({ payload }: { payload: DashboardPayload }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [range, setRange] = useState(String(payload.filters.rangeDays));
  const [warehouseId, setWarehouseId] = useState(String(payload.filters.warehouseId));

  const handleFilterChange = (nextRange: string, nextWarehouse: string) => {
    const params = new URLSearchParams(searchParams?.toString());
    params.set("range", nextRange);
    params.set("warehouse", nextWarehouse);
    router.replace(`/dashboard?${params.toString()}`);
  };

  const kpis = useMemo(
    () => [
      {
        label: "Inventory value",
        value: formatCurrency(payload.kpis.inventoryValue),
        icon: Wallet,
        trend: payload.kpis.inventoryValue > 0 ? "up" : "flat",
      },
      {
        label: "At-risk SKUs",
        value: formatShortNumber(payload.kpis.atRiskSkus),
        icon: PackageSearch,
        trend: payload.kpis.atRiskSkus > 0 ? "up" : "flat",
      },
      {
        label: "Stockout SKUs",
        value: formatShortNumber(payload.kpis.stockoutSkus),
        icon: PackageSearch,
        trend: payload.kpis.stockoutSkus > 0 ? "up" : "flat",
      },
      {
        label: "Open purchase orders",
        value: formatShortNumber(payload.kpis.openPoCount),
        icon: CalendarRange,
        trend: payload.kpis.openPoCount > 0 ? "up" : "flat",
      },
      {
        label: "Open PO value",
        value: formatCurrency(payload.kpis.openPoValue),
        icon: Wallet,
        trend: payload.kpis.openPoValue > 0 ? "up" : "flat",
      },
    ],
    [payload.kpis],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome{payload.greetingName ? `, ${payload.greetingName}` : ""}. Here’s the latest supply overview.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={warehouseId}
            onValueChange={(value) => {
              const nextValue = value ?? "all";
              setWarehouseId(nextValue);
              handleFilterChange(range, nextValue);
            }}
          >
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue placeholder="All warehouses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All warehouses</SelectItem>
              {payload.warehouses.map((warehouse) => (
                <SelectItem key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={range}
            onValueChange={(value) => {
              const nextValue = value ?? range;
              setRange(nextValue);
              handleFilterChange(nextValue, warehouseId);
            }}
          >
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="Range" />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          const trendUp = kpi.trend === "up";
          return (
            <Card key={kpi.label} className="relative overflow-hidden">
              <CardHeader className="space-y-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">{kpi.label}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-2xl font-semibold tracking-tight">{kpi.value}</div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
                      trendUp ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {trendUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {trendUp ? "Trending" : "Stable"}
                  </span>
                </div>
              </CardContent>
              <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-muted/40 p-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
              </div>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">PO spend trend</CardTitle>
          </CardHeader>
          <CardContent>
            {payload.spendTrend.length === 0 ? (
              <div className="text-sm text-muted-foreground">No spend data for this range.</div>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={payload.spendTrend}>
                    <XAxis dataKey="date" tickFormatter={formatDateLabel} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tickFormatter={(v) => `$${v}`} stroke="hsl(var(--muted-foreground))" />
                    <Line type="monotone" dataKey="spend" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inventory risk distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2 pb-3">
              {payload.riskDistribution.map((risk) => (
                <div key={risk.status} className="flex items-center gap-2 text-sm">
                  {riskBadge(risk.status)}
                  <span className="text-muted-foreground">{formatShortNumber(risk.count)} SKUs</span>
                </div>
              ))}
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={payload.riskDistribution}>
                  <XAxis dataKey="status" stroke="hsl(var(--muted-foreground))" />
                  <YAxis stroke="hsl(var(--muted-foreground))" />
                  <Bar dataKey="count" fill="hsl(var(--chart-2))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Low stock watchlist</CardTitle>
            <Button variant="outline" size="sm" onClick={() => router.push("/inventory")}>View inventory</Button>
          </CardHeader>
          <CardContent>
            {payload.lowStockRows.length === 0 ? (
              <div className="text-sm text-muted-foreground">No low stock items found.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Warehouse</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead className="text-right">Reorder</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payload.lowStockRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">{row.sku}</TableCell>
                      <TableCell>{row.productName}</TableCell>
                      <TableCell>{row.warehouseName}</TableCell>
                      <TableCell className="text-right">{row.available.toFixed(0)}</TableCell>
                      <TableCell className="text-right">{row.reorderPoint.toFixed(0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Open purchase orders</CardTitle>
            <Button variant="outline" size="sm" onClick={() => router.push("/purchase-orders")}>View POs</Button>
          </CardHeader>
          <CardContent>
            {payload.openPurchaseOrders.length === 0 ? (
              <div className="text-sm text-muted-foreground">No open purchase orders.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PO</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payload.openPurchaseOrders.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">{row.poNumber}</TableCell>
                      <TableCell>{row.supplierName}</TableCell>
                      <TableCell>{statusBadge(row.status)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.totalAmount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent activity</CardTitle>
          <Button variant="outline" size="sm" onClick={() => router.push("/alerts")}>View alerts</Button>
        </CardHeader>
        <CardContent>
          {payload.recentItems.length === 0 ? (
            <div className="text-sm text-muted-foreground">No recent activity.</div>
          ) : (
            <div className="space-y-3">
              {payload.recentItems.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-4 rounded-lg border p-3">
                  <div>
                    <div className="text-sm font-medium">{item.summary}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.actor} · {item.entity} · {new Date(item.timestamp).toLocaleString()}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">{item.action}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
