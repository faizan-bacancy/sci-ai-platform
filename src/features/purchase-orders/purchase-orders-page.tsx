"use client";

/* eslint-disable react-hooks/incompatible-library */

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";
import { useFieldArray, useForm } from "react-hook-form";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useProfile } from "@/components/app/profile-context";
import { DataTable } from "@/components/shared/data-table";
import { FilterBar } from "@/components/shared/filter-bar";
import { FormField } from "@/components/shared/form-field";
import { PageHeader } from "@/components/shared/page-header";
import { SlideOverPanel } from "@/components/shared/slide-over-panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { canWrite } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/browser";

import {
  purchaseOrderCreateSchema,
  type PurchaseOrderCreateInput,
  type PurchaseOrderRow,
} from "./schema";

const PAGE_SIZE = 25;

type PurchaseOrderQueryParams = {
  q: string;
  supplier: string;
  status: string;
  from: string;
  to: string;
  page: number;
};

function statusBadge(status: string) {
  switch (status) {
    case "draft":
      return { label: "Draft", variant: "outline" as const };
    case "sent":
      return { label: "Sent", variant: "secondary" as const };
    case "confirmed":
      return { label: "Confirmed", variant: "secondary" as const };
    case "partially_received":
      return { label: "Partially received", variant: "secondary" as const };
    case "received":
      return { label: "Received", variant: "secondary" as const };
    case "cancelled":
      return { label: "Cancelled", variant: "destructive" as const };
    default:
      return { label: status, variant: "secondary" as const };
  }
}

async function fetchPurchaseOrders(params: PurchaseOrderQueryParams) {
  const supabase = createClient();

  let query = supabase
    .from("purchase_orders")
    .select(
      "id,po_number,status,order_date,expected_delivery_date,total_amount,currency,supplier_id,warehouse_id,supplier:suppliers(company_name),purchase_order_lines(id)",
      { count: "exact" },
    );

  if (params.q.trim()) {
    const q = params.q.trim();
    query = query.ilike("po_number", `%${q}%`);
  }

  if (params.supplier !== "all") {
    query = query.eq("supplier_id", params.supplier);
  }

  if (params.status !== "all") {
    query = query.eq("status", params.status);
  }

  if (params.from) query = query.gte("order_date", params.from);
  if (params.to) query = query.lte("order_date", params.to);

  const from = (params.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw new Error(error.message);

  return { rows: (data ?? []) as unknown as PurchaseOrderRow[], count: count ?? 0 };
}

async function fetchSuppliersOptions() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .select("id,company_name")
    .order("company_name", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; company_name: string }[];
}

async function fetchWarehousesOptions() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("warehouses")
    .select("id,name,code")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; name: string; code: string }[];
}

async function fetchProductsOptions() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id,name,sku,unit_cost")
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as {
    id: string;
    name: string;
    sku: string;
    unit_cost: number;
  }[];
}

export function PurchaseOrdersPage() {
  const profile = useProfile();
  const writable = canWrite(profile.role);
  const router = useRouter();

  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));
  const [supplier, setSupplier] = useQueryState(
    "supplier",
    parseAsString.withDefault("all"),
  );
  const [status, setStatus] = useQueryState(
    "status",
    parseAsString.withDefault("all"),
  );
  const [fromDate, setFromDate] = useQueryState(
    "from",
    parseAsString.withDefault(""),
  );
  const [toDate, setToDate] = useQueryState("to", parseAsString.withDefault(""));
  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1));

  const params = { q, supplier, status, from: fromDate, to: toDate, page };

  const { data, isLoading, error } = useQuery({
    queryKey: ["purchase_orders", params],
    queryFn: () => fetchPurchaseOrders(params),
  });

  const { data: supplierOptions } = useQuery({
    queryKey: ["suppliers_options"],
    queryFn: fetchSuppliersOptions,
  });

  const { data: warehouseOptions } = useQuery({
    queryKey: ["warehouses_options"],
    queryFn: fetchWarehousesOptions,
  });

  const { data: productOptions } = useQuery({
    queryKey: ["products_po_options"],
    queryFn: fetchProductsOptions,
  });

  const queryClient = useQueryClient();

  const [panelOpen, setPanelOpen] = useState(false);

  const form = useForm<PurchaseOrderCreateInput>({
    resolver: zodResolver(purchaseOrderCreateSchema),
    defaultValues: {
      supplier_id: "",
      warehouse_id: "",
      order_date: new Date().toISOString().slice(0, 10),
      expected_delivery_date: "",
      currency: "",
      notes: "",
      lines: [{ product_id: "", qty_ordered: 1, unit_cost: 0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lines",
  });

  const createMutation = useMutation({
    mutationFn: async (values: PurchaseOrderCreateInput) => {
      const supabase = createClient();
      const parsed = purchaseOrderCreateSchema.parse(values);
      const header = {
        supplier_id: parsed.supplier_id,
        warehouse_id: parsed.warehouse_id,
        status: "draft",
        order_date: parsed.order_date || null,
        expected_delivery_date: parsed.expected_delivery_date || null,
        currency: parsed.currency ? values.currency : null,
        notes: parsed.notes ? values.notes : null,
      };

      const { data: po, error: poError } = await supabase
        .from("purchase_orders")
        .insert(header)
        .select("id")
        .single();
      if (poError) throw new Error(poError.message);

      const lines = parsed.lines.map((l) => ({
        purchase_order_id: po.id,
        product_id: l.product_id,
        qty_ordered: l.qty_ordered,
        unit_cost: l.unit_cost,
      }));

      const { error: linesError } = await supabase
        .from("purchase_order_lines")
        .insert(lines);
      if (linesError) throw new Error(linesError.message);

      return po.id as string;
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ["purchase_orders"] });
      setPanelOpen(false);
      form.reset();
      router.push(`/purchase-orders/${id}`);
    },
  });

  const sorting = useMemo<SortingState>(
    () => [{ id: "created_at", desc: true }],
    [],
  );

  const columns = useMemo<ColumnDef<PurchaseOrderRow, unknown>[]>(() => {
    return [
      {
        accessorKey: "po_number",
        header: () => "PO #",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.po_number}</span>
        ),
      },
      {
        id: "supplier",
        header: () => "Supplier",
        cell: ({ row }) => row.original.supplier?.company_name ?? "—",
      },
      {
        accessorKey: "status",
        header: () => "Status",
        cell: ({ row }) => {
          const s = statusBadge(row.original.status);
          return <StatusBadge label={s.label} variant={s.variant} />;
        },
      },
      {
        accessorKey: "order_date",
        header: () => "Order date",
        cell: ({ row }) => row.original.order_date ?? "—",
      },
      {
        accessorKey: "expected_delivery_date",
        header: () => "Expected",
        cell: ({ row }) => row.original.expected_delivery_date ?? "—",
      },
      {
        id: "lines",
        header: () => "Lines",
        cell: ({ row }) => (row.original.purchase_order_lines ?? []).length,
      },
      {
        accessorKey: "total_amount",
        header: () => "Total",
        cell: ({ row }) => {
          const currency = row.original.currency ?? "";
          return `${currency ? currency + " " : ""}${Number(row.original.total_amount).toFixed(2)}`;
        },
      },
    ];
  }, []);

  const pageCount = Math.ceil((data?.count ?? 0) / PAGE_SIZE) || 1;

  const defaultWarehouseId = useMemo(() => {
    const found = (warehouseOptions ?? []).find((w) => w.code === "DEFAULT");
    return found?.id ?? (warehouseOptions?.[0]?.id ?? "");
  }, [warehouseOptions]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase Orders"
        subtitle="Create and track supplier purchase orders."
        actions={
          writable ? (
            <Button
              onClick={() => {
                if (!form.getValues("warehouse_id") && defaultWarehouseId) {
                  form.setValue("warehouse_id", defaultWarehouseId);
                }
                setPanelOpen(true);
              }}
            >
              New PO
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <div className="flex flex-1 items-center gap-2">
          <Input
            placeholder="Search by PO number…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          value={supplier}
          onValueChange={(v) => {
            setSupplier(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-64">
  <SelectValue placeholder="Supplier">
    {(() => {
      if (!supplier || supplier === "all") return "All suppliers";
      const selected = (supplierOptions ?? []).find((s) => s.id === supplier);
      return selected?.company_name ?? "All suppliers";
    })()}
  </SelectValue>
</SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All suppliers</SelectItem>
            {(supplierOptions ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.company_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="received">Received</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={fromDate}
          onChange={(e) => {
            setFromDate(e.target.value);
            setPage(1);
          }}
          className="w-full sm:w-44"
        />
        <Input
          type="date"
          value={toDate}
          onChange={(e) => {
            setToDate(e.target.value);
            setPage(1);
          }}
          className="w-full sm:w-44"
        />
      </FilterBar>

      {error ? (
        <div className="rounded-md border p-4 text-sm text-destructive">
          {(error as Error).message}
        </div>
      ) : null}

      <DataTable
        columns={columns}
        data={data?.rows ?? []}
        isLoading={isLoading}
        sorting={sorting}
        onSortingChange={() => {}}
        pageIndex={Math.max(page - 1, 0)}
        pageCount={pageCount}
        onPageChange={(idx) => setPage(idx + 1)}
        onRowClick={(row) => router.push(`/purchase-orders/${row.id}`)}
      />

      <SlideOverPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        title="New purchase order"
      >
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              label="Supplier"
              error={form.formState.errors.supplier_id?.message}
            >
              <Select
                value={form.watch("supplier_id")}
                onValueChange={(v) => form.setValue("supplier_id", v ?? "")}
              >
                <SelectTrigger>
  <SelectValue placeholder="Select supplier">
    {(() => {
      const value = form.watch("supplier_id");
      if (!value) return "Select supplier";
      const selected = (supplierOptions ?? []).find((s) => s.id === value);
      return selected?.company_name ?? "Select supplier";
    })()}
  </SelectValue>
</SelectTrigger>
                <SelectContent>
                  {(supplierOptions ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.company_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField
              label="Warehouse"
              error={form.formState.errors.warehouse_id?.message}
            >
              <Select
                value={form.watch("warehouse_id")}
                onValueChange={(v) => form.setValue("warehouse_id", v ?? "")}
              >
                <SelectTrigger>
  <SelectValue placeholder="Select warehouse">
    {(() => {
      const value = form.watch("warehouse_id");
      if (!value) return "Select warehouse";
      const selected = (warehouseOptions ?? []).find((w) => w.id === value);
      return selected?.name ?? "Select warehouse";
    })()}
  </SelectValue>
</SelectTrigger>
                <SelectContent>
                  {(warehouseOptions ?? []).map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Order date">
              <Input
                type="date"
                value={form.watch("order_date") ?? ""}
                onChange={(e) => form.setValue("order_date", e.target.value)}
              />
            </FormField>
            <FormField label="Expected delivery">
              <Input
                type="date"
                value={form.watch("expected_delivery_date") ?? ""}
                onChange={(e) =>
                  form.setValue("expected_delivery_date", e.target.value)
                }
              />
            </FormField>
          </div>

          <FormField label="Currency">
            <Input {...form.register("currency")} placeholder="e.g. USD" />
          </FormField>

          <FormField label="Notes">
            <Textarea rows={3} {...form.register("notes")} />
          </FormField>

          <div className="space-y-2">
            <div className="text-sm font-medium">Line items</div>
            {fields.map((field, index) => {
              const productIdPath = `lines.${index}.product_id` as const;
              const qtyPath = `lines.${index}.qty_ordered` as const;
              const unitCostPath = `lines.${index}.unit_cost` as const;

              const selectedProductId = form.watch(productIdPath);

              return (
                <div key={field.id} className="space-y-3 rounded-md border p-3">
                  <div className="space-y-3">
  <FormField
    label="Product"
    error={form.formState.errors.lines?.[index]?.product_id?.message}
  >
    <Select
      value={selectedProductId}
      onValueChange={(v) => {
        form.setValue(productIdPath, v ?? "");
        const opt = (productOptions ?? []).find((p) => p.id === (v ?? ""));
        if (opt) {
          const current = form.getValues(unitCostPath);
          if (!current || Number(current) === 0) {
            form.setValue(unitCostPath, opt.unit_cost);
          }
        }
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select product">
          {(() => {
            if (!selectedProductId) return "Select product";
            const selected = (productOptions ?? []).find(
              (p) => p.id === selectedProductId,
            );
            return selected ? `${selected.name} (${selected.sku})` : "Select product";
          })()}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {(productOptions ?? []).map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name} ({p.sku})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </FormField>

  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <FormField
      label="Qty"
      error={form.formState.errors.lines?.[index]?.qty_ordered?.message}
    >
      <Input type="number" step="0.001" {...form.register(qtyPath)} />
    </FormField>

    <FormField
      label="Unit cost"
      error={form.formState.errors.lines?.[index]?.unit_cost?.message}
    >
      <Input type="number" step="0.01" {...form.register(unitCostPath)} />
    </FormField>
  </div>
</div>
<div className="flex justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => remove(index)}
                      disabled={fields.length === 1}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              );
            })}

            <Button
              type="button"
              variant="secondary"
              onClick={() => append({ product_id: "", qty_ordered: 1, unit_cost: 0 })}
            >
              Add line
            </Button>
          </div>

          {createMutation.error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {(createMutation.error as Error).message}
            </div>
          ) : null}

          <div className="flex gap-2">
            <Button type="submit" disabled={createMutation.isPending}>
              Create PO
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPanelOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </SlideOverPanel>
    </div>
  );
}




