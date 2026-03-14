import { z } from "zod";

export const productFormSchema = z.object({
  sku: z.string().trim().min(1, "SKU is required."),
  name: z.string().trim().min(1, "Name is required."),
  description: z.string().trim().optional().nullable(),
  category: z.string().trim().optional().nullable(),
  unit_of_measure: z.string().trim().optional().nullable(),
  unit_cost: z.coerce.number().min(0, "Unit cost must be >= 0."),
  selling_price: z.coerce.number().min(0, "Selling price must be >= 0."),
  minimum_order_quantity: z.coerce
    .number()
    .min(0, "Minimum order quantity must be >= 0."),
  lead_time_days: z.coerce
    .number()
    .int("Lead time must be a whole number.")
    .min(0, "Lead time must be >= 0."),
  image_url: z
    .string()
    .trim()
    .url("Image URL must be a valid URL.")
    .optional()
    .nullable()
    .or(z.literal("")),
  is_active: z.boolean().default(true),
});

export type ProductFormInput = z.input<typeof productFormSchema>;
export type ProductFormValues = z.infer<typeof productFormSchema>;

export type ProductRow = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  unit_of_measure: string | null;
  unit_cost: number;
  is_active: boolean;
  inventory?: { qty_on_hand: number }[];
};