"use client";

/* eslint-disable react-hooks/incompatible-library */

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, OnChangeFn, SortingState, Updater } from "@tanstack/react-table";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";

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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { canWrite } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/browser";

import {
  supplierFormSchema,
  type SupplierFormInput,
  type SupplierRow,
} from "./schema";

const PAGE_SIZE = 25;

type SupplierQueryParams = {
  q: string;
  country: string;
  rating: string;
  active: string;
  page: number;
  sort: string;
  dir: string;
};

function resolveUpdater<T>(updater: Updater<T>, current: T): T {
  return typeof updater === "function" ? (updater as (c: T) => T)(current) : updater;
}

function Stars({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={i < value ? "text-foreground" : "text-muted-foreground/40"}
        >
          ★
        </span>
      ))}
    </div>
  );
}

async function fetchSuppliers(params: SupplierQueryParams) {
  const supabase = createClient();

  let query = supabase
    .from("suppliers")
    .select("id,company_name,contact_name,country,rating,is_active", {
      count: "exact",
    });

  if (params.q.trim()) {
    const q = params.q.trim();
    query = query.or(`company_name.ilike.%${q}%,contact_name.ilike.%${q}%`);
  }

  if (params.country !== "all") {
    query = query.eq("country", params.country);
  }

  if (params.rating !== "all") {
    query = query.eq("rating", Number(params.rating));
  }

  if (params.active === "active") {
    query = query.eq("is_active", true);
  } else if (params.active === "inactive") {
    query = query.eq("is_active", false);
  }

  const sortField = ["company_name", "country", "rating", "is_active"].includes(
    params.sort,
  )
    ? params.sort
    : "company_name";
  const ascending = params.dir !== "desc";

  const from = (params.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, count, error } = await query
    .order(sortField, { ascending })
    .range(from, to);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as SupplierRow[];
  const supplierIds = rows.map((r) => r.id);

  const counts: Record<string, number> = {};
  if (supplierIds.length) {
    const { data: links, error: linksError } = await supabase
      .from("supplier_products")
      .select("supplier_id")
      .in("supplier_id", supplierIds);
    if (linksError) throw new Error(linksError.message);

    for (const link of (links ?? []) as { supplier_id: string }[]) {
      counts[link.supplier_id] = (counts[link.supplier_id] ?? 0) + 1;
    }
  }

  return { rows, count: count ?? 0, counts };
}

export function SuppliersPage() {
  const profile = useProfile();
  const writable = canWrite(profile.role);
  const router = useRouter();

  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));
  const [country, setCountry] = useQueryState(
    "country",
    parseAsString.withDefault("all"),
  );
  const [rating, setRating] = useQueryState(
    "rating",
    parseAsString.withDefault("all"),
  );
  const [active, setActive] = useQueryState(
    "active",
    parseAsString.withDefault("all"),
  );
  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1));
  const [sort, setSort] = useQueryState(
    "sort",
    parseAsString.withDefault("company_name"),
  );
  const [dir, setDir] = useQueryState("dir", parseAsString.withDefault("asc"));

  const sorting = useMemo<SortingState>(
    () => [{ id: sort, desc: dir === "desc" }],
    [sort, dir],
  );
  const params = { q, country, rating, active, page, sort, dir };

  const { data, isLoading, error } = useQuery({
    queryKey: ["suppliers", params],
    queryFn: () => fetchSuppliers(params),
  });

  const queryClient = useQueryClient();

  const [panelOpen, setPanelOpen] = useState(false);

  const form = useForm<SupplierFormInput>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: {
      company_name: "",
      contact_name: "",
      contact_email: "",
      contact_phone: "",
      country: "",
      city: "",
      payment_terms: "",
      currency: "",
      rating: null,
      notes: "",
      is_active: true,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (values: SupplierFormInput) => {
      const supabase = createClient();
      const parsed = supplierFormSchema.parse(values);
      const payload = {
        ...parsed,
        contact_email: parsed.contact_email ? values.contact_email : null,
        contact_name: parsed.contact_name ? values.contact_name : null,
        contact_phone: parsed.contact_phone ? values.contact_phone : null,
        country: parsed.country ? values.country : null,
        city: parsed.city ? values.city : null,
        payment_terms: parsed.payment_terms ? values.payment_terms : null,
        currency: parsed.currency ? values.currency : null,
        notes: parsed.notes ? values.notes : null,
        rating: parsed.rating ?? null,
      };
      const { error } = await supabase.from("suppliers").insert(payload);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setPanelOpen(false);
      form.reset();
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("suppliers")
        .update({ is_active })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["suppliers"] });
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

  const columns = useMemo<ColumnDef<SupplierRow, unknown>[]>(() => {
    return [
      {
        accessorKey: "company_name",
        header: ({ column }) => (
          <button
            type="button"
            className="cursor-pointer select-none"
            onClick={column.getToggleSortingHandler()}
          >
            Company
          </button>
        ),
        cell: ({ row }) => (
          <span className="font-medium">{row.original.company_name}</span>
        ),
      },
      {
        accessorKey: "contact_name",
        header: () => "Contact",
        cell: ({ row }) => row.original.contact_name ?? "—",
      },
      {
        accessorKey: "country",
        header: ({ column }) => (
          <button
            type="button"
            className="cursor-pointer select-none"
            onClick={column.getToggleSortingHandler()}
          >
            Country
          </button>
        ),
        cell: ({ row }) => row.original.country ?? "—",
      },
      {
        accessorKey: "rating",
        header: ({ column }) => (
          <button
            type="button"
            className="cursor-pointer select-none"
            onClick={column.getToggleSortingHandler()}
          >
            Rating
          </button>
        ),
        cell: ({ row }) =>
          row.original.rating ? <Stars value={row.original.rating} /> : "—",
      },
      {
        id: "product_count",
        header: () => "Products",
        cell: ({ row }) => {
          return data?.counts?.[row.original.id] ?? 0;
        },
      },
      {
        accessorKey: "is_active",
        header: ({ column }) => (
          <button
            type="button"
            className="cursor-pointer select-none"
            onClick={column.getToggleSortingHandler()}
          >
            Active
          </button>
        ),
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
            <div onClick={(e) => e.stopPropagation()}>
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
    ];
  }, [writable, toggleActiveMutation, data?.counts]);

  const pageCount = Math.ceil((data?.count ?? 0) / PAGE_SIZE) || 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suppliers"
        subtitle="Manage your vendor directory."
        actions={
          writable ? (
            <Button onClick={() => setPanelOpen(true)}>New supplier</Button>
          ) : null
        }
      />

      <FilterBar>
        <div className="flex flex-1 items-center gap-2">
          <Input
            placeholder="Search by company or contact…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          value={country}
          onValueChange={(v) => {
            setCountry(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue placeholder="Country" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All countries</SelectItem>
            <SelectItem value="India">India</SelectItem>
            <SelectItem value="United States">United States</SelectItem>
            <SelectItem value="United Kingdom">United Kingdom</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={rating}
          onValueChange={(v) => {
            setRating(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Rating" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ratings</SelectItem>
            <SelectItem value="5">5</SelectItem>
            <SelectItem value="4">4</SelectItem>
            <SelectItem value="3">3</SelectItem>
            <SelectItem value="2">2</SelectItem>
            <SelectItem value="1">1</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={active}
          onValueChange={(v) => {
            setActive(v);
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
        onSortingChange={onSortingChange}
        pageIndex={Math.max(page - 1, 0)}
        pageCount={pageCount}
        onPageChange={(idx) => setPage(idx + 1)}
        onRowClick={(row) => router.push(`/suppliers/${row.id}`)}
      />

      <SlideOverPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        title="New supplier"
      >
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}
        >
          <FormField
            label="Company name"
            error={form.formState.errors.company_name?.message}
          >
            <Input {...form.register("company_name")} />
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              label="Contact name"
              error={form.formState.errors.contact_name?.message}
            >
              <Input {...form.register("contact_name")} />
            </FormField>
            <FormField
              label="Contact email"
              error={form.formState.errors.contact_email?.message}
            >
              <Input {...form.register("contact_email")} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Country" error={form.formState.errors.country?.message}>
              <Input {...form.register("country")} />
            </FormField>
            <FormField label="City" error={form.formState.errors.city?.message}>
              <Input {...form.register("city")} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              label="Payment terms"
              error={form.formState.errors.payment_terms?.message}
            >
              <Input
                {...form.register("payment_terms")}
                placeholder="e.g. Net 30"
              />
            </FormField>
            <FormField
              label="Currency"
              error={form.formState.errors.currency?.message}
            >
              <Input {...form.register("currency")} placeholder="e.g. USD" />
            </FormField>
          </div>

          <FormField
            label="Rating (1–5)"
            error={form.formState.errors.rating?.message}
          >
            <Input type="number" min={1} max={5} step={1} {...form.register("rating")} />
          </FormField>

          <FormField label="Notes" error={form.formState.errors.notes?.message}>
            <Textarea rows={4} {...form.register("notes")} />
          </FormField>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-0.5">
              <div className="text-sm font-medium">Active</div>
              <div className="text-xs text-muted-foreground">
                Inactive suppliers are hidden from procurement flows.
              </div>
            </div>
            <Switch
              checked={form.watch("is_active")}
              onCheckedChange={(v) => form.setValue("is_active", v)}
            />
          </div>

          {createMutation.error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {(createMutation.error as Error).message}
            </div>
          ) : null}

          <div className="flex gap-2">
            <Button type="submit" disabled={createMutation.isPending}>
              Create supplier
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