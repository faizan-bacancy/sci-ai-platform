import * as XLSX from "xlsx";
import { importConfigs } from "./import-config";
import type { ImportEntity } from "./import-config";

export function generateTemplateWorkbook(entity: ImportEntity) {
  const config = importConfigs[entity];
  const headers = config.fields.map((f) => f.label);
  const mainSheet = XLSX.utils.aoa_to_sheet([headers]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, mainSheet, "Template");

  const instructionsRows = config.fields.map((field) => [
    field.label,
    field.required ? "Required" : "Optional",
    field.description,
    field.example ?? "",
  ]);
  const instructionsSheet = XLSX.utils.aoa_to_sheet([
    ["Column", "Required", "Description", "Example"],
    ...instructionsRows,
  ]);
  XLSX.utils.book_append_sheet(workbook, instructionsSheet, "Instructions");

  const exampleRow = config.fields.map((field) => field.example ?? "");
  const examplesSheet = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
  XLSX.utils.book_append_sheet(workbook, examplesSheet, "Examples");

  return workbook;
}
