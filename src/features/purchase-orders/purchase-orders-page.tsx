"use client";

/* eslint-disable react-hooks/incompatible-library */

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";
import { useFieldArray, useForm } from "react-hook-form";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { MoreHorizontal } from "lucide-react";

import { useProfile } from "@/components/app/profile-context";
import { DataTable } from "@/components/shared/data-table";
import { FilterBar } from "@/components/shared/filter-bar";
import { FormField } from "@/components/shared/form-field";
import { DatePicker } from "@/components/shared/date-picker";
import { PageHeader } from "@/components/shared/page-header";
import { SlideOverPanel } from "@/components/shared/slide-over-panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { addMetadataSheet, buildWorksheet, downloadWorkbook, formatISODate } from "@/lib/excel";
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

  if (params.supplier !== "all") query = query.eq("supplier_id", params.supplier);
  if (params.status !== "all") query = query.eq("status", params.status);
  if (params.from) query = query.gte("order_date", params.from);
  if (params.to) query = query.lte("order_date", params.to);

  const from = (params.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, count, error } = await query.order("created_at", { ascending: false }).range(from, to);
  if (error) throw new Error(error.message);

  return { rows: (data ?? []) as unknown as PurchaseOrderRow[], count: count ?? 0 };
}

async function fetchPurchaseOrdersForExport(params: Omit<PurchaseOrderQueryParams, "page">) {
  const supabase = createClient();

  let query = supabase
    .from("purchase_orders")
    .select(
      "id,po_number,status,order_date,expected_delivery_date,total_amount,currency,supplier_id,warehouse_id,supplier:suppliers(company_name),purchase_order_lines(id)",
    );

  if (params.q.trim()) {
    const q = params.q.trim();
    query = query.ilike("po_number", `%${q}%`);
  }

  if (params.supplier !== "all") query = query.eq("supplier_id", params.supplier);
  if (params.status !== "all") query = query.eq("status", params.status);
  if (params.from) query = query.gte("order_date", params.from);
  if (params.to) query = query.lte("order_date", params.to);

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []) as unknown as PurchaseOrderRow[];
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
  const { data, error } = await supabase.from("warehouses").select("id,name,code").order("name", { ascending: true });
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
  return (data ?? []) as { id: string; name: string; sku: string; unit_cost: number }[];
}

export function PurchaseOrdersPage() {
  const profile = useProfile();
  const writable = canWrite(profile.role);
  const router = useRouter();

  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));
  const [supplier, setSupplier] = useQueryState("supplier", parseAsString.withDefault("all"));
  const [status, setStatus] = useQueryState("status", parseAsString.withDefault("all"));
  const [fromDate, setFromDate] = useQueryState("from", parseAsString.withDefault(""));
  const [toDate, setToDate] = useQueryState("to", parseAsString.withDefault(""));
  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1));

  const params = { q, supplier, status, from: fromDate, to: toDate, page };
  const exportParams = { q, supplier, status, from: fromDate, to: toDate };

  const { data, isLoading, error } = useQuery({
    queryKey: ["purchase_orders", params],
    queryFn: () => fetchPurchaseOrders(params),
  });

  const { data: supplierOptions } = useQuery({ queryKey: ["suppliers_options"], queryFn: fetchSuppliersOptions });
  const { data: warehouseOptions } = useQuery({ queryKey: ["warehouses_options"], queryFn: fetchWarehousesOptions });
  const { data: productOptions } = useQuery({ queryKey: ["products_po_options"], queryFn: fetchProductsOptions });

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

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });

  async function handleExport(rowsOverride?: PurchaseOrderRow[]) {
    const rows = rowsOverride ?? (await fetchPurchaseOrdersForExport(exportParams));

    const worksheet = buildWorksheet(rows, [
      { key: "po_number", header: "PO #", type: "string", value: (row: PurchaseOrderRow) => row.po_number },
      {
        key: "supplier",
        header: "Supplier",
        type: "string",
        value: (row: PurchaseOrderRow) => row.supplier?.company_name ?? "",
      },
      { key: "status", header: "Status", type: "string", value: (row: PurchaseOrderRow) => row.status },
      { key: "order_date", header: "Order Date", type: "date", value: (row: PurchaseOrderRow) => row.order_date ?? "" },
      {
        key: "expected_delivery_date",
        header: "Expected Delivery",
        type: "date",
        value: (row: PurchaseOrderRow) => row.expected_delivery_date ?? "",
      },
      {
        key: "lines",
        header: "Lines",
        type: "number",
        value: (row: PurchaseOrderRow) => (row.purchase_order_lines ?? []).length,
      },
      {
        key: "total_amount",
        header: "Total Amount",
        type: "currency",
        value: (row: PurchaseOrderRow) => row.total_amount,
      },
    ]);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Purchase Orders");
    addMetadataSheet(workbook, {
      "Export date": formatISODate(new Date()),
      Filters: `search=${q || ""}; supplier=${supplier}; status=${status}; from=${fromDate || ""}; to=${toDate || ""}`,
      "Total rows": rows.length,
      User: profile.name,
    });

    downloadWorkbook(workbook, `purchase_orders_export_${formatISODate(new Date())}.xlsx`);
  }

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

      const lines = parsed.lines.map((line) => ({
        purchase_order_id: po.id,
        product_id: line.product_id,
        qty_ordered: line.qty_ordered,
        unit_cost: line.unit_cost,
      }));

      const { error: linesError } = await supabase.from("purchase_order_lines").insert(lines);
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

  const sorting = useMemo<SortingState>(() => [{ id: "created_at", desc: true }], []);

  const columns = useMemo<ColumnDef<PurchaseOrderRow, unknown>[]>(() => {
    return [
      {
        accessorKey: "po_number",
        header: () => "PO #",
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.po_number}</span>,
      },
      {
        id: "supplier",
        header: () => "Supplier",
        cell: ({ row }) => row.original.supplier?.company_name ?? "-",
      },
      {
        accessorKey: "status",
        header: () => "Status",
        cell: ({ row }) => {
          const badge = statusBadge(row.original.status);
          return <StatusBadge label={badge.label} variant={badge.variant} />;
        },
      },
      {
        accessorKey: "order_date",
        header: () => "Order date",
        cell: ({ row }) => row.original.order_date ?? "-",
      },
      {
        accessorKey: "expected_delivery_date",
        header: () => "Expected",
        cell: ({ row }) => row.original.expected_delivery_date ?? "-",
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
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ];
  }, []);

  const pageCount = Math.ceil((data?.count ?? 0) / PAGE_SIZE) || 1;

  const defaultWarehouseId = useMemo(() => {
    const found = (warehouseOptions ?? []).find((warehouseItem) => warehouseItem.code === "DEFAULT");
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
            placeholder="Search by PO number..."
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
        </div>

        <Select
          value={supplier}
          onValueChange={(value) => {
            setSupplier(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue placeholder="Supplier">
              {(() => {
                if (!supplier || supplier === "all") return "All suppliers";
                const selected = (supplierOptions ?? []).find((option) => option.id === supplier);
                return selected?.company_name ?? "All suppliers";
              })()}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All suppliers</SelectItem>
            {(supplierOptions ?? []).map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.company_name}
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

        <DatePicker
          value={fromDate}
          onChange={(value) => {
            setFromDate(value);
            setPage(1);
          }}
          placeholder="From date"
          className="w-full sm:w-44"
        />
        <DatePicker
          value={toDate}
          onChange={(value) => {
            setToDate(value);
            setPage(1);
          }}
          placeholder="To date"
          className="w-full sm:w-44"
        />
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
        onRowClick={(row) => router.push(`/purchase-orders/${row.id}`)}
      />

      <SlideOverPanel open={panelOpen} onOpenChange={setPanelOpen} title="New purchase order"
        footer={
          <div className="flex gap-2">
            <Button type="submit" form="po-form" disabled={createMutation.isPending}>
              Create PO
            </Button>
            <Button type="button" variant="secondary" onClick={() => setPanelOpen(false)}>
              Cancel
            </Button>
          </div>
        }
      >
        <form id="po-form" className="space-y-4" onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Supplier" error={form.formState.errors.supplier_id?.message}>
              <Select
                value={form.watch("supplier_id")}
                onValueChange={(value) => form.setValue("supplier_id", value ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select supplier">
                    {(() => {
                      const value = form.watch("supplier_id");
                      if (!value) return "Select supplier";
                      const selected = (supplierOptions ?? []).find((option) => option.id === value);
                      return selected?.company_name ?? "Select supplier";
                    })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(supplierOptions ?? []).map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.company_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="Warehouse" error={form.formState.errors.warehouse_id?.message}>
              <Select
                value={form.watch("warehouse_id")}
                onValueChange={(value) => form.setValue("warehouse_id", value ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select warehouse">
                    {(() => {
                      const value = form.watch("warehouse_id");
                      if (!value) return "Select warehouse";
                      const selected = (warehouseOptions ?? []).find((item) => item.id === value);
                      return selected?.name ?? "Select warehouse";
                    })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(warehouseOptions ?? []).map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Order date">
              <DatePicker
                value={form.watch("order_date") ?? ""}
                onChange={(value) => form.setValue("order_date", value)}
                placeholder="Select date"
              />
            </FormField>
            <FormField label="Expected delivery">
              <DatePicker
                value={form.watch("expected_delivery_date") ?? ""}
                onChange={(value) => form.setValue("expected_delivery_date", value)}
                placeholder="Select date"
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
                        onValueChange={(value) => {
                          form.setValue(productIdPath, value ?? "");
                          const selected = (productOptions ?? []).find((item) => item.id === (value ?? ""));
                          if (selected) {
                            const current = form.getValues(unitCostPath);
                            if (!current || Number(current) === 0) {
                              form.setValue(unitCostPath, selected.unit_cost);
                            }
                          }
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select product">
                            {(() => {
                              if (!selectedProductId) return "Select product";
                              const selected = (productOptions ?? []).find((item) => item.id === selectedProductId);
                              return selected ? `${selected.name} (${selected.sku})` : "Select product";
                            })()}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {(productOptions ?? []).map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name} ({item.sku})
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

          </form>
      </SlideOverPanel>
    </div>
  );
}









