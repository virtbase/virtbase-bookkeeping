import { formatSignedEuro } from "@shared/money.ts";
import type { BatchDto, BatchStatus, ExportsDto } from "@shared/types.ts";
import type { PaginationState, SortingState } from "@tanstack/react-table";
import { useTable } from "@tanstack/react-table";
import {
  Ban,
  CircleCheck,
  Copy,
  Ellipsis,
  FileDown,
  FolderOpen,
  Hash,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { AppColumn } from "@/components/data-table/data-table";
import { DataTable } from "@/components/data-table/data-table";
import { DateRangeFilter } from "@/components/data-table/date-range-filter";
import { FacetedFilter } from "@/components/data-table/faceted-filter";
import { dataTableFeatures } from "@/components/data-table/features";
import { SearchInput } from "@/components/data-table/search-input";
import { Private } from "@/components/private";
import type { Tone } from "@/components/status-badge";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { copyText } from "@/lib/copy";
import type { ExportFilter } from "@/lib/export-filter";
import {
  BATCH_STATUS_LABELS,
  EMPTY_EXPORT_FILTER,
  filterBatches,
  isFiltered,
  NO_ACCOUNT_LABEL,
} from "@/lib/export-filter";
import {
  countLabel,
  formatDayRange,
  formatIsoDay,
  formatStamp,
} from "@/lib/format";
import { useSessionState } from "@/lib/use-session-state";

const STATUS_TONES: Record<BatchStatus, Tone> = {
  pending: "amber",
  imported: "blue",
  void: "neutral",
};

async function copyWithToast(value: string, message: string): Promise<void> {
  if (await copyText(value)) {
    toast(message);
  } else {
    toast.error("Kopieren nicht möglich.");
  }
}

export function ExportsPage({ onChanged }: { onChanged: () => Promise<void> }) {
  const [data, setData] = useState<ExportsDto | null>(null);
  const [voiding, setVoiding] = useState<BatchDto | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  });
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filter, setFilter] = useSessionState(
    "exports.filter",
    EMPTY_EXPORT_FILTER,
  );

  const load = useCallback(async () => {
    setData(await api.exports());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
        await Promise.all([load(), onChanged()]);
      } catch (error) {
        toast.error((error as Error).message);
      }
    },
    [load, onChanged],
  );

  const regenerate = useCallback(
    (batch: BatchDto) =>
      run(async () => {
        const result = await api.regenerateExport(batch.id);
        if (result.existed) {
          toast("Die Datei ist noch vorhanden und unverändert.");
        } else if (result.identical) {
          toast(`Identisch neu erzeugt: ${result.fileName}`);
        } else {
          toast.warning(
            `Neu erzeugt, weicht aber vom Original ab: ${result.fileName}`,
          );
        }
      }),
    [run],
  );

  const batches = useMemo(() => data?.batches ?? [], [data]);
  const visible = useMemo(
    () => filterBatches(batches, filter),
    [batches, filter],
  );
  const filtered = isFiltered(filter);

  const update = (change: Partial<ExportFilter>) => {
    setFilter({ ...filter, ...change });
    setPagination({ ...pagination, pageIndex: 0 });
  };

  const columns = useMemo<AppColumn<BatchDto>[]>(
    () => [
      {
        accessorKey: "id",
        size: 64,
        enableSorting: false,
        header: "Nr.",
        cell: ({ row }) => (
          <span className="tabular-nums">#{row.original.id}</span>
        ),
      },
      {
        accessorKey: "createdAt",
        size: 160,
        enableSorting: false,
        header: "Erstellt",
        cell: ({ row }) => (
          <span className="text-muted-foreground tabular-nums">
            {formatStamp(row.original.createdAt)}
          </span>
        ),
      },
      {
        accessorKey: "account",
        size: 120,
        enableSorting: false,
        header: "Konto",
        cell: ({ row }) => row.original.account || "—",
      },
      {
        id: "range",
        size: 0,
        enableSorting: false,
        header: "Zeitraum",
        cell: ({ row }) =>
          formatDayRange(row.original.firstAt, row.original.lastAt),
      },
      {
        accessorKey: "rowCount",
        size: 80,
        enableSorting: false,
        header: () => <div className="text-right">Zeilen</div>,
        cell: ({ row }) => (
          <div className="text-right tabular-nums">{row.original.rowCount}</div>
        ),
      },
      {
        accessorKey: "netCents",
        size: 128,
        enableSorting: false,
        header: () => <div className="text-right">Saldo</div>,
        cell: ({ row }) => (
          <div className="text-right font-mono text-[13px]">
            <Private>{formatSignedEuro(row.original.netCents)}</Private>
          </div>
        ),
      },
      {
        accessorKey: "status",
        size: 160,
        enableSorting: false,
        header: "Status",
        cell: ({ row }) => (
          <StatusBadge tone={STATUS_TONES[row.original.status]}>
            {BATCH_STATUS_LABELS[row.original.status]}
          </StatusBadge>
        ),
      },
      {
        id: "actions",
        size: 48,
        enableSorting: false,
        header: () => <span className="sr-only">Aktionen</span>,
        cell: ({ row }) => {
          const batch = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Aktionen für Export ${batch.id}`}
                >
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {batch.status === "pending" && (
                  <>
                    <DropdownMenuItem
                      onClick={() => void run(() => api.markImported(batch.id))}
                    >
                      <CircleCheck />
                      In Lexware importiert
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem
                  onClick={() => void run(() => api.revealExport(batch.id))}
                >
                  <FolderOpen />
                  Datei im Ordner zeigen
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    void copyWithToast(batch.filePath, "Dateipfad kopiert.")
                  }
                >
                  <Copy />
                  Dateipfad kopieren
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    void copyWithToast(batch.sha256, "SHA-256 kopiert.")
                  }
                >
                  <Hash />
                  SHA-256 kopieren
                </DropdownMenuItem>
                {batch.status !== "void" && (
                  <DropdownMenuItem onClick={() => void regenerate(batch)}>
                    <FileDown />
                    CSV erneut erzeugen
                  </DropdownMenuItem>
                )}
                {batch.status !== "void" && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setVoiding(batch)}
                    >
                      <Ban />
                      Stornieren
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [run, regenerate],
  );

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: visible,
    getRowId: (row) => String(row.id),
    state: { pagination, sorting, rowSelection: {} },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
  });

  const missing = data?.missingDays ?? [];
  const accountOptions = [
    ...new Set(batches.map((batch) => batch.account)),
  ].map((value) => ({
    value,
    label: value || NO_ACCOUNT_LABEL,
    count: batches.filter((batch) => batch.account === value).length,
  }));

  return (
    <>
      <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-2">
        <SearchInput
          label="Exporte suchen"
          value={filter.search}
          onChange={(search) => update({ search })}
        />
        <FacetedFilter
          title="Konto"
          selected={filter.accounts}
          onChange={(accounts) => update({ accounts })}
          options={accountOptions}
        />
        <FacetedFilter
          title="Status"
          selected={filter.statuses}
          onChange={(statuses) => update({ statuses })}
          options={(["pending", "imported", "void"] as const).map((value) => ({
            value,
            label: BATCH_STATUS_LABELS[value],
            count: batches.filter((batch) => batch.status === value).length,
          }))}
        />
        <DateRangeFilter
          title="Zeitraum"
          from={filter.from}
          to={filter.to}
          onChange={(from, to) => update({ from, to })}
        />
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => update(EMPTY_EXPORT_FILTER)}
          >
            Zurücksetzen
            <X />
          </Button>
        )}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
          {missing.length > 0 && (
            <StatusBadge tone="amber">
              Ohne Export: {missing.slice(0, 4).map(formatIsoDay).join(", ")}
              {missing.length > 4 ? ` und ${missing.length - 4} weitere` : ""}
            </StatusBadge>
          )}
          <span className="text-muted-foreground">
            {data?.coveredUntil
              ? `Exportiert bis ${formatStamp(data.coveredUntil)}`
              : "Noch keine Exporte"}
          </span>
        </div>
      </div>

      <DataTable
        table={table}
        footer={
          filtered
            ? `${visible.length} von ${countLabel(batches.length, "Export", "Exporten")}`
            : countLabel(batches.length, "Export", "Exporte")
        }
        empty={
          !data
            ? "Lädt..."
            : filtered
              ? "Keine Treffer für diese Filter."
              : "Noch keine Exporte."
        }
      />

      <Dialog
        open={voiding !== null}
        onOpenChange={(open) => {
          if (!open) {
            setVoiding(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Export #{voiding?.id} stornieren?</DialogTitle>
            <DialogDescription>
              Die Zeilen sind danach wieder bereit, die Datei bleibt erhalten.
              Falls die Datei schon in Lexware ist, blende die Umsätze dort aus,
              sonst werden sie doppelt gebucht.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoiding(null)}>
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const batch = voiding;
                setVoiding(null);
                if (batch) {
                  void run(() => api.voidExport(batch.id));
                }
              }}
            >
              Export stornieren
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
