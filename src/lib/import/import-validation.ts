import { z } from "zod";

const UOM_VALUES = [
  "each",
  "kg",
  "g",
  "litre",
  "ml",
  "box",
  "pallet",
  "metre",
] as const;

const PO_STATUS_VALUES = [
  "draft",
  "sent",
  "confirmed",
  "received",
  "cancelled",
  "partially_received",
] as const;

function isTwoDecimalNumber(value: number) {
  return Number.isInteger(value * 100);
}

function normalizeOptionalInput(value: unknown) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

const requiredCurrency = (fieldLabel: string) =>
  z.coerce
    .number()
    .positive(`${fieldLabel} must be positive.`)
    .refine(isTwoDecimalNumber, `${fieldLabel} must have at most 2 decimal places.`);

const optionalCurrency = (fieldLabel: string) =>
  z.preprocess(
    normalizeOptionalInput,
    z
      .coerce
      .number()
      .positive(`${fieldLabel} must be positive.`)
      .refine(isTwoDecimalNumber, `${fieldLabel} must have at most 2 decimal places.`)
      .optional(),
  );

const optionalInt = (fieldLabel: string, min: number, max?: number) =>
  z.preprocess(
    normalizeOptionalInput,
    z
      .coerce
      .number()
      .int(`${fieldLabel} must be a whole number.`)
      .min(min, `${fieldLabel} must be at least ${min}.`)
      .pipe(
        max !== undefined
          ? z.number().max(max, `${fieldLabel} must be at most ${max}.`)
          : z.number(),
      )
      .optional(),
  );

export const productImportSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(200),
    sku: z
      .string()
      .trim()
      .min(1, "SKU is required.")
      .max(50)
      .regex(/^[A-Z0-9-_]+$/, "SKU must be uppercase with no spaces."),
    category: z.preprocess(normalizeOptionalInput, z.string().trim().optional()),
    unit_of_measure: z
      .string()
      .trim()
      .toLowerCase()
      .refine((v) => UOM_VALUES.includes(v as (typeof UOM_VALUES)[number]), {
        message: "Unit of measure must be a valid value.",
      }),
    unit_cost: requiredCurrency("Unit cost"),
    selling_price: optionalCurrency("Selling price"),
    lead_time_days: z.coerce
      .number()
      .int("Lead time must be a whole number.")
      .positive("Lead time must be positive."),
    min_order_qty: z.preprocess(
      (value) => {
        const normalized = normalizeOptionalInput(value);
        return normalized === undefined ? 1 : normalized;
      },
      z.coerce
        .number()
        .int("Minimum order qty must be a whole number.")
        .positive("Minimum order qty must be positive."),
    ),
  })
  .superRefine((data, ctx) => {
    if (
      data.selling_price !== undefined &&
      data.selling_price !== null &&
      data.selling_price <= data.unit_cost
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["selling_price"],
        message: "Selling price must be greater than unit cost.",
      });
    }
  });

export const supplierImportSchema = z.object({
  company_name: z.string().trim().min(1, "Company name is required.").max(200),
  contact_person: z.preprocess(normalizeOptionalInput, z.string().trim().optional()),
  contact_email: z.preprocess(
    normalizeOptionalInput,
    z.string().trim().email("Invalid email.").optional(),
  ),
  country: z.string().trim().min(1, "Country is required."),
  city: z.preprocess(normalizeOptionalInput, z.string().trim().optional()),
  payment_terms: z.preprocess(normalizeOptionalInput, z.string().trim().optional()),
  currency: z.preprocess(normalizeOptionalInput, z.string().trim().optional()),
  rating: optionalInt("Rating", 1, 5),
});

export const inventoryImportSchema = z.object({
  sku: z.string().trim().min(1, "SKU is required."),
  warehouse_code: z.string().trim().min(1, "Warehouse code is required."),
  quantity_on_hand: z.coerce
    .number()
    .int("Quantity must be a whole number.")
    .min(0, "Quantity must be non-negative."),
  unit_cost: optionalCurrency("Unit cost"),
});

export const purchaseOrderImportSchema = z.object({
  po_number: z.string().trim().min(1, "PO number is required."),
  supplier_name: z.string().trim().min(1, "Supplier name is required."),
  order_date: z.string().trim().min(1, "Order date is required."),
  expected_delivery_date: z.preprocess(normalizeOptionalInput, z.string().trim().optional()),
  status: z
    .preprocess(normalizeOptionalInput, z.string().trim().toLowerCase().optional())
    .refine((value) => value === undefined || PO_STATUS_VALUES.includes(value as (typeof PO_STATUS_VALUES)[number]), {
      message: "Status must be one of: draft, sent, confirmed, partially_received, received, cancelled.",
    }),
});

export const purchaseOrderLineImportSchema = z.object({
  po_number: z.string().trim().min(1, "PO number is required."),
  sku: z.string().trim().min(1, "SKU is required."),
  quantity_ordered: z.coerce
    .number()
    .int("Quantity must be a whole number.")
    .positive("Quantity must be positive."),
  unit_cost: requiredCurrency("Unit cost"),
});


