"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type ColumnMapping = Record<string, string>;
const IGNORE_VALUE = "__ignore__";

export function ColumnMapper({
  sourceColumns,
  targetFields,
  mapping,
  onChange,
  requiredFields,
}: {
  sourceColumns: string[];
  targetFields: { key: string; label: string }[];
  mapping: ColumnMapping;
  onChange: (next: ColumnMapping) => void;
  requiredFields: string[];
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {sourceColumns.map((source) => {
          const mapped = mapping[source] ?? "";
          const isRequired = requiredFields.includes(mapped);
          return (
            <div key={source} className="rounded-lg border p-3">
              <div className="text-sm font-medium">{source}</div>
              <div className="mt-2">
                <Select
                  value={mapped || IGNORE_VALUE}
                  onValueChange={(value) => {
                    const normalized = value && value !== IGNORE_VALUE ? value : "";
                    const next: ColumnMapping = {
                      ...mapping,
                      [source]: normalized,
                    };
                    onChange(next);
                  }}
                >
                  <SelectTrigger
                    className={cn(
                      "w-full",
                      !mapped ? "border-destructive/50" : undefined,
                    )}
                  >
                    <SelectValue placeholder="Map to field" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={IGNORE_VALUE}>Ignore column</SelectItem>
                    {targetFields.map((field) => (
                      <SelectItem key={field.key} value={field.key}>
                        {field.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!mapped ? (
                  <div className="mt-1 text-xs text-destructive">Not mapped</div>
                ) : isRequired ? (
                  <div className="mt-1 text-xs text-muted-foreground">Required</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
