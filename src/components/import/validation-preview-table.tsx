"use client";

import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type CellErrorMap = Record<number, Record<string, string>>;
export type CellWarningMap = Record<number, Record<string, string>>;

export function ValidationPreviewTable({
  columns,
  rows,
  errors,
  warnings,
}: {
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  errors: CellErrorMap;
  warnings?: CellWarningMap;
}) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            {columns.map((col) => (
              <TableHead key={col.key}>{col.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, idx) => {
            const rowErrors = errors[idx] ?? {};
            const rowWarnings = warnings?.[idx] ?? {};
            const hasErrors = Object.keys(rowErrors).length > 0;
            return (
              <TableRow key={idx} className={hasErrors ? "bg-destructive/5" : undefined}>
                <TableCell className="w-24">
                  {hasErrors ? (
                    <span className="inline-flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Invalid
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Valid
                    </span>
                  )}
                </TableCell>
                {columns.map((col) => {
                  const value = row[col.key];
                  const err = rowErrors[col.key];
                  const warn = rowWarnings[col.key];
                  return (
                    <TableCell key={col.key} className={cn(err ? "text-destructive" : undefined)}>
                      <div className="text-sm">
                        {value === null || value === undefined || value === "" ? "—" : String(value)}
                      </div>
                      {err ? <div className="text-xs text-destructive">{err}</div> : null}
                      {!err && warn ? (
                        <div className="text-xs text-amber-600">{warn}</div>
                      ) : null}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
