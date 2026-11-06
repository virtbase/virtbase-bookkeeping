import type {
  Column,
  ColumnDef,
  RowData,
  Table as TanstackTable,
} from "@tanstack/react-table";
import { flexRender } from "@tanstack/react-table";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  ChevronUp,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { DataTableFeatures } from "./features.ts";

export type AppColumn<TData extends RowData> = ColumnDef<
  DataTableFeatures,
  TData,
  unknown
>;

interface SortHeaderProps<TData extends RowData> {
  column: Column<DataTableFeatures, TData, unknown>;
  label: string;
  align?: "left" | "right";
}

export function SortHeader<TData extends RowData>({
  column,
  label,
  align = "left",
}: SortHeaderProps<TData>) {
  "use no memo";

  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      className={cn(
        "-mx-2 inline-flex h-8 items-center gap-1 rounded-md px-2 font-medium hover:bg-accent",
        align === "right" && "w-full justify-end",
      )}
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {label}
      {sorted === "desc" ? (
        <ChevronDown className="size-4 text-muted-foreground" />
      ) : sorted === "asc" ? (
        <ChevronUp className="size-4 text-muted-foreground" />
      ) : (
        <ChevronsUpDown className="size-4 text-muted-foreground" />
      )}
    </button>
  );
}

interface DataTableProps<TData extends RowData> {
  table: TanstackTable<DataTableFeatures, TData>;
  empty: ReactNode;
  footer: ReactNode;
}

export function DataTable<TData extends RowData>({
  table,
  empty,
  footer,
}: DataTableProps<TData>) {
  "use no memo";

  const rows = table.getRowModel().rows;
  const { pageIndex, pageSize } = table.store.state.pagination;
  const columnCount = table.getAllColumns().length;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="overflow-x-auto rounded-md border">
        <Table className="min-w-[880px] table-fixed">
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    style={{ width: header.column.columnDef.size || undefined }}
                    className="h-10 px-2 font-medium first:pl-3"
                  >
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
            {rows.length > 0 ? (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                >
                  {row.getAllCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className="h-10 truncate px-2 py-0 first:pl-3"
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={columnCount}
                  className="h-32 text-center text-muted-foreground"
                >
                  {empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 px-1 text-muted-foreground text-sm">
        <span>{footer}</span>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap">Zeilen pro Seite</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => table.setPageSize(Number(value))}
            >
              <SelectTrigger className="h-8 w-18">
                <SelectValue />
              </SelectTrigger>
              <SelectContent side="top">
                {[25, 50, 100, 200].map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="tabular-nums">
            Seite {pageIndex + 1} von {Math.max(table.getPageCount(), 1)}
          </span>
          <div className="flex items-center gap-1">
            <Button
              aria-label="Erste Seite"
              variant="outline"
              size="icon-sm"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronsLeft />
            </Button>
            <Button
              aria-label="Vorherige Seite"
              variant="outline"
              size="icon-sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft />
            </Button>
            <Button
              aria-label="Nächste Seite"
              variant="outline"
              size="icon-sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <ChevronRight />
            </Button>
            <Button
              aria-label="Letzte Seite"
              variant="outline"
              size="icon-sm"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
            >
              <ChevronsRight />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
