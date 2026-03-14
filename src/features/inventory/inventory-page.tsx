"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef, type SortingState } from "@tanstack/react-table";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";
import { useCallback, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { MoreHorizontal } from "lucide-react";

import { useProfile } from "@/components/app/profile-context";
import { DataTable } from "@/components/shared/data-table";
import { FilterBar } from "@/components/shared/filter-bar";
import { FormField } from "@/components/shared/form-field";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
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
const LOW_STOCK_THRESHOLD = 10;

type InventoryRow = {
  id: string;
  qty_on_hand: number;
  qty_reserved: number;
  qty_on_order: number;
  product_id: string;
  warehouse_id: string;
  product?: { id: string; sku: string; name: string };
  warehouse?: { id: string; name: string; code: string };
};

type WarehouseOption = { id: string; name: string; code: string };

type InventoryQueryParams = {
  q: string;
  warehouse: string;
  status: string;
  page: number;
};

function stockStatus(qtyOnHand: number) {
  if (qtyOnHand <= 0) return { label: "Out of Stock", variant: "destructive" as const };
  if (qtyOnHand < LOW_STOCK_THRESHOLD) return { label: "Low Stock", variant: "outline" as const };
  return { label: "In Stock", variant: "secondary" as const };
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
      "id,qty_on_hand,qty_reserved,qty_on_order,product_id,warehouse_id,product:products(id,sku,name),warehouse:warehouses(id,name,code)",
      { count: "exact" },
    );

  if (params.q.trim()) {
    const q = params.q.trim();
    query = query.or(`products.name.ilike.%${q}%,products.sku.ilike.%${q}%`);
  }

  if (params.warehouse !== "all") query = query.eq("warehouse_id", params.warehouse);

  if (params.status === "out") {
    query = query.eq("qty_on_hand", 0);
  } else if (params.status === "low") {
    query = query.gt("qty_on_hand", 0).lt("qty_on_hand", LOW_STOCK_THRESHOLD);
  } else if (params.status === "in") {
    query = query.gte("qty_on_hand", LOW_STOCK_THRESHOLD);
  }

  const from = (params.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, count, error } = await query.order("qty_on_hand", { ascending: false }).range(from, to);
  if (error) throw new Error(error.message);

  return { rows: (data ?? []) as unknown as InventoryRow[], count: count ?? 0 };
}

async function fetchInventoryForExport(params: Omit<InventoryQueryParams, "page">) {
  const supabase = createClient();

  let query = supabase
    .from("inventory")
    .select(
      "id,qty_on_hand,qty_reserved,qty_on_order,product_id,warehouse_id,product:products(id,sku,name),warehouse:warehouses(id,name,code)",
    );

  if (params.q.trim()) {
    const q = params.q.trim();
    query = query.or(`products.name.ilike.%${q}%,products.sku.ilike.%${q}%`);
  }

  if (params.warehouse !== "all") query = query.eq("warehouse_id", params.warehouse);

  if (params.status === "out") {
    query = query.eq("qty_on_hand", 0);
  } else if (params.status === "low") {
    query = query.gt("qty_on_hand", 0).lt("qty_on_hand", LOW_STOCK_THRESHOLD);
  } else if (params.status === "in") {
    query = query.gte("qty_on_hand", LOW_STOCK_THRESHOLD);
  }

  const { data, error } = await query.order("qty_on_hand", { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []) as unknown as InventoryRow[];
}

export function InventoryPage() {
  const profile = useProfile();
  const writable = canWrite(profile.role);

  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));
  const [warehouse, setWarehouse] = useQueryState("warehouse", parseAsString.withDefault("all"));
  const [status, setStatus] = useQueryState("status", parseAsString.withDefault("all"));
  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1));

  const { data: warehouses } = useQuery({ queryKey: ["warehouses"], queryFn: fetchWarehouses });

  const params = { q, warehouse, status, page };

  const { data, isLoading, error } = useQuery({
    queryKey: ["inventory", params],
    queryFn: () => fetchInventory(params),
  });

  const queryClient = useQueryClient();

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustRow, setAdjustRow] = useState<InventoryRow | null>(null);
  const [newQty, setNewQty] = useState("");
  const [reason, setReason] = useState("");

  const handleExport = useCallback(async (rowsOverride?: InventoryRow[]) => {
    const rows = rowsOverride ?? (await fetchInventoryForExport({ q, warehouse, status }));

    const worksheet = buildWorksheet(rows, [
      { key: "sku", header: "SKU", type: "string", value: (row: InventoryRow) => row.product?.sku ?? "" },
      { key: "product", header: "Product", type: "string", value: (row: InventoryRow) => row.product?.name ?? "" },
      { key: "warehouse", header: "Warehouse", type: "string", value: (row: InventoryRow) => row.warehouse?.name ?? "" },
      {
        key: "warehouse_code",
        header: "Warehouse Code",
        type: "string",
        value: (row: InventoryRow) => row.warehouse?.code ?? "",
      },
      { key: "qty_on_hand", header: "On Hand", type: "number", value: (row: InventoryRow) => row.qty_on_hand },
      { key: "qty_reserved", header: "Reserved", type: "number", value: (row: InventoryRow) => row.qty_reserved },
      { key: "qty_on_order", header: "On Order", type: "number", value: (row: InventoryRow) => row.qty_on_order },
    ]);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Inventory");
    addMetadataSheet(workbook, {
      "Export date": formatISODate(new Date()),
      Filters: `search=${q || ""}; warehouse=${warehouse}; status=${status}`,
      "Total rows": rows.length,
      User: profile.name,
    });

    downloadWorkbook(workbook, `inventory_export_${formatISODate(new Date())}.xlsx`);
  }, [q, warehouse, status, profile.name]);

  const adjustMutation = useMutation({
    mutationFn: async () => {
      if (!adjustRow) return;
      const supabase = createClient();
      const qty = Number(newQty);
      const { error } = await supabase.rpc("adjust_inventory_qty", {
        p_inventory_id: adjustRow.id,
        p_new_qty: qty,
        p_reason: reason || "manual adjustment",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
      setAdjustOpen(false);
      setAdjustRow(null);
      setNewQty("");
      setReason("");
    },
  });

  const sorting = useMemo<SortingState>(() => [{ id: "qty_on_hand", desc: true }], []);

  const columns = useMemo<ColumnDef<InventoryRow, unknown>[]>(() => {
    return [
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
      {
        id: "warehouse",
        header: () => "Warehouse",
        cell: ({ row }) => row.original.warehouse?.name ?? "-",
      },
      {
        accessorKey: "qty_on_hand",
        header: () => "On hand",
        cell: ({ row }) => Number(row.original.qty_on_hand).toFixed(3),
      },
      {
        accessorKey: "qty_reserved",
        header: () => "Reserved",
        cell: ({ row }) => Number(row.original.qty_reserved).toFixed(3),
      },
      {
        accessorKey: "qty_on_order",
        header: () => "On order",
        cell: ({ row }) => Number(row.original.qty_on_order).toFixed(3),
      },
      {
        id: "available",
        header: () => "Available",
        cell: ({ row }) =>
          (Number(row.original.qty_on_hand) - Number(row.original.qty_reserved)).toFixed(3),
      },
      {
        id: "status",
        header: () => "Status",
        cell: ({ row }) => {
          const stock = stockStatus(Number(row.original.qty_on_hand));
          return <StatusBadge label={stock.label} variant={stock.variant} />;
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
                <DropdownMenuItem onClick={() => void handleExport([row.original])}>
                  Export row
                </DropdownMenuItem>
                {writable ? (
                  <DropdownMenuItem
                    onClick={() => {
                      setAdjustRow(row.original);
                      setNewQty(String(row.original.qty_on_hand));
                      setReason("");
                      setAdjustOpen(true);
                    }}
                  >
                    Adjust
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ];
  }, [writable, handleExport]);

  const pageCount = Math.ceil((data?.count ?? 0) / PAGE_SIZE) || 1;

  return (
    <div className="space-y-6">
      <PageHeader title="Inventory" subtitle="View stock levels across products and warehouses." />

      <FilterBar>
        <div className="flex flex-1 items-center gap-2">
          <Input
            placeholder="Search by product name or SKU..."
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
        </div>

        <Select
          value={warehouse}
          onValueChange={(value) => {
            setWarehouse(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue placeholder="Warehouse">
              {(value) => {
                if (!value || value === "all") return "All warehouses";
                const selected = (warehouses ?? []).find((item) => item.id === value);
                return selected?.name ?? String(value);
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All warehouses</SelectItem>
            {(warehouses ?? []).map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Status">
              {(value) => {
                if (!value || value === "all") return "All";
                if (value === "in") return "In stock";
                if (value === "low") return "Low stock";
                if (value === "out") return "Out of stock";
                return String(value);
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="in">In stock</SelectItem>
            <SelectItem value="low">Low stock</SelectItem>
            <SelectItem value="out">Out of stock</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      {error ? <div className="rounded-md border p-4 text-sm text-destructive">{(error as Error).message}</div> : null}

      <DataTable
        columns={columns}
        data={data?.rows ?? []}
        isLoading={isLoading}
        sorting={sorting}
        toolbar={
          <Button variant="secondary" onClick={() => void handleExport()}>
            Export to Excel
          </Button>
        }
        onSortingChange={() => {}}
        pageIndex={Math.max(page - 1, 0)}
        pageCount={pageCount}
        onPageChange={(index) => setPage(index + 1)}
      />

      <Dialog
        open={adjustOpen}
        onOpenChange={(open) => {
          setAdjustOpen(open);
          if (!open) setAdjustRow(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust quantity on hand</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              {adjustRow?.product?.name} · {adjustRow?.warehouse?.name}
            </div>

            <FormField label="New quantity">
              <Input type="number" step="0.001" value={newQty} onChange={(event) => setNewQty(event.target.value)} />
            </FormField>

            <FormField label="Reason">
              <Input value={reason} onChange={(event) => setReason(event.target.value)} />
            </FormField>

            {adjustMutation.error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {(adjustMutation.error as Error).message}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setAdjustOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => adjustMutation.mutate()} disabled={adjustMutation.isPending || !newQty}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}







