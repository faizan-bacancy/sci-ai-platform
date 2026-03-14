import { z } from "zod";

export const supplierFormSchema = z.object({
  company_name: z.string().trim().min(1, "Company name is required."),
  contact_name: z.string().trim().optional().nullable(),
  contact_email: z
    .string()
    .trim()
    .email("Invalid email.")
    .optional()
    .nullable()
    .or(z.literal("")),
  contact_phone: z.string().trim().optional().nullable(),
  country: z.string().trim().optional().nullable(),
  city: z.string().trim().optional().nullable(),
  payment_terms: z.string().trim().optional().nullable(),
  currency: z.string().trim().optional().nullable(),
  rating: z.coerce.number().int().min(1).max(5).optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  is_active: z.boolean().default(true),
});

export type SupplierFormInput = z.input<typeof supplierFormSchema>;
export type SupplierFormValues = z.infer<typeof supplierFormSchema>;

export type SupplierRow = {
  id: string;
  company_name: string;
  contact_name: string | null;
  country: string | null;
  rating: number | null;
  is_active: boolean;
};

export type SupplierProductRow = {
  id: string;
  supplier_id: string;
  product_id: string;
  supplier_sku: string | null;
  unit_cost: number;
  lead_time_days: number;
  minimum_order_quantity: number;
  is_preferred: boolean;
  product?: { id: string; sku: string; name: string };
};