import { z } from "zod";

export const purchaseOrderLineSchema = z.object({
  product_id: z.string().uuid("Product is required."),
  qty_ordered: z.coerce.number().positive("Quantity must be > 0."),
  unit_cost: z.coerce.number().min(0, "Unit cost must be >= 0."),
});

export const purchaseOrderCreateSchema = z.object({
  supplier_id: z.string().uuid("Supplier is required."),
  warehouse_id: z.string().uuid("Warehouse is required."),
  order_date: z.string().optional().nullable(),
  expected_delivery_date: z.string().optional().nullable(),
  currency: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  lines: z.array(purchaseOrderLineSchema).min(1, "Add at least one line item."),
});

export type PurchaseOrderCreateInput = z.input<typeof purchaseOrderCreateSchema>;
export type PurchaseOrderCreateValues = z.infer<typeof purchaseOrderCreateSchema>;

export type PurchaseOrderRow = {
  id: string;
  po_number: string;
  status: string;
  order_date: string | null;
  expected_delivery_date: string | null;
  total_amount: number;
  currency: string | null;
  supplier_id: string;
  warehouse_id: string;
  supplier?: { company_name: string };
  warehouse?: { name: string };
  purchase_order_lines?: { id: string }[];
};

type PurchaseOrderLineRow = {
  id: string;
  purchase_order_id: string;
  product_id: string;
  qty_ordered: number;
  qty_received: number;
  unit_cost: number;
  line_total: number;
  product?: { name: string; sku: string };
};

export type PurchaseOrderDetail = PurchaseOrderRow & {
  lines: PurchaseOrderLineRow[];
};