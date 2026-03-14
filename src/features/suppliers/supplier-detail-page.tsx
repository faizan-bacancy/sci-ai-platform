"use client";

/* eslint-disable react-hooks/incompatible-library */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as XLSX from "xlsx";
import { MoreHorizontal } from "lucide-react";

import { useProfile } from "@/components/app/profile-context";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormField } from "@/components/shared/form-field";
import { PageHeader } from "@/components/shared/page-header";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { addMetadataSheet, buildWorksheet, downloadWorkbook, formatISODate } from "@/lib/excel";
import { canDelete, canWrite } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/browser";

import {
  supplierFormSchema,
  type SupplierFormInput,
  type SupplierFormValues,
  type SupplierProductRow,
} from "./schema";

type SupplierDetail = SupplierFormValues & {
  id: string;
  created_at: string;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  country: string | null;
  city: string | null;
  payment_terms: string | null;
  currency: string | null;
  rating: number | null;
  notes: string | null;
  is_active: boolean;
};

type ProductOption = { id: string; sku: string; name: string };

async function fetchSupplier(id: string) {
  const supabase = createClient();
  const { data, error } = await supabase.from("suppliers").select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data as SupplierDetail;
}

async function fetchSupplierProducts(id: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("supplier_products")
    .select(
      "id,supplier_id,product_id,supplier_sku,unit_cost,lead_time_days,minimum_order_quantity,is_preferred,product:products(id,sku,name)",
    )
    .eq("supplier_id", id)
    .order("is_preferred", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as SupplierProductRow[];
}

async function fetchProductsOptions() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id,sku,name")
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductOption[];
}

export function SupplierDetailPage({ supplierId }: { supplierId: string }) {
  const profile = useProfile();
  const writable = canWrite(profile.role);
  const deletable = canDelete(profile.role);

  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: supplier, isLoading, error } = useQuery({
    queryKey: ["supplier", supplierId],
    queryFn: () => fetchSupplier(supplierId),
  });

  const { data: links } = useQuery({
    queryKey: ["supplier_products", supplierId],
    queryFn: () => fetchSupplierProducts(supplierId),
  });

  const { data: productsOptions } = useQuery({
    queryKey: ["products_options"],
    queryFn: fetchProductsOptions,
  });

  const form = useForm<SupplierFormInput>({
    resolver: zodResolver(supplierFormSchema),
    values: supplier
      ? {
          company_name: supplier.company_name,
          contact_name: supplier.contact_name ?? "",
          contact_email: supplier.contact_email ?? "",
          contact_phone: supplier.contact_phone ?? "",
          country: supplier.country ?? "",
          city: supplier.city ?? "",
          payment_terms: supplier.payment_terms ?? "",
          currency: supplier.currency ?? "",
          rating: supplier.rating ?? null,
          notes: supplier.notes ?? "",
          is_active: supplier.is_active,
        }
      : undefined,
  });

  async function handleExportLinks(rowsOverride?: SupplierProductRow[]) {
    const rows = rowsOverride ?? (links ?? []);

    const worksheet = buildWorksheet(rows, [
      {
        key: "product_name",
        header: "Product",
        type: "string",
        value: (row: SupplierProductRow) => row.product?.name ?? "",
      },
      {
        key: "sku",
        header: "SKU",
        type: "string",
        value: (row: SupplierProductRow) => row.product?.sku ?? "",
      },
      {
        key: "supplier_sku",
        header: "Supplier SKU",
        type: "string",
        value: (row: SupplierProductRow) => row.supplier_sku ?? "",
      },
      {
        key: "unit_cost",
        header: "Unit Cost",
        type: "currency",
        value: (row: SupplierProductRow) => row.unit_cost,
      },
      {
        key: "lead_time_days",
        header: "Lead Time (days)",
        type: "number",
        value: (row: SupplierProductRow) => row.lead_time_days,
      },
      {
        key: "minimum_order_quantity",
        header: "MOQ",
        type: "number",
        value: (row: SupplierProductRow) => row.minimum_order_quantity,
      },
      {
        key: "is_preferred",
        header: "Preferred",
        type: "string",
        value: (row: SupplierProductRow) => (row.is_preferred ? "Yes" : "No"),
      },
    ]);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Supplier Products");
    addMetadataSheet(workbook, {
      "Export date": formatISODate(new Date()),
      Supplier: supplier?.company_name ?? "",
      "Total rows": rows.length,
      User: profile.name,
    });

    downloadWorkbook(workbook, `supplier_products_export_${formatISODate(new Date())}.xlsx`);
  }

  const updateMutation = useMutation({
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
      const { error } = await supabase.from("suppliers").update(payload).eq("id", supplierId);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["supplier", supplierId] });
      await queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { error } = await supabase.from("suppliers").delete().eq("id", supplierId);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      router.push("/suppliers");
    },
  });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [addProductId, setAddProductId] = useState("");

  const addLinkMutation = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { error } = await supabase.from("supplier_products").insert({
        supplier_id: supplierId,
        product_id: addProductId,
        unit_cost: 0,
        lead_time_days: 0,
        minimum_order_quantity: 0,
        is_preferred: false,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      setAddProductId("");
      await queryClient.invalidateQueries({ queryKey: ["supplier_products", supplierId] });
    },
  });

  const removeLinkMutation = useMutation({
    mutationFn: async (linkId: string) => {
      const supabase = createClient();
      const { error } = await supabase.from("supplier_products").delete().eq("id", linkId);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["supplier_products", supplierId] });
    },
  });

  const setPreferredMutation = useMutation({
    mutationFn: async ({ productId }: { productId: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("set_preferred_supplier", {
        p_supplier_id: supplierId,
        p_product_id: productId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["supplier_products", supplierId] });
    },
  });

  const linkedProductIds = useMemo(
    () => new Set((links ?? []).map((link) => link.product_id)),
    [links],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={supplier?.company_name ?? "Supplier"}
        subtitle={supplier ? `Supplier ID: ${supplier.id}` : undefined}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void handleExportLinks()}>
              Export to Excel
            </Button>
            <Button variant="secondary" onClick={() => router.push("/suppliers")}>Back</Button>
            {deletable ? (
              <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
                Delete
              </Button>
            ) : null}
          </div>
        }
      />

      {error ? <div className="rounded-md border p-4 text-sm text-destructive">{(error as Error).message}</div> : null}

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <div className="rounded-md border p-4">
            {isLoading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : (
              <form className="space-y-4" onSubmit={form.handleSubmit((values) => updateMutation.mutate(values))}>
                <FormField label="Company name" error={form.formState.errors.company_name?.message}>
                  <Input {...form.register("company_name")} disabled={!writable} />
                </FormField>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label="Contact name" error={form.formState.errors.contact_name?.message}>
                    <Input {...form.register("contact_name")} disabled={!writable} />
                  </FormField>
                  <FormField label="Contact email" error={form.formState.errors.contact_email?.message}>
                    <Input {...form.register("contact_email")} disabled={!writable} />
                  </FormField>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label="Country" error={form.formState.errors.country?.message}>
                    <Input {...form.register("country")} disabled={!writable} />
                  </FormField>
                  <FormField label="City" error={form.formState.errors.city?.message}>
                    <Input {...form.register("city")} disabled={!writable} />
                  </FormField>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label="Payment terms" error={form.formState.errors.payment_terms?.message}>
                    <Input {...form.register("payment_terms")} disabled={!writable} />
                  </FormField>
                  <FormField label="Currency" error={form.formState.errors.currency?.message}>
                    <Input {...form.register("currency")} disabled={!writable} />
                  </FormField>
                </div>

                <FormField label="Rating (1-5)" error={form.formState.errors.rating?.message}>
                  <Input type="number" min={1} max={5} step={1} {...form.register("rating")} disabled={!writable} />
                </FormField>

                <FormField label="Notes" error={form.formState.errors.notes?.message}>
                  <Textarea rows={4} {...form.register("notes")} disabled={!writable} />
                </FormField>

                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">Active</div>
                    <div className="text-xs text-muted-foreground">
                      Inactive suppliers are hidden from procurement flows.
                    </div>
                  </div>
                  {writable ? (
                    <Switch
                      checked={form.watch("is_active")}
                      onCheckedChange={(value) => form.setValue("is_active", value)}
                    />
                  ) : (
                    <StatusBadge
                      label={form.watch("is_active") ? "Active" : "Inactive"}
                      variant={form.watch("is_active") ? "secondary" : "outline"}
                    />
                  )}
                </div>

                {writable ? (
                  <div className="flex gap-2">
                    <Button type="submit" disabled={updateMutation.isPending}>Save</Button>
                    <Button type="button" variant="secondary" onClick={() => form.reset()}>
                      Reset
                    </Button>
                  </div>
                ) : null}

                {updateMutation.error ? (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {(updateMutation.error as Error).message}
                  </div>
                ) : null}
              </form>
            )}
          </div>
        </TabsContent>

        <TabsContent value="products">
          <div className="space-y-4 rounded-md border p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex-1 text-sm text-muted-foreground">Link products this supplier provides.</div>
              {writable ? (
                <div className="flex w-full gap-2 sm:w-auto">
                  <Select value={addProductId} onValueChange={(value) => setAddProductId(value ?? "")}> 
                    <SelectTrigger className="w-full sm:w-72">
                      <SelectValue placeholder="Select product">
                        {(() => {
                          if (!addProductId) return "Select product";
                          const selected = (productsOptions ?? []).find((item) => item.id === addProductId);
                          return selected ? `${selected.name} (${selected.sku})` : "Select product";
                        })()}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(productsOptions ?? [])
                        .filter((item) => !linkedProductIds.has(item.id))
                        .map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name} ({item.sku})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    disabled={!addProductId || addLinkMutation.isPending}
                    onClick={() => addLinkMutation.mutate()}
                  >
                    Add
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              {(links ?? []).length === 0 ? (
                <div className="text-sm text-muted-foreground">No linked products yet.</div>
              ) : (
                (links ?? []).map((link) => (
                  <div
                    key={link.id}
                    className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="text-sm font-medium">
                        {link.product?.name ?? "Product"}{" "}
                        <span className="text-muted-foreground">({link.product?.sku})</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Unit cost: {Number(link.unit_cost).toFixed(2)} · Lead time: {link.lead_time_days}d · MOQ: {Number(link.minimum_order_quantity)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => void handleExportLinks([link])}>
                            Export row
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>

                      <Button
                        type="button"
                        variant={link.is_preferred ? "default" : "secondary"}
                        size="sm"
                        disabled={!writable || setPreferredMutation.isPending}
                        onClick={() => setPreferredMutation.mutate({ productId: link.product_id })}
                      >
                        {link.is_preferred ? "Preferred" : "Make preferred"}
                      </Button>

                      {writable ? (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={removeLinkMutation.isPending}
                          onClick={() => removeLinkMutation.mutate(link.id)}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>

            {(addLinkMutation.error || removeLinkMutation.error || setPreferredMutation.error) ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {(
                  (addLinkMutation.error ?? removeLinkMutation.error ?? setPreferredMutation.error) as Error
                ).message}
              </div>
            ) : null}
          </div>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete supplier?"
        description="This cannot be undone. Suppliers referenced by purchase orders may fail to delete."
        confirmLabel="Delete"
        isConfirming={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  );
}


