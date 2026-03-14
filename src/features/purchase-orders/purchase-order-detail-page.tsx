"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { MoreHorizontal } from "lucide-react";

import { useProfile } from "@/components/app/profile-context";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { addMetadataSheet, buildWorksheet, downloadWorkbook, formatISODate } from "@/lib/excel";
import { canWrite } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/browser";

import type { PurchaseOrderDetail } from "./schema";

type PurchaseOrderLine = PurchaseOrderDetail["lines"][number];

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

type PurchaseOrderHeaderRow = Omit<PurchaseOrderDetail, "lines"> & {
  lines?: never;
};

async function fetchPurchaseOrder(id: string): Promise<PurchaseOrderDetail> {
  const supabase = createClient();
  const { data: header, error } = await supabase
    .from("purchase_orders")
    .select(
      "id,po_number,status,order_date,expected_delivery_date,actual_delivery_date,total_amount,currency,notes,supplier_id,warehouse_id,supplier:suppliers(company_name),warehouse:warehouses(name)",
    )
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);

  const { data: lines, error: linesError } = await supabase
    .from("purchase_order_lines")
    .select(
      "id,purchase_order_id,product_id,qty_ordered,qty_received,unit_cost,line_total,product:products(name,sku)",
    )
    .eq("purchase_order_id", id);
  if (linesError) throw new Error(linesError.message);

  return {
    ...(header as unknown as PurchaseOrderHeaderRow),
    lines: (lines ?? []) as unknown as PurchaseOrderDetail["lines"],
  };
}

export function PurchaseOrderDetailPage({ purchaseOrderId }: { purchaseOrderId: string }) {
  const profile = useProfile();
  const writable = canWrite(profile.role);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["purchase_order", purchaseOrderId],
    queryFn: () => fetchPurchaseOrder(purchaseOrderId),
  });

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      const supabase = createClient();
      const { error } = await supabase.from("purchase_orders").update({ status }).eq("id", purchaseOrderId);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["purchase_order", purchaseOrderId] });
      await queryClient.invalidateQueries({ queryKey: ["purchase_orders"] });
    },
  });

  const receiveMutation = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { error } = await supabase.rpc("receive_purchase_order", {
        p_purchase_order_id: purchaseOrderId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["purchase_order", purchaseOrderId] });
      await queryClient.invalidateQueries({ queryKey: ["purchase_orders"] });
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
  });

  async function handleExport(linesOverride?: PurchaseOrderDetail["lines"]) {
    const lines = linesOverride ?? (data?.lines ?? []);

    const worksheet = buildWorksheet(lines, [
      { key: "sku", header: "SKU", type: "string", value: (line: PurchaseOrderLine) => line.product?.sku ?? "" },
      { key: "product", header: "Product", type: "string", value: (line: PurchaseOrderLine) => line.product?.name ?? "" },
      { key: "qty_ordered", header: "Qty Ordered", type: "number", value: (line: PurchaseOrderLine) => line.qty_ordered },
      { key: "qty_received", header: "Qty Received", type: "number", value: (line: PurchaseOrderLine) => line.qty_received },
      { key: "unit_cost", header: "Unit Cost", type: "currency", value: (line: PurchaseOrderLine) => line.unit_cost },
      { key: "line_total", header: "Line Total", type: "currency", value: (line: PurchaseOrderLine) => line.line_total },
    ]);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "PO Lines");
    addMetadataSheet(workbook, {
      "Export date": formatISODate(new Date()),
      "PO number": data?.po_number ?? "",
      Supplier: data?.supplier?.company_name ?? "",
      Warehouse: data?.warehouse?.name ?? "",
      "Total rows": lines.length,
      User: profile.name,
    });

    downloadWorkbook(workbook, `po_lines_export_${formatISODate(new Date())}.xlsx`);
  }

  const status = data?.status ?? "";
  const badge = statusBadge(status);

  return (
    <div className="space-y-6">
      <PageHeader
        title={data ? `Purchase Order ${data.po_number}` : "Purchase Order"}
        subtitle={data ? `${data.supplier?.company_name ?? ""} · ${data.warehouse?.name ?? ""}` : undefined}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void handleExport()}>
              Export to Excel
            </Button>
            <Button variant="secondary" onClick={() => router.push("/purchase-orders")}>Back</Button>
          </div>
        }
      />

      {error ? <div className="rounded-md border p-4 text-sm text-destructive">{(error as Error).message}</div> : null}

      {isLoading || !data ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge label={badge.label} variant={badge.variant} />
            <div className="text-sm text-muted-foreground">
              Order date: {data.order_date ?? "-"} · Expected: {data.expected_delivery_date ?? "-"}
            </div>
          </div>

          {writable ? (
            <div className="flex flex-wrap gap-2">
              {status === "draft" ? (
                <Button onClick={() => statusMutation.mutate("sent")} disabled={statusMutation.isPending}>
                  Mark sent
                </Button>
              ) : null}
              {status === "sent" ? (
                <Button onClick={() => statusMutation.mutate("confirmed")} disabled={statusMutation.isPending}>
                  Mark confirmed
                </Button>
              ) : null}
              {status === "confirmed" || status === "partially_received" ? (
                <Button onClick={() => receiveMutation.mutate()} disabled={receiveMutation.isPending}>
                  Mark received
                </Button>
              ) : null}
            </div>
          ) : null}

          {statusMutation.error || receiveMutation.error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {((statusMutation.error ?? receiveMutation.error) as Error).message}
            </div>
          ) : null}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Qty ordered</TableHead>
                  <TableHead>Qty received</TableHead>
                  <TableHead>Unit cost</TableHead>
                  <TableHead>Line total</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>
                      <div className="space-y-0.5">
                        <div className="text-sm font-medium">{line.product?.name ?? "-"}</div>
                        <div className="font-mono text-xs text-muted-foreground">{line.product?.sku ?? ""}</div>
                      </div>
                    </TableCell>
                    <TableCell>{Number(line.qty_ordered).toFixed(3)}</TableCell>
                    <TableCell>{Number(line.qty_received).toFixed(3)}</TableCell>
                    <TableCell>{Number(line.unit_cost).toFixed(2)}</TableCell>
                    <TableCell>{Number(line.line_total).toFixed(2)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent">
                          <MoreHorizontal className="h-4 w-4" aria-hidden />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => void handleExport([line])}>
                            Export row
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}

                {data.lines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                      No line items.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-end text-sm">
            <div className="text-muted-foreground">Total:</div>
            <div className="ml-2 font-medium">
              {(data.currency ? data.currency + " " : "") + Number(data.total_amount).toFixed(2)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}







