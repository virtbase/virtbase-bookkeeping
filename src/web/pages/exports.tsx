import { formatSignedEuro } from "@shared/money.ts";
import type { BatchDto, BatchStatus, ExportsDto } from "@shared/types.ts";
import type { RowSelectionState, SortingState } from "@tanstack/react-table";
import { useTable } from "@tanstack/react-table";
import type { LucideIcon } from "lucide-react";
import {
  Ban,
  CircleCheck,
  Copy,
  Ellipsis,
  FileClock,
  FileDown,
  FolderOpen,
  Hash,
  List,
  ScrollText,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { AppColumn } from "@/components/data-table/data-table";
import {
  DataTable,
  SortHeader,
  selectColumn,
} from "@/components/data-table/data-table";
import { DateRangeFilter } from "@/components/data-table/date-range-filter";
import { FacetedFilter } from "@/components/data-table/faceted-filter";
import { dataTableFeatures } from "@/components/data-table/features";
import { FilterChip } from "@/components/data-table/filter-chip";
import { SearchInput } from "@/components/data-table/search-input";
import { SelectionBar } from "@/components/data-table/selection-bar";
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
  NO_ACCOUNT_LABEL,
} from "@/lib/export-filter";
import { useStoredFilter } from "@/lib/filter-state";
import {
  countLabel,
  formatDayRange,
  formatIsoDay,
  formatStamp,
} from "@/lib/format";
import { EXPORTS_FILTER, showAudit, showTransactions } from "@/lib/navigate";
import { contextFilter, missingDaysFilter } from "@/lib/transaction-filter";

const STATUS_ICONS: Record<BatchStatus, LucideIcon> = {
  pending: FileClock,
  imported: CircleCheck,
  void: Ban,
};

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

function showRows(batch: BatchDto): void {
  showTransactions(contextFilter({ batchId: batch.id }));
}

export function ExportsPage({ onChanged }: { onChanged: () => Promise<void> }) {
  const [data, setData] = useState<ExportsDto | null>(null);
  const [voiding, setVoiding] = useState<BatchDto | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [marking, setMarking] = useState(false);
  const {
    filter,
    filtered,
    update,
    replace: setFilter,
    pagination,
    setPagination,
  } = useStoredFilter<ExportFilter>(EXPORTS_FILTER, EMPTY_EXPORT_FILTER, 25);

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

  const columns = useMemo<AppColumn<BatchDto>[]>(
    () => [
      selectColumn<BatchDto>(
        "Alle ausstehenden Exporte auswählen",
        (batch) => `Export ${batch.id} auswählen`,
      ),
      {
        accessorKey: "id",
        size: 72,
        header: ({ column }) => <SortHeader column={column} label="Nr." />,
        cell: ({ row }) => (
          <span className="tabular-nums">#{row.original.id}</span>
        ),
      },
      {
        accessorKey: "createdAt",
        size: 160,
        header: ({ column }) => <SortHeader column={column} label="Erstellt" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground tabular-nums">
            {formatStamp(row.original.createdAt)}
          </span>
        ),
      },
      {
        accessorKey: "account",
        size: 120,
        header: ({ column }) => <SortHeader column={column} label="Konto" />,
        cell: ({ row }) => row.original.account || "—",
      },
      {
        id: "range",
        accessorFn: (batch) => batch.firstAt,
        size: 0,
        header: ({ column }) => <SortHeader column={column} label="Zeitraum" />,
        cell: ({ row }) =>
          formatDayRange(row.original.firstAt, row.original.lastAt),
      },
      {
        accessorKey: "rowCount",
        size: 96,
        header: ({ column }) => (
          <SortHeader column={column} label="Zeilen" align="right" />
        ),
        cell: ({ row }) => (
          <div className="text-right tabular-nums">{row.original.rowCount}</div>
        ),
      },
      {
        accessorKey: "netCents",
        size: 128,
        header: ({ column }) => (
          <SortHeader column={column} label="Saldo" align="right" />
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-[13px]">
            <Private>{formatSignedEuro(row.original.netCents)}</Private>
          </div>
        ),
      },
      {
        accessorKey: "status",
        size: 160,
        header: ({ column }) => <SortHeader column={column} label="Status" />,
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
                <DropdownMenuItem onClick={() => showRows(batch)}>
                  <List />
                  Zeilen anzeigen
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    showAudit({ target: { type: "export", id: batch.id } })
                  }
                >
                  <ScrollText />
                  Verlauf anzeigen
                </DropdownMenuItem>
                <DropdownMenuSeparator />
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
    enableRowSelection: (row) => row.original.status === "pending",
    state: { pagination, sorting, rowSelection },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
  });

  const selected = visible.filter(
    (batch) => batch.status === "pending" && rowSelection[String(batch.id)],
  );

  const markSelected = async () => {
    setMarking(true);
    await run(async () => {
      await Promise.all(selected.map((batch) => api.markImported(batch.id)));
      toast(
        `${countLabel(selected.length, "Export", "Exporte")} als importiert markiert.`,
      );
      setRowSelection({});
    });
    setMarking(false);
  };

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
            icon: STATUS_ICONS[value],
            count: batches.filter((batch) => batch.status === value).length,
          }))}
        />
        <DateRangeFilter
          title="Zeitraum"
          from={filter.from}
          to={filter.to}
          onChange={(from, to) => update({ from, to })}
        />
        {filter.batchId !== null && (
          <FilterChip
            title="Export"
            label={`Export #${filter.batchId}`}
            onRemove={() => update({ batchId: null })}
          />
        )}
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFilter(EMPTY_EXPORT_FILTER)}
          >
            Zurücksetzen
            <X />
          </Button>
        )}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
          {missing.length > 0 && (
            <button
              type="button"
              className="rounded-full hover:opacity-80 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              title="Zeilen ohne Export anzeigen"
              onClick={() => showTransactions(missingDaysFilter(missing))}
            >
              <StatusBadge tone="amber">
                Ohne Export: {missing.slice(0, 4).map(formatIsoDay).join(", ")}
                {missing.length > 4 ? ` und ${missing.length - 4} weitere` : ""}
              </StatusBadge>
            </button>
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
        onOpenRow={showRows}
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

      <SelectionBar count={selected.length} onClear={() => setRowSelection({})}>
        <Button
          size="sm"
          disabled={marking}
          onClick={() => void markSelected()}
        >
          <CircleCheck />
          In Lexware importiert
        </Button>
      </SelectionBar>

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
