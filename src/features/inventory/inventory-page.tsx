"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef, type SortingState } from "@tanstack/react-table";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { Line, LineChart } from "recharts";
import * as XLSX from "xlsx";

import { useProfile } from "@/components/app/profile-context";
import { DataTable } from "@/components/shared/data-table";
import { FilterBar } from "@/components/shared/filter-bar";
import { FormField } from "@/components/shared/form-field";
import { PageHeader } from "@/components/shared/page-header";
import { SlideOverPanel } from "@/components/shared/slide-over-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addMetadataSheet, buildWorksheet, downloadWorkbook, formatISODate } from "@/lib/excel";
import { canWrite } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/browser";

const PAGE_SIZE = 25;
const TREND_DAYS = 30;

type InventoryRow = {
  id: string;
  qty_on_hand: number;
  qty_reserved: number;
  qty_on_order: number;
  product_id: string;
  warehouse_id: string;
  product?: { id: string; sku: string; name: string; unit_cost: number };
  warehouse?: { id: string; name: string; code: string };
};

type InventoryHealth = {
  days_of_stock_remaining: number | null;
  stock_status: "stockout" | "critical" | "low" | "healthy" | "overstock";
  quantity_available: number;
  reorder_point: number;
  safety_stock: number;
  eoq: number;
  avg_daily_demand: number;
  recommended_action: string;
};

type WarehouseOption = { id: string; name: string; code: string };

type InventoryQueryParams = { q: string; warehouse: string; page: number };

type InventorySummary = {
  totalSkusTracked: number;
  atOrBelowReorderPoint: number;
  overstockCount: number;
  stockoutRiskValue: number;
};

function keyFor(productId: string, warehouseId: string) {
  return `${productId}:${warehouseId}`;
}

function statusBadge(status: InventoryHealth["stock_status"]) {
  if (status === "stockout") return <Badge variant="destructive">Stockout</Badge>;
  if (status === "critical") return <Badge className="bg-orange-200 text-orange-900">Critical</Badge>;
  if (status === "low") return <Badge className="bg-amber-100 text-amber-900">Low</Badge>;
  if (status === "healthy") return <Badge className="bg-green-100 text-green-900">Healthy</Badge>;
  return <Badge className="bg-blue-100 text-blue-900">Overstock</Badge>;
}

function lastDates(days: number) {
  const now = new Date();
  const result: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    result.push(formatISODate(d));
  }
  return result;
}

async function fetchWarehouses() {
  const supabase = createClient();
  const { data, error } = await supabase.from("warehouses").select("id,name,code").order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as WarehouseOption[];
}

async function fetchInventory(params: InventoryQueryParams) {
  const supabase = createClient();
  let query = supabase
    .from("inventory")
    .select(
      "id,qty_on_hand,qty_reserved,qty_on_order,product_id,warehouse_id,product:products(id,sku,name,unit_cost),warehouse:warehouses(id,name,code)",
      { count: "exact" },
    );

  if (params.q.trim()) {
    const q = params.q.trim();
    query = query.or(`products.name.ilike.%${q}%,products.sku.ilike.%${q}%`);
  }

  if (params.warehouse !== "all") query = query.eq("warehouse_id", params.warehouse);

  const from = (params.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const { data, count, error } = await query.order("updated_at", { ascending: false }).range(from, to);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as unknown as InventoryRow[], count: count ?? 0 };
}

async function fetchInventoryForExport(params: Omit<InventoryQueryParams, "page">) {
  const supabase = createClient();
  let query = supabase
    .from("inventory")
    .select(
      "id,qty_on_hand,qty_reserved,qty_on_order,product_id,warehouse_id,product:products(id,sku,name,unit_cost),warehouse:warehouses(id,name,code)",
    );

  if (params.q.trim()) {
    const q = params.q.trim();
    query = query.or(`products.name.ilike.%${q}%,products.sku.ilike.%${q}%`);
  }

  if (params.warehouse !== "all") query = query.eq("warehouse_id", params.warehouse);

  const { data, error } = await query.order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as InventoryRow[];
}

async function fetchHealthMap(rows: InventoryRow[]) {
  if (rows.length === 0) return {} as Record<string, { health: InventoryHealth; trend: { date: string; level: number }[] }>;

  const supabase = createClient();
  const dateList = lastDates(TREND_DAYS);
  const startDate = dateList[0];

  const healthRows = await Promise.all(
    rows.map(async (row) => {
      const { data, error } = await supabase.rpc("get_inventory_health", {
        p_product_id: row.product_id,
        p_warehouse_id: row.warehouse_id,
      });
      if (error) throw new Error(error.message);
      const first = ((data as InventoryHealth[] | null) ?? [])[0];
      return {
        row,
        health: first ?? {
          days_of_stock_remaining: null,
          stock_status: "healthy",
          quantity_available: Math.max(Number(row.qty_on_hand) - Number(row.qty_reserved), 0),
          reorder_point: 0,
          safety_stock: 0,
          eoq: 0,
          avg_daily_demand: 0,
          recommended_action: "No action needed.",
        },
      };
    }),
  );

  const productIds = Array.from(new Set(rows.map((row) => row.product_id)));
  const warehouseIds = Array.from(new Set(rows.map((row) => row.warehouse_id)));

  const { data: demandRows, error: demandError } = await supabase
    .from("demand_history")
    .select("product_id,warehouse_id,date,net_quantity")
    .in("product_id", productIds)
    .in("warehouse_id", warehouseIds)
    .gte("date", startDate);

  if (demandError) throw new Error(demandError.message);

  const demandByCombo = new Map<string, Record<string, number>>();
  for (const row of (demandRows ?? []) as { product_id: string; warehouse_id: string; date: string; net_quantity: number }[]) {
    const key = keyFor(row.product_id, row.warehouse_id);
    const map = demandByCombo.get(key) ?? {};
    map[row.date] = (map[row.date] ?? 0) + Number(row.net_quantity);
    demandByCombo.set(key, map);
  }

  const result: Record<string, { health: InventoryHealth; trend: { date: string; level: number }[] }> = {};
  for (const item of healthRows) {
    const key = keyFor(item.row.product_id, item.row.warehouse_id);
    const byDate = demandByCombo.get(key) ?? {};
    const daily = dateList.map((d) => byDate[d] ?? 0);
    let running = Number(item.row.qty_on_hand) - daily.reduce((a, b) => a + b, 0);
    const trend = dateList.map((date, index) => {
      running += daily[index];
      return { date, level: Math.max(Number(running.toFixed(3)), 0) };
    });

    result[item.row.id] = { health: item.health, trend };
  }

  return result;
}

async function fetchSummary(params: Omit<InventoryQueryParams, "page">): Promise<InventorySummary> {
  const supabase = createClient();
  let query = supabase
    .from("inventory")
    .select("product_id,warehouse_id,qty_on_hand,qty_reserved,product:products(unit_cost,name,sku)")
    .limit(5000);

  if (params.q.trim()) {
    const q = params.q.trim();
    query = query.or(`products.name.ilike.%${q}%,products.sku.ilike.%${q}%`);
  }

  if (params.warehouse !== "all") query = query.eq("warehouse_id", params.warehouse);

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);

  const inventoryRows = (rows ?? []) as unknown as Array<{
    product_id: string;
    warehouse_id: string;
    qty_on_hand: number;
    qty_reserved: number;
    product?: { unit_cost: number };
  }>;

  if (inventoryRows.length === 0) {
    return { totalSkusTracked: 0, atOrBelowReorderPoint: 0, overstockCount: 0, stockoutRiskValue: 0 };
  }

  const { data: paramsRows, error: paramsError } = await supabase
    .from("inventory_parameters")
    .select("product_id,warehouse_id,calculated_reorder_point,calculated_safety_stock")
    .in("product_id", Array.from(new Set(inventoryRows.map((row) => row.product_id))))
    .in("warehouse_id", Array.from(new Set(inventoryRows.map((row) => row.warehouse_id))));

  if (paramsError) throw new Error(paramsError.message);

  const paramMap = new Map<string, { reorder: number; safety: number }>();
  for (const row of (paramsRows ?? []) as { product_id: string; warehouse_id: string; calculated_reorder_point: number; calculated_safety_stock: number }[]) {
    paramMap.set(keyFor(row.product_id, row.warehouse_id), {
      reorder: Number(row.calculated_reorder_point),
      safety: Number(row.calculated_safety_stock),
    });
  }

  let atOrBelow = 0;
  let overstock = 0;
  let risk = 0;
  for (const row of inventoryRows) {
    const available = Math.max(Number(row.qty_on_hand) - Number(row.qty_reserved), 0);
    const param = paramMap.get(keyFor(row.product_id, row.warehouse_id));
    const reorder = param?.reorder ?? 0;
    const safety = param?.safety ?? 0;

    if (available <= reorder) atOrBelow += 1;
    if (reorder > 0 && available > reorder * 2) overstock += 1;
    if (available <= safety) risk += Number(row.product?.unit_cost ?? 0);
  }

  return {
    totalSkusTracked: inventoryRows.length,
    atOrBelowReorderPoint: atOrBelow,
    overstockCount: overstock,
    stockoutRiskValue: risk,
  };
}

export function InventoryPage() {
  const router = useRouter();
  const profile = useProfile();
  const writable = canWrite(profile.role);
  const canConfigure = profile.role === "admin" || profile.role === "manager";
  const queryClient = useQueryClient();

  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));
  const [warehouse, setWarehouse] = useQueryState("warehouse", parseAsString.withDefault("all"));
  const [status, setStatus] = useQueryState("status", parseAsString.withDefault("all"));
  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1));

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustRow, setAdjustRow] = useState<InventoryRow | null>(null);
  const [newQty, setNewQty] = useState("");
  const [reason, setReason] = useState("");

  const [parametersOpen, setParametersOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState<InventoryRow | null>(null);
  const [serviceLevel, setServiceLevel] = useState("95");
  const [orderingCost, setOrderingCost] = useState("50");
  const [holdingRate, setHoldingRate] = useState("0.25");
  const [windowDays, setWindowDays] = useState("90");

  const { data: warehouses } = useQuery({ queryKey: ["warehouses"], queryFn: fetchWarehouses });

  const params = { q, warehouse, page };
  const { data, isLoading, error } = useQuery({
    queryKey: ["inventory", params],
    queryFn: () => fetchInventory(params),
  });

  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);

  const healthKey = useMemo(
    () => rows.map((row) => `${row.id}:${row.product_id}:${row.warehouse_id}`).join("|"),
    [rows],
  );

  const { data: healthMap, isLoading: isHealthLoading } = useQuery({
    queryKey: ["inventory_health", healthKey],
    queryFn: () => fetchHealthMap(rows),
    enabled: rows.length > 0,
  });

  const { data: summary, isLoading: isSummaryLoading } = useQuery({
    queryKey: ["inventory_summary", q, warehouse],
    queryFn: () => fetchSummary({ q, warehouse }),
  });

  const { data: selectedParams } = useQuery({
    queryKey: ["inventory_parameters", selectedRow?.product_id, selectedRow?.warehouse_id],
    enabled: !!selectedRow,
    queryFn: async () => {
      const supabase = createClient();
      const { data: item, error: itemError } = await supabase
        .from("inventory_parameters")
        .select("service_level_percent,ordering_cost,holding_cost_rate,calculation_window_days")
        .eq("product_id", selectedRow?.product_id ?? "")
        .eq("warehouse_id", selectedRow?.warehouse_id ?? "")
        .maybeSingle();
      if (itemError) throw new Error(itemError.message);
      return item;
    },
  });


  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!selectedParams) return;
    setServiceLevel(String(selectedParams.service_level_percent ?? 95));
    setOrderingCost(String(selectedParams.ordering_cost ?? 50));
    setHoldingRate(String(selectedParams.holding_cost_rate ?? 0.25));
    setWindowDays(String(selectedParams.calculation_window_days ?? 90));
  }, [selectedParams]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const filteredRows = useMemo(() => {
    if (status === "all") return rows;
    return rows.filter((row) => healthMap?.[row.id]?.health.stock_status === status);
  }, [rows, healthMap, status]);

  const handleExport = useCallback(async (rowsOverride?: InventoryRow[]) => {
    const exportRows = rowsOverride ?? (await fetchInventoryForExport({ q, warehouse }));
    const exportHealth = await fetchHealthMap(exportRows);

    const worksheet = buildWorksheet(exportRows, [
      { key: "sku", header: "SKU", type: "string", value: (row: InventoryRow) => row.product?.sku ?? "" },
      { key: "product", header: "Product", type: "string", value: (row: InventoryRow) => row.product?.name ?? "" },
      { key: "warehouse", header: "Warehouse", type: "string", value: (row: InventoryRow) => row.warehouse?.name ?? "" },
      { key: "on_hand", header: "On Hand", type: "number", value: (row: InventoryRow) => row.qty_on_hand },
      { key: "available", header: "Available", type: "number", value: (row: InventoryRow) => exportHealth[row.id]?.health.quantity_available ?? 0 },
      { key: "reorder", header: "Reorder Point", type: "number", value: (row: InventoryRow) => exportHealth[row.id]?.health.reorder_point ?? 0 },
      { key: "days", header: "Days of Stock", type: "number", value: (row: InventoryRow) => exportHealth[row.id]?.health.days_of_stock_remaining ?? "" },
      { key: "status", header: "Stock Status", type: "string", value: (row: InventoryRow) => exportHealth[row.id]?.health.stock_status ?? "healthy" },
    ]);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Inventory");
    addMetadataSheet(workbook, {
      "Export date": formatISODate(new Date()),
      Filters: `search=${q || ""}; warehouse=${warehouse}; status=${status}`,
      "Total rows": exportRows.length,
      User: profile.name,
    });

    downloadWorkbook(workbook, `inventory_export_${formatISODate(new Date())}.xlsx`);
  }, [profile.name, q, status, warehouse]);

  const adjustMutation = useMutation({
    mutationFn: async () => {
      if (!adjustRow) return;
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("adjust_inventory_qty", {
        p_inventory_id: adjustRow.id,
        p_new_qty: Number(newQty),
        p_reason: reason || "manual adjustment",
      });
      if (rpcError) throw new Error(rpcError.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
      await queryClient.invalidateQueries({ queryKey: ["inventory_summary"] });
      await queryClient.invalidateQueries({ queryKey: ["inventory_health"] });
      setAdjustOpen(false);
      setAdjustRow(null);
      setNewQty("");
      setReason("");
    },
  });

  const saveParamsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRow) return;
      const supabase = createClient();
      const { error: upsertError } = await supabase.from("inventory_parameters").upsert({
        product_id: selectedRow.product_id,
        warehouse_id: selectedRow.warehouse_id,
        service_level_percent: Number(serviceLevel),
        ordering_cost: Number(orderingCost),
        holding_cost_rate: Number(holdingRate),
        calculation_window_days: Number(windowDays),
      }, { onConflict: "product_id,warehouse_id" });
      if (upsertError) throw new Error(upsertError.message);

      const { error: calcError } = await supabase.rpc("calculate_safety_stock", {
        p_product_id: selectedRow.product_id,
        p_warehouse_id: selectedRow.warehouse_id,
      });
      if (calcError) throw new Error(calcError.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
      await queryClient.invalidateQueries({ queryKey: ["inventory_summary"] });
      await queryClient.invalidateQueries({ queryKey: ["inventory_health"] });
      await queryClient.invalidateQueries({ queryKey: ["inventory_parameters"] });
    },
  });

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("inventory-optimization")
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["inventory"] });
        void queryClient.invalidateQueries({ queryKey: ["inventory_summary"] });
        void queryClient.invalidateQueries({ queryKey: ["inventory_health"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory_parameters" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["inventory"] });
        void queryClient.invalidateQueries({ queryKey: ["inventory_summary"] });
        void queryClient.invalidateQueries({ queryKey: ["inventory_health"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "demand_history" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["inventory_health"] });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const sorting = useMemo<SortingState>(() => [{ id: "qty_on_hand", desc: true }], []);

  const columns = useMemo<ColumnDef<InventoryRow, unknown>[]>(() => [
    {
      id: "product",
      header: () => "Product",
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <div className="text-sm font-medium">{row.original.product?.name ?? "-"}</div>
          <div className="font-mono text-xs text-muted-foreground">{row.original.product?.sku ?? ""}</div>
        </div>
      ),
    },
    { id: "warehouse", header: () => "Warehouse", cell: ({ row }) => row.original.warehouse?.name ?? "-" },
    { accessorKey: "qty_on_hand", header: () => "On hand", cell: ({ row }) => Number(row.original.qty_on_hand).toFixed(3) },
    {
      id: "status",
      header: () => "Stock status",
      cell: ({ row }) => healthMap?.[row.original.id] ? statusBadge(healthMap[row.original.id].health.stock_status) : <Badge variant="outline">Pending</Badge>,
    },
    {
      id: "reorder_point",
      header: () => "Reorder point",
      cell: ({ row }) => Number(healthMap?.[row.original.id]?.health.reorder_point ?? 0).toFixed(2),
    },
    {
      id: "days_of_stock",
      header: () => "Days of stock",
      cell: ({ row }) => {
        const value = healthMap?.[row.original.id]?.health.days_of_stock_remaining;
        return value === null || value === undefined ? "N/A" : Number(value).toFixed(1);
      },
    },
    {
      id: "trend",
      header: () => "30d trend",
      cell: ({ row }) => {
        const trend = healthMap?.[row.original.id]?.trend ?? [];
        if (!trend.length) return <span className="text-xs text-muted-foreground">No data</span>;
        return (
          <LineChart width={112} height={40} data={trend}>
            <Line dataKey="level" dot={false} stroke="hsl(var(--chart-1))" strokeWidth={1.5} />
          </LineChart>
        );
      },
    },
    {
      id: "quick_action",
      header: () => "Quick action",
      cell: ({ row }) => {
        const health = healthMap?.[row.original.id]?.health;
        if (!writable || !health || health.quantity_available > health.reorder_point) {
          return <span className="text-xs text-muted-foreground">-</span>;
        }
        return (
          <div onClick={(event) => event.stopPropagation()}>
            <Button size="sm" onClick={() => {
              const params = new URLSearchParams({ prefillProductId: row.original.product_id, prefillWarehouseId: row.original.warehouse_id });
              if (health.eoq > 0) params.set("prefillQty", Math.ceil(health.eoq).toString());
              router.push(`/purchase-orders?${params.toString()}`);
            }}>Reorder</Button>
          </div>
        );
      },
    },
    {
      id: "actions",
      header: () => "",
      enableSorting: false,
      cell: ({ row }) => (
        <div onClick={(event) => event.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent">
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void handleExport([row.original])}>Export row</DropdownMenuItem>
              {writable ? (
                <DropdownMenuItem onClick={() => {
                  setAdjustRow(row.original);
                  setNewQty(String(row.original.qty_on_hand));
                  setReason("");
                  setAdjustOpen(true);
                }}>Adjust</DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ], [handleExport, healthMap, router, writable]);

  const pageCount = Math.ceil((data?.count ?? 0) / PAGE_SIZE) || 1;
  const selectedHealth = selectedRow ? healthMap?.[selectedRow.id]?.health : null;
  const coverage = selectedHealth?.reorder_point ? Math.min((selectedHealth.quantity_available / selectedHealth.reorder_point) * 100, 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Inventory" subtitle="Calculated stock health with reorder recommendations." />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border bg-card p-4"><div className="text-xs uppercase text-muted-foreground">Total SKUs tracked</div><div className="mt-2 text-2xl font-semibold">{isSummaryLoading ? "-" : summary?.totalSkusTracked ?? 0}</div></div>
        <div className="rounded-lg border bg-card p-4"><div className="flex items-center justify-between text-xs uppercase text-muted-foreground"><span>At/below reorder</span>{(summary?.atOrBelowReorderPoint ?? 0) > 0 ? <Badge variant="destructive">{summary?.atOrBelowReorderPoint ?? 0}</Badge> : null}</div><div className="mt-2 text-2xl font-semibold">{isSummaryLoading ? "-" : summary?.atOrBelowReorderPoint ?? 0}</div></div>
        <div className="rounded-lg border bg-card p-4"><div className="text-xs uppercase text-muted-foreground">Overstock SKUs</div><div className="mt-2 text-2xl font-semibold">{isSummaryLoading ? "-" : summary?.overstockCount ?? 0}</div></div>
        <div className="rounded-lg border bg-card p-4"><div className="text-xs uppercase text-muted-foreground">Stockout risk value</div><div className="mt-2 text-2xl font-semibold">{isSummaryLoading ? "-" : `$${Number(summary?.stockoutRiskValue ?? 0).toFixed(2)}`}</div></div>
      </div>

      <FilterBar>
        <div className="flex flex-1 items-center gap-2"><Input placeholder="Search by product name or SKU..." value={q} onChange={(event) => { setQ(event.target.value); setPage(1); }} /></div>
        <Select value={warehouse} onValueChange={(value) => { setWarehouse(value); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-56"><SelectValue placeholder="Warehouse">{(() => {
            if (!warehouse || warehouse === "all") return "All warehouses";
            const selected = (warehouses ?? []).find((item) => item.id === warehouse);
            return selected?.name ?? String(warehouse);
          })()}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="all">All warehouses</SelectItem>{(warehouses ?? []).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="stockout">Stockout</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="healthy">Healthy</SelectItem>
            <SelectItem value="overstock">Overstock</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      {error ? <div className="rounded-md border p-4 text-sm text-destructive">{(error as Error).message}</div> : null}

      <DataTable
        columns={columns}
        data={filteredRows}
        isLoading={isLoading || isHealthLoading}
        sorting={sorting}
        toolbar={<Button variant="secondary" onClick={() => void handleExport()}>Export to Excel</Button>}
        onSortingChange={() => {}}
        pageIndex={Math.max(page - 1, 0)}
        pageCount={pageCount}
        onPageChange={(index) => setPage(index + 1)}
        onRowClick={(row) => { setSelectedRow(row); setParametersOpen(true); }}
      />

      <Dialog open={adjustOpen} onOpenChange={(open) => { setAdjustOpen(open); if (!open) setAdjustRow(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Adjust quantity on hand</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">{adjustRow?.product?.name} · {adjustRow?.warehouse?.name}</div>
            <FormField label="New quantity"><Input type="number" step="0.001" value={newQty} onChange={(event) => setNewQty(event.target.value)} /></FormField>
            <FormField label="Reason"><Input value={reason} onChange={(event) => setReason(event.target.value)} /></FormField>
            {adjustMutation.error ? <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{(adjustMutation.error as Error).message}</div> : null}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAdjustOpen(false)}>Cancel</Button>
            <Button onClick={() => adjustMutation.mutate()} disabled={adjustMutation.isPending || !newQty}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SlideOverPanel
        open={parametersOpen}
        onOpenChange={setParametersOpen}
        title={selectedRow ? `${selectedRow.product?.name ?? "Product"} - ${selectedRow.warehouse?.name ?? "Warehouse"}` : "Inventory parameters"}
        footer={<div className="flex gap-2">{canConfigure ? <Button onClick={() => saveParamsMutation.mutate()} disabled={saveParamsMutation.isPending}>Save parameters</Button> : null}<Button variant="secondary" onClick={() => setParametersOpen(false)}>Close</Button></div>}
      >
        {selectedRow ? (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">Status: {selectedHealth ? selectedHealth.stock_status : "pending"}</div>
            <div>
              <div className="mb-2 text-xs uppercase text-muted-foreground">Coverage vs reorder point</div>
              <Progress value={coverage} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Service level (%)"><Input type="number" min={1} max={99.99} value={serviceLevel} onChange={(event) => setServiceLevel(event.target.value)} disabled={!canConfigure} /></FormField>
              <FormField label="Ordering cost"><Input type="number" min={0} step="0.01" value={orderingCost} onChange={(event) => setOrderingCost(event.target.value)} disabled={!canConfigure} /></FormField>
              <FormField label="Holding cost rate"><Input type="number" min={0.01} max={1} step="0.01" value={holdingRate} onChange={(event) => setHoldingRate(event.target.value)} disabled={!canConfigure} /></FormField>
              <FormField label="Calculation window (days)"><Input type="number" min={7} max={365} value={windowDays} onChange={(event) => setWindowDays(event.target.value)} disabled={!canConfigure} /></FormField>
            </div>
            {selectedHealth ? <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">Recommended action: {selectedHealth.recommended_action}</div> : null}
            {saveParamsMutation.error ? <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{(saveParamsMutation.error as Error).message}</div> : null}
          </div>
        ) : null}
      </SlideOverPanel>
    </div>
  );
}




