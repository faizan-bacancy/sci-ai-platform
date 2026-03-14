export type ImportEntity =
  | "products"
  | "suppliers"
  | "inventory"
  | "purchase_orders"
  | "purchase_order_lines"
  | "demand_history";

export type ImportFieldType = "string" | "number" | "currency" | "date";

export type ImportField = {
  key: string;
  label: string;
  type: ImportFieldType;
  required?: boolean;
  description: string;
  example?: string | number;
  aliases?: string[];
};

export type ImportEntityConfig = {
  key: ImportEntity;
  label: string;
  templateFileName: string;
  importable: boolean;
  fields: ImportField[];
};

export const importConfigs: Record<ImportEntity, ImportEntityConfig> = {
  products: {
    key: "products",
    label: "Products",
    templateFileName: "products_template",
    importable: true,
    fields: [
      {
        key: "name",
        label: "name",
        type: "string",
        required: true,
        description: "Product name (max 200 characters).",
        example: "Aluminum Sheet 2mm",
        aliases: ["product name", "product"],
      },
      {
        key: "sku",
        label: "sku",
        type: "string",
        required: true,
        description: "Unique SKU, uppercase, no spaces (max 50 characters).",
        example: "ALU-2MM-SHEET",
        aliases: ["product sku", "item sku"],
      },
      {
        key: "category",
        label: "category",
        type: "string",
        description: "Optional category name.",
        example: "Raw Materials",
      },
      {
        key: "unit_of_measure",
        label: "unit_of_measure",
        type: "string",
        required: true,
        description: "Allowed: each, kg, g, litre, ml, box, pallet, metre.",
        example: "kg",
        aliases: ["uom", "unit", "unit of measure"],
      },
      {
        key: "unit_cost",
        label: "unit_cost",
        type: "currency",
        required: true,
        description: "Positive number with 2 decimals.",
        example: 12.5,
      },
      {
        key: "selling_price",
        label: "selling_price",
        type: "currency",
        description: "Optional positive number > unit_cost.",
        example: 18.0,
      },
      {
        key: "lead_time_days",
        label: "lead_time_days",
        type: "number",
        required: true,
        description: "Positive integer lead time in days.",
        example: 14,
        aliases: ["lead time", "lead time days"],
      },
      {
        key: "min_order_qty",
        label: "min_order_qty",
        type: "number",
        required: true,
        description: "Positive integer minimum order quantity (default 1).",
        example: 1,
        aliases: ["minimum order qty", "minimum order quantity", "moq"],
      },
    ],
  },
  suppliers: {
    key: "suppliers",
    label: "Suppliers",
    templateFileName: "suppliers_template",
    importable: true,
    fields: [
      {
        key: "company_name",
        label: "company_name",
        type: "string",
        required: true,
        description: "Supplier company name (max 200 characters).",
        example: "Delta Metals",
        aliases: ["company", "supplier"],
      },
      {
        key: "contact_person",
        label: "contact_person",
        type: "string",
        description: "Primary contact name.",
        example: "Priya Sharma",
        aliases: ["contact", "contact name"],
      },
      {
        key: "contact_email",
        label: "contact_email",
        type: "string",
        description: "Valid email address.",
        example: "priya@deltametals.com",
      },
      {
        key: "country",
        label: "country",
        type: "string",
        required: true,
        description: "Country name.",
        example: "India",
      },
      {
        key: "city",
        label: "city",
        type: "string",
        description: "City name.",
        example: "Pune",
      },
      {
        key: "payment_terms",
        label: "payment_terms",
        type: "string",
        description: "Payment terms (e.g., Net 30).",
        example: "Net 30",
      },
      {
        key: "currency",
        label: "currency",
        type: "string",
        description: "Preferred currency code.",
        example: "USD",
      },
      {
        key: "rating",
        label: "rating",
        type: "number",
        description: "Integer rating 1–5.",
        example: 4,
      },
    ],
  },
  inventory: {
    key: "inventory",
    label: "Inventory",
    templateFileName: "inventory_template",
    importable: true,
    fields: [
      {
        key: "sku",
        label: "sku",
        type: "string",
        required: true,
        description: "Product SKU (must already exist).",
        example: "ALU-2MM-SHEET",
      },
      {
        key: "warehouse_code",
        label: "warehouse_code",
        type: "string",
        required: true,
        description: "Warehouse code (must already exist).",
        example: "DEFAULT",
        aliases: ["warehouse", "warehouse id", "warehouse code"],
      },
      {
        key: "quantity_on_hand",
        label: "quantity_on_hand",
        type: "number",
        required: true,
        description: "Non-negative integer quantity on hand.",
        example: 120,
        aliases: ["qty on hand", "on hand"],
      },
      {
        key: "unit_cost",
        label: "unit_cost",
        type: "currency",
        description: "Optional positive unit cost.",
        example: 12.5,
      },
    ],
  },
  purchase_orders: {
    key: "purchase_orders",
    label: "Purchase Orders",
    templateFileName: "purchase_orders_template",
    importable: true,
    fields: [
      {
        key: "po_number",
        label: "po_number",
        type: "string",
        required: true,
        description: "Purchase order number (unique).",
        example: "PO-2026-0042",
        aliases: ["po #", "po number"],
      },
      {
        key: "supplier_name",
        label: "supplier_name",
        type: "string",
        required: true,
        description: "Supplier company name (must exist).",
        example: "Delta Metals",
      },
      {
        key: "order_date",
        label: "order_date",
        type: "date",
        required: true,
        description: "Order date (YYYY-MM-DD).",
        example: "2026-03-01",
      },
      {
        key: "expected_delivery_date",
        label: "expected_delivery_date",
        type: "date",
        description: "Expected delivery date (YYYY-MM-DD).",
        example: "2026-03-10",
      },
      {
        key: "status",
        label: "status",
        type: "string",
        description: "Status (draft, sent, confirmed, received, cancelled).",
        example: "draft",
      },
    ],
  },
  purchase_order_lines: {
    key: "purchase_order_lines",
    label: "Purchase Order Lines",
    templateFileName: "purchase_order_lines_template",
    importable: true,
    fields: [
      {
        key: "po_number",
        label: "po_number",
        type: "string",
        required: true,
        description: "Existing purchase order number.",
        example: "PO-2026-0042",
      },
      {
        key: "sku",
        label: "sku",
        type: "string",
        required: true,
        description: "Product SKU (must exist).",
        example: "ALU-2MM-SHEET",
      },
      {
        key: "quantity_ordered",
        label: "quantity_ordered",
        type: "number",
        required: true,
        description: "Positive integer quantity ordered.",
        example: 250,
      },
      {
        key: "unit_cost",
        label: "unit_cost",
        type: "currency",
        required: true,
        description: "Positive unit cost.",
        example: 12.5,
      },
    ],
  },
  demand_history: {
    key: "demand_history",
    label: "Demand History",
    templateFileName: "demand_history_template",
    importable: false,
    fields: [
      {
        key: "date",
        label: "date",
        type: "date",
        required: true,
        description: "Sales date (YYYY-MM-DD).",
        example: "2025-12-31",
      },
      {
        key: "sku",
        label: "sku",
        type: "string",
        required: true,
        description: "Product SKU.",
        example: "ALU-2MM-SHEET",
      },
      {
        key: "quantity_sold",
        label: "quantity_sold",
        type: "number",
        required: true,
        description: "Quantity sold (positive integer).",
        example: 180,
      },
      {
        key: "location_code",
        label: "location_code",
        type: "string",
        required: true,
        description: "Location or warehouse code.",
        example: "DEFAULT",
      },
    ],
  },
};

export const importEntityOptions = Object.values(importConfigs);

