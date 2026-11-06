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
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { KeyHint } from "@/components/shortcut-hint";
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

const FLEXIBLE_COLUMN_WIDTH = 140;
const WIDE_LAYOUT = 768;
const MIN_TABLE_HEIGHT = 240;
const BOTTOM_SPACE = 120;

interface DataTableProps<TData extends RowData> {
  table: TanstackTable<DataTableFeatures, TData>;
  empty: ReactNode;
  footer: ReactNode;
  stickyHeader?: boolean;
  onOpenRow?: (row: TData) => void;
}

export function DataTable<TData extends RowData>({
  table,
  empty,
  footer,
  stickyHeader = false,
  onOpenRow,
}: DataTableProps<TData>) {
  "use no memo";

  const [activeIndex, setActiveIndex] = useState(-1);
  const [focused, setFocused] = useState(false);
  const scroller = useRef<HTMLElement>(null);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!stickyHeader) {
      return;
    }
    const measure = () => {
      const top = scroller.current?.offsetTop ?? 0;
      setMaxHeight(
        window.innerWidth >= WIDE_LAYOUT
          ? Math.max(MIN_TABLE_HEIGHT, window.innerHeight - top - BOTTOM_SPACE)
          : undefined,
      );
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });

  const rows = table.getRowModel().rows;
  const { pageIndex, pageSize } = table.store.state.pagination;
  const active = focused ? rows[activeIndex] : undefined;

  const moveTo = (index: number) => {
    const next = Math.min(Math.max(index, 0), rows.length - 1);
    setActiveIndex(next);
    scroller.current
      ?.querySelector(`tbody tr:nth-child(${next + 1})`)
      ?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || !onOpenRow) {
      return;
    }
    if (event.key === "j" || event.key === "ArrowDown") {
      moveTo(activeIndex + 1);
    } else if (event.key === "k" || event.key === "ArrowUp") {
      moveTo(activeIndex - 1);
    } else if (event.key === "x" && active?.getCanSelect()) {
      active.toggleSelected();
    } else if (event.key === "Enter" && active) {
      onOpenRow(active.original);
    } else {
      return;
    }
    event.preventDefault();
  };

  const columns = table.getAllColumns();
  const columnCount = columns.length;
  const minWidth = columns.reduce(
    (sum, column) => sum + (column.columnDef.size || FLEXIBLE_COLUMN_WIDTH),
    0,
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <section
        ref={scroller}
        aria-label="Tabelle"
        tabIndex={onOpenRow ? 0 : undefined}
        className={cn(
          "relative overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          stickyHeader && "md:overflow-y-auto",
        )}
        style={{ maxHeight }}
        onKeyDown={onKeyDown}
        onFocus={(event) => {
          if (event.target === event.currentTarget) {
            setFocused(true);
          }
        }}
        onBlur={() => setFocused(false)}
      >
        <Table className="table-fixed" style={{ minWidth }}>
          <TableHeader
            className={cn(
              stickyHeader &&
                "sticky top-0 z-10 bg-background shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-b-0",
            )}
          >
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    style={{ width: header.column.columnDef.size || undefined }}
                    className="h-10 overflow-hidden px-2 font-medium first:pl-3"
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
                  className={cn(
                    row === active &&
                      "shadow-[inset_2px_0_0_var(--foreground)]",
                  )}
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
      </section>
      <div className="flex flex-wrap items-center justify-between gap-4 px-1 text-muted-foreground text-sm">
        <span className="flex flex-wrap items-center gap-3">
          {footer}
          {focused && onOpenRow && (
            <span className="flex items-center gap-1.5 text-xs">
              <KeyHint keys={["J", "K"]} /> Zeile
              <KeyHint keys={["X"]} /> Auswahl
              <KeyHint keys={["Enter"]} /> Öffnen
            </span>
          )}
        </span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
