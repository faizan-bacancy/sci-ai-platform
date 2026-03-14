"use client";

/* eslint-disable react-hooks/incompatible-library */

import {
  type ColumnDef,
  type OnChangeFn,
  type RowSelectionState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function DataTable<TData>({
  columns,
  data,
  isLoading,
  sorting,
  onSortingChange,
  rowSelection,
  onRowSelectionChange,
  pageIndex,
  pageCount,
  onPageChange,
  onRowClick,
  emptyMessage = "No results.",
  className,
  toolbar,
}: {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  isLoading?: boolean;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  pageIndex: number;
  pageCount: number;
  onPageChange: (nextIndex: number) => void;
  onRowClick?: (row: TData) => void;
  emptyMessage?: string;
  className?: string;
  toolbar?: React.ReactNode;
}) {
  const selectable = !!onRowSelectionChange;

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      ...(selectable ? { rowSelection: rowSelection ?? {} } : {}),
    },
    onSortingChange,
    onRowSelectionChange: selectable ? onRowSelectionChange : undefined,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    pageCount,
    enableRowSelection: selectable,
  });

  return (
    <div className={cn("space-y-3", className)}>
      {toolbar ? <div className="flex flex-wrap items-center justify-between gap-2">{toolbar}</div> : null}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  {columns.map((_, j) => (
                    <TableCell key={`skeleton-${i}-${j}`}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={
                    selectable && row.getIsSelected() ? "selected" : undefined
                  }
                  className={onRowClick ? "cursor-pointer" : undefined}
                  onClick={() => (onRowClick ? onRowClick(row.original) : null)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          Page {Math.min(pageIndex + 1, Math.max(pageCount, 1))} of {Math.max(pageCount, 1)}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(Math.max(pageIndex - 1, 0))}
            disabled={pageIndex <= 0}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(Math.min(pageIndex + 1, pageCount - 1))}
            disabled={pageIndex >= pageCount - 1}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
