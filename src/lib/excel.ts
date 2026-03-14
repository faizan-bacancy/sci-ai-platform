import * as XLSX from "xlsx";
import { format } from "date-fns";

export type ExcelColumn<T> = {
  key: string;
  header: string;
  type?: "string" | "number" | "currency" | "date";
  value?: (row: T) => unknown;
};

export function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function formatISODate(value: Date | string | number | null | undefined) {
  if (!value && value !== 0) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return format(value, "yyyy-MM-dd");
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return "";
    const dt = new Date(parsed.y, parsed.m - 1, parsed.d);
    if (Number.isNaN(dt.getTime())) return "";
    return format(dt, "yyyy-MM-dd");
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const dt = new Date(trimmed);
    if (!Number.isNaN(dt.getTime())) return format(dt, "yyyy-MM-dd");
    return trimmed;
  }
  return "";
}

export function buildWorksheet<T>(rows: T[], columns: ExcelColumn<T>[]) {
  const headers = columns.map((c) => c.header);
  const dataRows = rows.map((row) =>
    columns.map((col) => {
      const raw = col.value ? col.value(row) : (row as Record<string, unknown>)[col.key];
      if (col.type === "date") return formatISODate(raw as string | number | Date);
      if (col.type === "currency") return raw === null || raw === undefined ? "" : Number(raw);
      if (col.type === "number") return raw === null || raw === undefined ? "" : Number(raw);
      return raw ?? "";
    }),
  );

  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);

  columns.forEach((col, cIdx) => {
    if (col.type !== "currency") return;
    for (let rIdx = 1; rIdx <= rows.length; rIdx += 1) {
      const cellRef = XLSX.utils.encode_cell({ r: rIdx, c: cIdx });
      const cell = worksheet[cellRef];
      if (!cell) continue;
      cell.t = "n";
      cell.z = "0.00";
    }
  });

  return worksheet;
}

export function addMetadataSheet(
  workbook: XLSX.WorkBook,
  metadata: Record<string, string | number | null | undefined>,
) {
  const rows = Object.entries(metadata).map(([key, value]) => [
    key,
    value ?? "",
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([["Key", "Value"], ...rows]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Metadata");
}

export function downloadWorkbook(workbook: XLSX.WorkBook, fileName: string) {
  XLSX.writeFile(workbook, fileName, { bookType: "xlsx" });
}

