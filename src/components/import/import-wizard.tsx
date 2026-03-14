"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

import { FileDropzone } from "@/components/import/file-dropzone";
import { ColumnMapper, type ColumnMapping } from "@/components/import/column-mapper";
import {
  ValidationPreviewTable,
  type CellErrorMap,
  type CellWarningMap,
} from "@/components/import/validation-preview-table";
import { ImportProgressBar } from "@/components/import/import-progress-bar";
import { ImportSummaryCard } from "@/components/import/import-summary-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/browser";
import { formatISODate, normalizeHeader } from "@/lib/excel";
import { importConfigs, importEntityOptions } from "@/lib/import/import-config";
import type { ImportEntity } from "@/lib/import/import-config";
import {
  inventoryImportSchema,
  productImportSchema,
  purchaseOrderImportSchema,
  purchaseOrderLineImportSchema,
  supplierImportSchema,
} from "@/lib/import/import-validation";

const BATCH_SIZE = 100;

type LookupData = {
  productsBySku: Map<string, { id: string; sku: string }>;
  warehousesByCode: Map<string, { id: string; code: string }>;
  suppliersByKey: Map<string, { id: string; company_name: string; country: string | null }>;
  suppliersByName: Map<string, { id: string; company_name: string; country: string | null }>;
  purchaseOrdersByNumber: Map<string, { id: string; po_number: string }>;
  inventoryKeys: Set<string>;
  poLineKeys: Set<string>;
  defaultWarehouseId: string | null;
};

type ValidEntry = {
  sourceIndex: number;
  row: Record<string, unknown>;
  isUpdate: boolean;
};

type FailedBatch = {
  index: number;
  entries: ValidEntry[];
  message: string;
};

type ReportRow = {
  row: number;
  errors: string;
  [key: string]: string | number | null | undefined;
};

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function keyOf(...parts: (string | null | undefined)[]) {
  return parts.map((p) => (p ?? "").toLowerCase()).join("|");
}

function rowErrorsToMessage(errors: Record<string, string>) {
  return Object.entries(errors)
    .map(([field, message]) => `${field}: ${message}`)
    .join("; ");
}

export function ImportWizard({
  defaultEntity = "products",
  allowedEntities,
  onCompleted,
}: {
  defaultEntity?: ImportEntity;
  allowedEntities?: ImportEntity[];
  onCompleted?: () => void;
}) {
  const allowed = useMemo(
    () =>
      (allowedEntities?.length ? allowedEntities : importEntityOptions.map((e) => e.key)).filter(
        (e) => importConfigs[e].importable,
      ),
    [allowedEntities],
  );

  const [step, setStep] = useState(1);
  const [entity, setEntity] = useState<ImportEntity>(defaultEntity);
  const [fileName, setFileName] = useState("");
  const [sourceColumns, setSourceColumns] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [mappedRows, setMappedRows] = useState<Record<string, unknown>[]>([]);
  const [validationErrors, setValidationErrors] = useState<CellErrorMap>({});
  const [validationWarnings, setValidationWarnings] = useState<CellWarningMap>({});
  const [validEntries, setValidEntries] = useState<ValidEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [isImporting, setIsImporting] = useState(false);
  const [currentBatch, setCurrentBatch] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [failedBatch, setFailedBatch] = useState<FailedBatch | null>(null);
  const [insertedCount, setInsertedCount] = useState(0);
  const [updatedCount, setUpdatedCount] = useState(0);

  const [summary, setSummary] = useState({
    processed: 0,
    inserted: 0,
    updated: 0,
    errors: 0,
  });
  const [reportRows, setReportRows] = useState<ReportRow[]>([]);

  useEffect(() => {
    if (!allowed.includes(entity)) {
      setEntity(allowed[0] ?? "products");
    }
  }, [allowed, entity]);

  const config = importConfigs[entity];

  const requiredFields = useMemo(
    () => config.fields.filter((f) => f.required).map((f) => f.key),
    [config.fields],
  );

  const previewColumns = useMemo(
    () => config.fields.map((f) => ({ key: f.key, label: f.label })),
    [config.fields],
  );

  const canProceedMapping = useMemo(() => {
    const mappedTargets = Object.values(mapping).filter((v) => !!v);
    return requiredFields.every((required) => mappedTargets.includes(required));
  }, [mapping, requiredFields]);

  const validRowsCount = validEntries.length;
  const updateRowsCount = validEntries.filter((entry) => entry.isUpdate).length;
  const validationErrorCount = Object.keys(validationErrors).length;

  function resetWizard(nextEntity?: ImportEntity) {
    if (nextEntity) setEntity(nextEntity);
    setStep(1);
    setFileName("");
    setSourceColumns([]);
    setRawRows([]);
    setMapping({});
    setMappedRows([]);
    setValidationErrors({});
    setValidationWarnings({});
    setValidEntries([]);
    setErrorMessage(null);
    setIsImporting(false);
    setCurrentBatch(0);
    setTotalBatches(0);
    setFailedBatch(null);
    setInsertedCount(0);
    setUpdatedCount(0);
    setSummary({ processed: 0, inserted: 0, updated: 0, errors: 0 });
    setReportRows([]);
  }

  function buildAutoMapping(headers: string[]) {
    const next: ColumnMapping = {};
    const targetMap = new Map<string, string>();

    config.fields.forEach((field) => {
      targetMap.set(normalizeHeader(field.label), field.key);
      (field.aliases ?? []).forEach((alias) => {
        targetMap.set(normalizeHeader(alias), field.key);
      });
    });

    headers.forEach((header) => {
      next[header] = targetMap.get(normalizeHeader(header)) ?? "";
    });

    return next;
  }

  async function handleFile(file: File) {
    setErrorMessage(null);

    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage("File is too large. Max size is 10MB.");
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "" }) as unknown[][];

      if (!matrix.length) {
        setErrorMessage("No data found in the uploaded file.");
        return;
      }

      const headers = matrix[0].map((value) => String(value ?? "").trim()).filter(Boolean);
      if (!headers.length) {
        setErrorMessage("The uploaded file must have a header row.");
        return;
      }

      const rows = matrix.slice(1).map((row) => {
        const obj: Record<string, unknown> = {};
        headers.forEach((header, colIndex) => {
          obj[header] = row[colIndex] ?? "";
        });
        return obj;
      });

      setFileName(file.name);
      setSourceColumns(headers);
      setRawRows(rows);
      setMapping(buildAutoMapping(headers));
      setStep(2);
    } catch {
      setErrorMessage("Unable to parse file. Please upload a valid .xlsx or .csv file.");
    }
  }

  async function loadLookups(): Promise<LookupData> {
    const supabase = createClient();

    const productsBySku = new Map<string, { id: string; sku: string }>();
    const warehousesByCode = new Map<string, { id: string; code: string }>();
    const suppliersByKey = new Map<string, { id: string; company_name: string; country: string | null }>();
    const suppliersByName = new Map<string, { id: string; company_name: string; country: string | null }>();
    const purchaseOrdersByNumber = new Map<string, { id: string; po_number: string }>();
    const inventoryKeys = new Set<string>();
    const poLineKeys = new Set<string>();

    const needsProducts = ["products", "inventory", "purchase_order_lines"].includes(entity);
    const needsWarehouses = ["inventory", "purchase_orders"].includes(entity);
    const needsSuppliers = ["suppliers", "purchase_orders"].includes(entity);
    const needsPurchaseOrders = ["purchase_orders", "purchase_order_lines"].includes(entity);

    if (needsProducts) {
      const { data } = await supabase.from("products").select("id,sku").limit(10000);
      (data ?? []).forEach((row: { id: string; sku: string }) => {
        productsBySku.set(row.sku.toUpperCase(), row);
      });
    }

    if (needsWarehouses) {
      const { data } = await supabase.from("warehouses").select("id,code").limit(5000);
      (data ?? []).forEach((row: { id: string; code: string }) => {
        warehousesByCode.set(row.code.toUpperCase(), row);
      });
    }

    if (needsSuppliers) {
      const { data } = await supabase
        .from("suppliers")
        .select("id,company_name,country")
        .limit(5000);
      (data ?? []).forEach((row: { id: string; company_name: string; country: string | null }) => {
        suppliersByName.set(row.company_name.toLowerCase(), row);
        suppliersByKey.set(keyOf(row.company_name, row.country), row);
      });
    }

    if (needsPurchaseOrders) {
      const { data } = await supabase.from("purchase_orders").select("id,po_number").limit(10000);
      (data ?? []).forEach((row: { id: string; po_number: string }) => {
        purchaseOrdersByNumber.set(row.po_number, row);
      });
    }

    if (entity === "inventory") {
      const { data } = await supabase.from("inventory").select("product_id,warehouse_id").limit(20000);
      (data ?? []).forEach((row: { product_id: string; warehouse_id: string }) => {
        inventoryKeys.add(keyOf(row.product_id, row.warehouse_id));
      });
    }

    if (entity === "purchase_order_lines") {
      const { data } = await supabase
        .from("purchase_order_lines")
        .select("purchase_order_id,product_id")
        .limit(20000);
      (data ?? []).forEach((row: { purchase_order_id: string; product_id: string }) => {
        poLineKeys.add(keyOf(row.purchase_order_id, row.product_id));
      });
    }

    const defaultWarehouse = Array.from(warehousesByCode.values()).find(
      (warehouse) => warehouse.code.toUpperCase() === "DEFAULT",
    );

    return {
      productsBySku,
      warehousesByCode,
      suppliersByKey,
      suppliersByName,
      purchaseOrdersByNumber,
      inventoryKeys,
      poLineKeys,
      defaultWarehouseId: defaultWarehouse?.id ?? Array.from(warehousesByCode.values())[0]?.id ?? null,
    };
  }

  async function handleValidate() {
    setErrorMessage(null);

    const lookups = await loadLookups();

    const mapped = rawRows.map((sourceRow) => {
      const row: Record<string, unknown> = {};
      sourceColumns.forEach((sourceHeader) => {
        const target = mapping[sourceHeader];
        if (!target) return;
        row[target] = sourceRow[sourceHeader];
      });
      if (row.order_date) row.order_date = formatISODate(row.order_date as string | number | Date);
      if (row.expected_delivery_date) {
        row.expected_delivery_date = formatISODate(row.expected_delivery_date as string | number | Date);
      }
      if (entity === "products" && typeof row.sku === "string") {
        row.sku = row.sku.toUpperCase();
      }
      if (entity === "inventory" && typeof row.sku === "string") {
        row.sku = row.sku.toUpperCase();
      }
      if (entity === "purchase_order_lines" && typeof row.sku === "string") {
        row.sku = row.sku.toUpperCase();
      }
      return row;
    });

    const errors: CellErrorMap = {};
    const warnings: CellWarningMap = {};
    const nextValidEntries: ValidEntry[] = [];

    const schema =
      entity === "products"
        ? productImportSchema
        : entity === "suppliers"
          ? supplierImportSchema
          : entity === "inventory"
            ? inventoryImportSchema
            : entity === "purchase_orders"
              ? purchaseOrderImportSchema
              : purchaseOrderLineImportSchema;

    mapped.forEach((row, sourceIndex) => {
      const rowErrors: Record<string, string> = {};
      const rowWarnings: Record<string, string> = {};
      let isUpdate = false;

      const parsed = schema.safeParse(row);
      if (!parsed.success) {
        parsed.error.issues.forEach((issue) => {
          const field = String(issue.path[0] ?? "_row");
          rowErrors[field] = issue.message;
        });
      }

      if (entity === "products") {
        const sku = String(row.sku ?? "").toUpperCase();
        if (lookups.productsBySku.has(sku)) {
          isUpdate = true;
          rowWarnings.sku = "SKU already exists. This row will update the existing record.";
        }
      }

      if (entity === "suppliers") {
        const key = keyOf(String(row.company_name ?? ""), String(row.country ?? ""));
        if (lookups.suppliersByKey.has(key)) {
          isUpdate = true;
          rowWarnings.company_name = "Supplier exists. This row will update the existing record.";
        }
      }

      if (entity === "inventory") {
        const sku = String(row.sku ?? "").toUpperCase();
        const warehouseCode = String(row.warehouse_code ?? "").toUpperCase();
        const product = lookups.productsBySku.get(sku);
        const warehouse = lookups.warehousesByCode.get(warehouseCode);

        if (!product) rowErrors.sku = "SKU does not exist.";
        if (!warehouse) rowErrors.warehouse_code = "Warehouse code does not exist.";

        if (product && warehouse && lookups.inventoryKeys.has(keyOf(product.id, warehouse.id))) {
          isUpdate = true;
          rowWarnings.sku = "Inventory row exists. This row will update the existing record.";
        }
      }

      if (entity === "purchase_orders") {
        const supplier = lookups.suppliersByName.get(String(row.supplier_name ?? "").toLowerCase());
        if (!supplier) rowErrors.supplier_name = "Supplier not found.";
        if (!lookups.defaultWarehouseId) {
          rowErrors._row = "No warehouse found. Create a warehouse before importing purchase orders.";
        }

        const po = String(row.po_number ?? "");
        if (lookups.purchaseOrdersByNumber.has(po)) {
          isUpdate = true;
          rowWarnings.po_number = "PO already exists. This row will update the existing record.";
        }
      }

      if (entity === "purchase_order_lines") {
        const po = lookups.purchaseOrdersByNumber.get(String(row.po_number ?? ""));
        const product = lookups.productsBySku.get(String(row.sku ?? "").toUpperCase());

        if (!po) rowErrors.po_number = "Purchase order not found.";
        if (!product) rowErrors.sku = "SKU does not exist.";

        if (po && product && lookups.poLineKeys.has(keyOf(po.id, product.id))) {
          isUpdate = true;
          rowWarnings.sku = "Line already exists. This row will update the existing record.";
        }
      }

      if (Object.keys(rowErrors).length > 0) {
        errors[sourceIndex] = rowErrors;
      } else {
        nextValidEntries.push({ sourceIndex, row, isUpdate });
      }

      if (Object.keys(rowWarnings).length > 0) {
        warnings[sourceIndex] = rowWarnings;
      }
    });

    setMappedRows(mapped);
    setValidationErrors(errors);
    setValidationWarnings(warnings);
    setValidEntries(nextValidEntries);
    setStep(3);
  }

  function mapBatchToPayload(batch: ValidEntry[], lookups: LookupData) {
    return batch.map((entry) => {
      const row = entry.row;

      if (entity === "products") {
        return {
          sku: String(row.sku).toUpperCase(),
          name: row.name,
          category: row.category ? String(row.category) : null,
          unit_of_measure: row.unit_of_measure ? String(row.unit_of_measure).toLowerCase() : null,
          unit_cost: Number(row.unit_cost ?? 0),
          selling_price: row.selling_price ? Number(row.selling_price) : null,
          lead_time_days: Number(row.lead_time_days ?? 0),
          minimum_order_quantity: Number(row.min_order_qty ?? 1),
        };
      }

      if (entity === "suppliers") {
        return {
          company_name: row.company_name,
          contact_name: row.contact_person ? String(row.contact_person) : null,
          contact_email: row.contact_email ? String(row.contact_email) : null,
          country: row.country,
          city: row.city ? String(row.city) : null,
          payment_terms: row.payment_terms ? String(row.payment_terms) : null,
          currency: row.currency ? String(row.currency) : null,
          rating: row.rating ? Number(row.rating) : null,
        };
      }

      if (entity === "inventory") {
        const product = lookups.productsBySku.get(String(row.sku).toUpperCase());
        const warehouse = lookups.warehousesByCode.get(String(row.warehouse_code).toUpperCase());
        return {
          product_id: product?.id,
          warehouse_id: warehouse?.id,
          qty_on_hand: Number(row.quantity_on_hand ?? 0),
          unit_cost: row.unit_cost ? Number(row.unit_cost) : null,
        };
      }

      if (entity === "purchase_orders") {
        const supplier = lookups.suppliersByName.get(String(row.supplier_name ?? "").toLowerCase());
        return {
          po_number: row.po_number,
          supplier_id: supplier?.id,
          warehouse_id: lookups.defaultWarehouseId,
          status: row.status ? String(row.status) : "draft",
          order_date: row.order_date ? String(row.order_date) : null,
          expected_delivery_date: row.expected_delivery_date
            ? String(row.expected_delivery_date)
            : null,
        };
      }

      const po = lookups.purchaseOrdersByNumber.get(String(row.po_number ?? ""));
      const product = lookups.productsBySku.get(String(row.sku).toUpperCase());
      return {
        purchase_order_id: po?.id,
        product_id: product?.id,
        qty_ordered: Number(row.quantity_ordered ?? 0),
        unit_cost: Number(row.unit_cost ?? 0),
      };
    });
  }

  async function upsertBatch(payload: Record<string, unknown>[]) {
    const supabase = createClient();

    if (entity === "products") {
      const result = await supabase.from("products").upsert(payload, { onConflict: "sku" });
      return result.error;
    }

    if (entity === "suppliers") {
      const result = await supabase
        .from("suppliers")
        .upsert(payload, { onConflict: "company_name,country" });
      return result.error;
    }

    if (entity === "inventory") {
      const result = await supabase
        .from("inventory")
        .upsert(payload, { onConflict: "product_id,warehouse_id" });
      return result.error;
    }

    if (entity === "purchase_orders") {
      const result = await supabase
        .from("purchase_orders")
        .upsert(payload, { onConflict: "po_number" });
      return result.error;
    }

    const result = await supabase
      .from("purchase_order_lines")
      .upsert(payload, { onConflict: "purchase_order_id,product_id" });
    return result.error;
  }

  function buildValidationReportRows(rows: Record<string, unknown>[], errors: CellErrorMap): ReportRow[] {
    return Object.entries(errors).map(([indexText, rowErrors]) => {
      const index = Number(indexText);
      return {
        row: index + 2,
        errors: rowErrorsToMessage(rowErrors),
        ...rows[index],
      };
    });
  }

  async function finalizeImport({
    status,
    inserted,
    updated,
    extraRows,
    failedBatchInfo,
  }: {
    status: "completed" | "partial" | "failed";
    inserted: number;
    updated: number;
    extraRows?: ReportRow[];
    failedBatchInfo?: FailedBatch | null;
  }) {
    const processed = mappedRows.length;
    const rowsWithErrors = validationErrorCount + (extraRows?.length ?? 0);
    const summaryNext = {
      processed,
      inserted,
      updated,
      errors: rowsWithErrors,
    };

    const validationRows = buildValidationReportRows(mappedRows, validationErrors);
    const report = [...validationRows, ...(extraRows ?? [])];

    setSummary(summaryNext);
    setReportRows(report);
    setStep(5);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user?.id) {
      await supabase.from("import_runs").insert({
        user_id: user.id,
        entity_type: entity,
        file_name: fileName,
        total_rows: processed,
        inserted_rows: summaryNext.inserted,
        updated_rows: summaryNext.updated,
        error_rows: summaryNext.errors,
        status,
        error_details: {
          validation_errors: validationErrors,
          failed_batch: failedBatchInfo?.index ?? null,
          failed_batch_error: failedBatchInfo?.message ?? null,
        },
      });
    }

    onCompleted?.();
  }

  async function runImport() {
    setErrorMessage(null);
    setFailedBatch(null);
    setIsImporting(true);
    setInsertedCount(0);
    setUpdatedCount(0);

    const lookups = await loadLookups();
    const batches = chunk(validEntries, BATCH_SIZE);
    setTotalBatches(batches.length);

    let inserted = 0;
    let updated = 0;

    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      setCurrentBatch(index + 1);

      const payload = mapBatchToPayload(batch, lookups);
      const error = await upsertBatch(payload);

      if (error) {
        setFailedBatch({ index, entries: batch, message: error.message });
        setErrorMessage(error.message);
        setIsImporting(false);
        setInsertedCount(inserted);
        setUpdatedCount(updated);
        return;
      }

      const batchUpdated = batch.filter((entry) => entry.isUpdate).length;
      const batchInserted = batch.length - batchUpdated;
      inserted += batchInserted;
      updated += batchUpdated;
      setInsertedCount(inserted);
      setUpdatedCount(updated);
    }

    setIsImporting(false);
    await finalizeImport({
      status: validationErrorCount > 0 ? "partial" : "completed",
      inserted,
      updated,
    });
  }

  async function retryFailedBatch() {
    if (!failedBatch) return;

    setIsImporting(true);
    const lookups = await loadLookups();
    const payload = mapBatchToPayload(failedBatch.entries, lookups);
    const error = await upsertBatch(payload);

    if (error) {
      setErrorMessage(error.message);
      setFailedBatch({ ...failedBatch, message: error.message });
      setIsImporting(false);
      return;
    }

    const retryUpdated = failedBatch.entries.filter((entry) => entry.isUpdate).length;
    const retryInserted = failedBatch.entries.length - retryUpdated;
    const finalInserted = insertedCount + retryInserted;
    const finalUpdated = updatedCount + retryUpdated;

    setInsertedCount(finalInserted);
    setUpdatedCount(finalUpdated);
    setFailedBatch(null);
    setErrorMessage(null);
    setIsImporting(false);

    await finalizeImport({
      status: validationErrorCount > 0 ? "partial" : "completed",
      inserted: finalInserted,
      updated: finalUpdated,
    });
  }

  function downloadErrorReport() {
    if (!reportRows.length) return;

    const sheet = XLSX.utils.json_to_sheet(reportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Errors");
    XLSX.writeFile(workbook, `${entity}_import_errors_${formatISODate(new Date())}.xlsx`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import {config.label}</CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">
        {step === 1 ? (
          <div className="space-y-4">
            <Select
              value={entity}
              onValueChange={(next) => {
                resetWizard(next as ImportEntity);
              }}
            >
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue placeholder="Select entity" />
              </SelectTrigger>
              <SelectContent>
                {importEntityOptions
                  .filter((option) => option.importable && allowed.includes(option.key))
                  .map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>

            <FileDropzone onFileAccepted={handleFile} error={errorMessage} />
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <ColumnMapper
              sourceColumns={sourceColumns}
              targetFields={config.fields.map((field) => ({ key: field.key, label: field.label }))}
              mapping={mapping}
              onChange={setMapping}
              requiredFields={requiredFields}
            />

            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => resetWizard()}>
                Start over
              </Button>
              <Button disabled={!canProceedMapping} onClick={handleValidate}>
                Continue
              </Button>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-4">
            <div className="rounded-md border p-3 text-sm text-muted-foreground">
              {validRowsCount} rows will be imported. {updateRowsCount} rows will update existing records. {validationErrorCount} rows have errors and will be skipped.
            </div>

            <ValidationPreviewTable
              columns={previewColumns}
              rows={mappedRows.slice(0, 50)}
              errors={validationErrors}
              warnings={validationWarnings}
            />

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button disabled={validRowsCount === 0} onClick={() => setStep(4)}>
                Proceed with valid rows
              </Button>
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="space-y-4">
            {isImporting ? (
              <ImportProgressBar current={currentBatch} total={totalBatches} />
            ) : (
              <div className="text-sm text-muted-foreground">
                Ready to import {validRowsCount} rows in batches of {BATCH_SIZE}.
              </div>
            )}

            {errorMessage ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {errorMessage}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={isImporting} onClick={() => setStep(3)}>
                Back
              </Button>
              {!failedBatch ? (
                <Button disabled={isImporting || validRowsCount === 0} onClick={runImport}>
                  Start import
                </Button>
              ) : (
                <Button disabled={isImporting} onClick={retryFailedBatch}>
                  Retry failed batch {failedBatch.index + 1}
                </Button>
              )}
            </div>
          </div>
        ) : null}

        {step === 5 ? (
          <div className="space-y-4">
            <ImportSummaryCard
              processed={summary.processed}
              inserted={summary.inserted}
              updated={summary.updated}
              errors={summary.errors}
              onDownloadErrors={summary.errors > 0 ? downloadErrorReport : undefined}
            />

            <Button variant="secondary" onClick={() => resetWizard()}>
              Import another file
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}


