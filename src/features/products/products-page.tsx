"use client";

/* eslint-disable react-hooks/incompatible-library */

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ColumnDef,
  OnChangeFn,
  RowSelectionState,
  SortingState,
  Updater,
} from "@tanstack/react-table";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import * as XLSX from "xlsx";
import { MoreHorizontal } from "lucide-react";

import { useProfile } from "@/components/app/profile-context";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable } from "@/components/shared/data-table";
import { FilterBar } from "@/components/shared/filter-bar";
import { FormField } from "@/components/shared/form-field";
import { PageHeader } from "@/components/shared/page-header";
import { SlideOverPanel } from "@/components/shared/slide-over-panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { addMetadataSheet, buildWorksheet, downloadWorkbook, formatISODate } from "@/lib/excel";
import { canDelete, canWrite } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/browser";

import {
  productFormSchema,
  type ProductFormInput,
  type ProductFormValues,
  type ProductRow,
} from "./schema";

const PAGE_SIZE = 25;
const LOW_STOCK_THRESHOLD = 10;

type ProductDetail = {
  id: string;
} & ProductFormValues;

type ProductQueryParams = {
  q: string;
  category: string;
  active: string;
  page: number;
  sort: string;
  dir: string;
};

function sumOnHand(inventory?: { qty_on_hand: number }[]) {
  return (inventory ?? []).reduce((acc, row) => acc + (row.qty_on_hand ?? 0), 0);
}

function stockLabel(totalOnHand: number) {
  if (totalOnHand <= 0) {
    return { label: "Out of Stock", variant: "destructive" as const };
  }
  if (totalOnHand < LOW_STOCK_THRESHOLD) {
    return { label: "Low Stock", variant: "outline" as const };
  }
  return { label: "In Stock", variant: "secondary" as const };
}

async function fetchProducts(params: ProductQueryParams) {
  const supabase = createClient();
  let query = supabase
    .from("products")
    .select(
      "id,sku,name,category,unit_of_measure,unit_cost,is_active,inventory(qty_on_hand)",
      { count: "exact" },
    );

  if (params.q.trim()) {
    const q = params.q.trim();
    query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%`);
  }

  if (params.category !== "all") {
    query = query.eq("category", params.category);
  }

  if (params.active === "active") {
    query = query.eq("is_active", true);
  } else if (params.active === "inactive") {
    query = query.eq("is_active", false);
  }

  const sortField = ["sku", "name", "category", "unit_cost", "is_active"].includes(
    params.sort,
  )
    ? params.sort
    : "name";

  const ascending = params.dir !== "desc";
  const from = (params.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, count, error } = await query.order(sortField, { ascending }).range(from, to);
  if (error) throw new Error(error.message);

  return {
    rows: (data ?? []) as ProductRow[],
    count: count ?? 0,
  };
}

async function fetchProductsForExport(params: Omit<ProductQueryParams, "page">) {
  const supabase = createClient();
  let query = supabase
    .from("products")
    .select("id,sku,name,category,unit_of_measure,unit_cost,is_active,inventory(qty_on_hand)");

  if (params.q.trim()) {
    const q = params.q.trim();
    query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%`);
  }

  if (params.category !== "all") {
    query = query.eq("category", params.category);
  }

  if (params.active === "active") {
    query = query.eq("is_active", true);
  } else if (params.active === "inactive") {
    query = query.eq("is_active", false);
  }

  const sortField = ["sku", "name", "category", "unit_cost", "is_active"].includes(
    params.sort,
  )
    ? params.sort
    : "name";

  const ascending = params.dir !== "desc";
  const { data, error } = await query.order(sortField, { ascending });
  if (error) throw new Error(error.message);

  return (data ?? []) as ProductRow[];
}

async function fetchProductDetail(id: string): Promise<ProductDetail> {
  const supabase = createClient();
  const { data, error } = await supabase.from("products").select("*").eq("id", id).single();
  if (error) throw new Error(error.message);

  type ProductDbRow = {
    id: string;
    sku: string;
    name: string;
    description: string | null;
    category: string | null;
    unit_of_measure: string | null;
    unit_cost: number;
    selling_price: number;
    minimum_order_quantity: number;
    lead_time_days: number;
    image_url: string | null;
    is_active: boolean;
  };

  const row = data as ProductDbRow;
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description ?? "",
    category: row.category ?? "",
    unit_of_measure: row.unit_of_measure ?? "",
    unit_cost: Number(row.unit_cost ?? 0),
    selling_price: Number(row.selling_price ?? 0),
    minimum_order_quantity: Number(row.minimum_order_quantity ?? 0),
    lead_time_days: Number(row.lead_time_days ?? 0),
    image_url: row.image_url ?? "",
    is_active: !!row.is_active,
  };
}

async function checkSkuUnique(sku: string, excludeId?: string) {
  const supabase = createClient();
  let query = supabase.from("products").select("id").ilike("sku", sku);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query.limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length === 0;
}

function resolveUpdater<T>(updater: Updater<T>, current: T): T {
  return typeof updater === "function" ? (updater as (value: T) => T)(current) : updater;
}

export function ProductsPage() {
  const profile = useProfile();
  const writable = canWrite(profile.role);
  const deletable = canDelete(profile.role);

  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));
  const [category, setCategory] = useQueryState("category", parseAsString.withDefault("all"));
  const [active, setActive] = useQueryState("active", parseAsString.withDefault("all"));
  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1));
  const [sort, setSort] = useQueryState("sort", parseAsString.withDefault("name"));
  const [dir, setDir] = useQueryState("dir", parseAsString.withDefault("asc"));

  const sorting = useMemo<SortingState>(() => [{ id: sort, desc: dir === "desc" }], [sort, dir]);
  const params = { q, category, active, page, sort, dir };

  const { data, isLoading, error } = useQuery({
    queryKey: ["products", params],
    queryFn: () => fetchProducts(params),
  });

  const queryClient = useQueryClient();

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const selectedIds = useMemo(
    () =>
      Object.entries(rowSelection)
        .filter(([, selected]) => selected)
        .map(([index]) => data?.rows?.[Number(index)]?.id)
        .filter(Boolean) as string[],
    [rowSelection, data?.rows],
  );

  const [panelOpen, setPanelOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["product_detail", editingId],
    queryFn: () => fetchProductDetail(editingId as string),
    enabled: !!editingId,
  });

  const form = useForm<ProductFormInput>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      sku: "",
      name: "",
      description: "",
      category: "",
      unit_of_measure: "",
      unit_cost: 0,
      selling_price: 0,
      minimum_order_quantity: 0,
      lead_time_days: 0,
      image_url: "",
      is_active: true,
    },
  });

  useEffect(() => {
    if (!editingId || !detailQuery.data) return;
    const detail = detailQuery.data;
    form.reset({
      sku: detail.sku,
      name: detail.name,
      description: detail.description,
      category: detail.category,
      unit_of_measure: detail.unit_of_measure,
      unit_cost: detail.unit_cost,
      selling_price: detail.selling_price,
      minimum_order_quantity: detail.minimum_order_quantity,
      lead_time_days: detail.lead_time_days,
      image_url: detail.image_url,
      is_active: detail.is_active,
    });
  }, [editingId, detailQuery.data, form]);

  const handleExport = useCallback(async (rowsOverride?: ProductRow[]) => {
    const rows = rowsOverride ?? (await fetchProductsForExport({ q, category, active, sort, dir }));

    const worksheet = buildWorksheet(rows, [
      { key: "sku", header: "SKU", type: "string", value: (row: ProductRow) => row.sku },
      { key: "name", header: "Product Name", type: "string", value: (row: ProductRow) => row.name },
      { key: "category", header: "Category", type: "string", value: (row: ProductRow) => row.category ?? "" },
      {
        key: "unit_of_measure",
        header: "Unit of Measure",
        type: "string",
        value: (row: ProductRow) => row.unit_of_measure ?? "",
      },
      { key: "unit_cost", header: "Unit Cost", type: "currency", value: (row: ProductRow) => row.unit_cost },
      {
        key: "stock",
        header: "On Hand",
        type: "number",
        value: (row: ProductRow) => sumOnHand(row.inventory),
      },
      {
        key: "is_active",
        header: "Active",
        type: "string",
        value: (row: ProductRow) => (row.is_active ? "Yes" : "No"),
      },
    ]);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Products");
    addMetadataSheet(workbook, {
      "Export date": formatISODate(new Date()),
      Filters: `search=${q || ""}; category=${category}; status=${active}`,
      "Total rows": rows.length,
      User: profile.name,
    });

    downloadWorkbook(workbook, `products_export_${formatISODate(new Date())}.xlsx`);
  }, [q, category, active, sort, dir, profile.name]);

  const createMutation = useMutation({
    mutationFn: async (values: ProductFormInput) => {
      const parsed = productFormSchema.parse(values);
      const isUnique = await checkSkuUnique(parsed.sku);
      if (!isUnique) throw new Error("SKU already exists.");

      const supabase = createClient();
      const payload = {
        ...parsed,
        image_url: parsed.image_url ? parsed.image_url : null,
        description: parsed.description ? parsed.description : null,
        category: parsed.category ? parsed.category : null,
        unit_of_measure: parsed.unit_of_measure ? parsed.unit_of_measure : null,
      };
      const { error } = await supabase.from("products").insert(payload);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      setPanelOpen(false);
      setEditingId(null);
      form.reset();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: ProductFormInput }) => {
      const parsed = productFormSchema.parse(values);
      const isUnique = await checkSkuUnique(parsed.sku, id);
      if (!isUnique) throw new Error("SKU already exists.");

      const supabase = createClient();
      const payload = {
        ...parsed,
        image_url: parsed.image_url ? parsed.image_url : null,
        description: parsed.description ? parsed.description : null,
        category: parsed.category ? parsed.category : null,
        unit_of_measure: parsed.unit_of_measure ? parsed.unit_of_measure : null,
      };
      const { error } = await supabase.from("products").update(payload).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      setPanelOpen(false);
      setEditingId(null);
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase.from("products").update({ is_active }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const supabase = createClient();
      const { error } = await supabase.from("products").delete().in("id", ids);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      setRowSelection({});
      setConfirmOpen(false);
    },
  });

  const onSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = resolveUpdater(updater, sorting);
    const first = next[0];
    if (!first) return;
    setSort(first.id);
    setDir(first.desc ? "desc" : "asc");
    setPage(1);
  };

  const columns = useMemo<ColumnDef<ProductRow, unknown>[]>(() => {
    const cols: ColumnDef<ProductRow, unknown>[] = [];

    if (deletable) {
      cols.push({
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="Select all"
            onClick={(event) => event.stopPropagation()}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
            onClick={(event) => event.stopPropagation()}
          />
        ),
        enableSorting: false,
        enableHiding: false,
      });
    }

    cols.push(
      {
        accessorKey: "sku",
        header: ({ column }) => (
          <button type="button" className="cursor-pointer select-none" onClick={column.getToggleSortingHandler()}>
            SKU
          </button>
        ),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.sku}</span>,
      },
      {
        accessorKey: "name",
        header: ({ column }) => (
          <button type="button" className="cursor-pointer select-none" onClick={column.getToggleSortingHandler()}>
            Name
          </button>
        ),
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: "category",
        header: ({ column }) => (
          <button type="button" className="cursor-pointer select-none" onClick={column.getToggleSortingHandler()}>
            Category
          </button>
        ),
        cell: ({ row }) => row.original.category ?? "-",
      },
      {
        accessorKey: "unit_of_measure",
        header: () => "UOM",
        cell: ({ row }) => row.original.unit_of_measure ?? "-",
      },
      {
        accessorKey: "unit_cost",
        header: ({ column }) => (
          <button type="button" className="cursor-pointer select-none" onClick={column.getToggleSortingHandler()}>
            Unit Cost
          </button>
        ),
        cell: ({ row }) => `$${Number(row.original.unit_cost).toFixed(2)}`,
      },
      {
        id: "stock",
        header: () => "Stock",
        cell: ({ row }) => {
          const total = sumOnHand(row.original.inventory);
          const status = stockLabel(total);
          return <StatusBadge label={status.label} variant={status.variant} />;
        },
      },
      {
        accessorKey: "is_active",
        header: () => "Active",
        cell: ({ row }) => {
          const value = !!row.original.is_active;
          if (!writable) {
            return (
              <StatusBadge
                label={value ? "Active" : "Inactive"}
                variant={value ? "secondary" : "outline"}
              />
            );
          }
          return (
            <div onClick={(event) => event.stopPropagation()}>
              <Switch
                checked={value}
                onCheckedChange={(next) =>
                  toggleActiveMutation.mutate({ id: row.original.id, is_active: next })
                }
              />
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
                <DropdownMenuItem onClick={() => void handleExport([row.original])}>
                  Export row
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    );

    return cols;
  }, [deletable, writable, toggleActiveMutation, handleExport]);

  function openCreate() {
    setEditingId(null);
    form.reset();
    setPanelOpen(true);
  }

  function openEdit(row: ProductRow) {
    setEditingId(row.id);
    setPanelOpen(true);
  }

  const pageCount = Math.ceil((data?.count ?? 0) / PAGE_SIZE) || 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        subtitle="Manage your SKU catalog."
        actions={writable ? <Button onClick={openCreate}>New product</Button> : null}
      />

      <FilterBar>
        <div className="flex flex-1 items-center gap-2">
          <Input
            placeholder="Search by name or SKU..."
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
        </div>

        <Select
          value={category}
          onValueChange={(value) => {
            setCategory(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            <SelectItem value="Raw Materials">Raw Materials</SelectItem>
            <SelectItem value="Finished Goods">Finished Goods</SelectItem>
            <SelectItem value="Packaging">Packaging</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={active}
          onValueChange={(value) => {
            setActive(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>

        {deletable ? (
          <Button variant="destructive" disabled={selectedIds.length === 0} onClick={() => setConfirmOpen(true)}>
            Delete selected
          </Button>
        ) : null}
      </FilterBar>

      {error ? (
        <div className="rounded-md border p-4 text-sm text-destructive">{(error as Error).message}</div>
      ) : null}

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
        onSortingChange={onSortingChange}
        rowSelection={deletable ? rowSelection : undefined}
        onRowSelectionChange={deletable ? setRowSelection : undefined}
        pageIndex={Math.max(page - 1, 0)}
        pageCount={pageCount}
        onPageChange={(index) => setPage(index + 1)}
        onRowClick={(row) => (writable ? openEdit(row) : null)}
      />

      <SlideOverPanel
        open={panelOpen}
        onOpenChange={(open) => {
          setPanelOpen(open);
          if (!open) setEditingId(null);
        }}
        title={editingId ? "Edit product" : "New product"}
        footer={
          <div className="flex gap-2">
            <Button
              type="submit"
              form="product-form"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingId ? "Save changes" : "Create product"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPanelOpen(false)}
            >
              Cancel
            </Button>
          </div>
        }
      >
        {editingId && detailQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : (
          <form
            id="product-form"
            className="space-y-4"
            onSubmit={form.handleSubmit((values) => {
              if (editingId) {
                updateMutation.mutate({ id: editingId, values });
              } else {
                createMutation.mutate(values);
              }
            })}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="SKU" error={form.formState.errors.sku?.message}>
                <Input {...form.register("sku")} />
              </FormField>
              <FormField label="Name" error={form.formState.errors.name?.message}>
                <Input {...form.register("name")} />
              </FormField>
            </div>

            <FormField label="Description" error={form.formState.errors.description?.message}>
              <Textarea rows={3} {...form.register("description")} />
            </FormField>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Category" error={form.formState.errors.category?.message}>
                <Input {...form.register("category")} placeholder="e.g. Raw Materials" />
              </FormField>
              <FormField
                label="Unit of Measure"
                error={form.formState.errors.unit_of_measure?.message}
              >
                <Input {...form.register("unit_of_measure")} placeholder="e.g. each, kg" />
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Unit Cost" error={form.formState.errors.unit_cost?.message}>
                <Input type="number" step="0.01" {...form.register("unit_cost")} />
              </FormField>
              <FormField
                label="Selling Price"
                error={form.formState.errors.selling_price?.message}
              >
                <Input type="number" step="0.01" {...form.register("selling_price")} />
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                label="Min Order Qty"
                error={form.formState.errors.minimum_order_quantity?.message}
              >
                <Input type="number" step="0.001" {...form.register("minimum_order_quantity")} />
              </FormField>
              <FormField
                label="Lead Time (days)"
                error={form.formState.errors.lead_time_days?.message}
              >
                <Input type="number" step="1" {...form.register("lead_time_days")} />
              </FormField>
            </div>

            <FormField label="Image URL" error={form.formState.errors.image_url?.message}>
              <Input {...form.register("image_url")} placeholder="https://..." />
            </FormField>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">Active</div>
                <div className="text-xs text-muted-foreground">
                  Inactive products are hidden from operational flows.
                </div>
              </div>
              <Switch
                checked={form.watch("is_active")}
                onCheckedChange={(value) => form.setValue("is_active", value)}
              />
            </div>

            {(createMutation.error || updateMutation.error || detailQuery.error) ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {(
                  (createMutation.error ?? updateMutation.error ?? detailQuery.error) as Error
                ).message}
              </div>
            ) : null}

            </form>
        )}
      </SlideOverPanel>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete products?"
        description="This cannot be undone. Products referenced by inventory or purchase orders may fail to delete."
        confirmLabel={`Delete (${selectedIds.length})`}
        isConfirming={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(selectedIds)}
      />
    </div>
  );
}









