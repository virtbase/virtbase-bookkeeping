import { formatEuro, formatSignedEuro } from "@shared/money.ts";
import type {
  OpenFeeMonthDto,
  Source,
  SummaryDto,
  TransactionDto,
  TransactionStatus,
} from "@shared/types.ts";
import {
  type RowSelectionState,
  type SortingState,
  useTable,
} from "@tanstack/react-table";
import {
  CalendarCheck,
  CalendarDays,
  Download,
  Ellipsis,
  Eye,
  EyeOff,
  PanelRightOpen,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type AppColumn,
  DataTable,
  SortHeader,
} from "@/components/data-table/data-table";
import { FacetedFilter } from "@/components/data-table/faceted-filter";
import { dataTableFeatures } from "@/components/data-table/features";
import { Private } from "@/components/private";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { countLabel, formatMonth, formatStamp, rowLabel } from "@/lib/format";
import { usePrivacy } from "@/lib/preferences";
import { selectedVisibleRows } from "@/lib/selection";
import { SOURCES } from "@/lib/sources";
import { ExportDialog } from "@/pages/export-dialog";
import { TransactionSheet } from "@/pages/transaction-sheet";

const STATUS: Record<TransactionStatus, { label: string; tone: Tone }> = {
  ready: { label: "Bereit", tone: "blue" },
  review: { label: "Prüfen", tone: "amber" },
  exported: { label: "Exportiert", tone: "neutral" },
  ignored: { label: "Ausgeblendet", tone: "neutral" },
};

const RANGES = [
  "Seit letztem Export",
  "Diese Woche",
  "Letzter Monat",
  "Dieses Jahr",
] as const;
type Range = (typeof RANGES)[number];

const DEFAULT_STATUSES: TransactionStatus[] = ["ready", "review"];
const MONERO_POLL_MS = 2000;

function rangeFilter(
  range: Range,
  now: Date,
): (row: TransactionDto) => boolean {
  const unix = (date: Date) => date.getTime() / 1000;
  if (range === "Diese Woche") {
    const start = new Date(now);
    start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    start.setHours(0, 0, 0, 0);
    return (row) => row.occurredAt >= unix(start);
  }
  if (range === "Letzter Monat") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    return (row) => row.occurredAt >= unix(start) && row.occurredAt < unix(end);
  }
  if (range === "Dieses Jahr") {
    const start = new Date(now.getFullYear(), 0, 1);
    return (row) => row.occurredAt >= unix(start);
  }
  return (row) => row.status !== "exported" || row.batchId !== null;
}

function monthList(months: OpenFeeMonthDto[]): string {
  const names = months.map((entry) => formatMonth(entry.month));
  const last = names.pop();
  return names.length > 0 ? `${names.join(", ")} und ${last}` : `${last}`;
}

interface TransactionsPageProps {
  summary: SummaryDto | null;
  onChanged: () => Promise<void>;
}

export function TransactionsPage({
  summary,
  onChanged,
}: TransactionsPageProps) {
  const [rows, setRows] = useState<TransactionDto[] | null>(null);
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] =
    useState<TransactionStatus[]>(DEFAULT_STATUSES);
  const [sources, setSources] = useState<Source[]>([]);
  const [range, setRange] = useState<Range>("Seit letztem Export");
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [sorting, setSorting] = useState<SortingState>([
    { id: "occurredAt", desc: true },
  ]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 50 });
  const { mask } = usePrivacy();
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [moneroRunning, setMoneroRunning] = useState(false);
  const seen = useRef(new Set<string>());
  const fileInput = useRef<HTMLInputElement>(null);
  const autoSynced = useRef(false);

  const load = useCallback(async () => {
    const next = await api.transactions();
    setRows(next);
    setRowSelection((selection) => {
      const updated: RowSelectionState = {};
      for (const row of next) {
        if (row.status !== "ready") {
          continue;
        }
        const known = seen.current.has(row.id);
        if (selection[row.id] || !known) {
          updated[row.id] = true;
        }
        seen.current.add(row.id);
      }
      return updated;
    });
  }, []);

  const sync = useCallback(
    async (silent: boolean) => {
      setSyncing(true);
      try {
        if (summary?.moneroConfigured) {
          const status = await api.moneroSync();
          setMoneroRunning(status.running);
        }
        if (!summary?.stripeConfigured) {
          return;
        }
        const result = await api.sync();
        await Promise.all([load(), onChanged()]);
        if (!silent) {
          toast(
            result.added + result.feeRows > 0
              ? `${countLabel(result.added + result.feeRows, "neue Zeile", "neue Zeilen")}.`
              : "Keine neuen Transaktionen.",
          );
        }
      } catch (error) {
        toast.error((error as Error).message);
      } finally {
        setSyncing(false);
      }
    },
    [load, onChanged, summary],
  );

  useEffect(() => {
    void load();
    void api.moneroStatus().then((status) => setMoneroRunning(status.running));
  }, [load]);

  useEffect(() => {
    const configured = summary?.stripeConfigured || summary?.moneroConfigured;
    if (configured && !autoSynced.current) {
      autoSynced.current = true;
      void sync(true);
    }
  }, [summary, sync]);

  useEffect(() => {
    if (!moneroRunning) {
      return;
    }
    const timer = setInterval(() => {
      void api.moneroStatus().then(async (status) => {
        if (status.running) {
          return;
        }
        setMoneroRunning(false);
        await Promise.all([load(), onChanged()]);
        if (status.lastError) {
          toast.error(`Monero: ${status.lastError}`);
        } else if (status.lastAdded > 0) {
          toast(
            `${countLabel(status.lastAdded, "neue Monero-Zahlung", "neue Monero-Zahlungen")}.`,
          );
        }
      });
    }, MONERO_POLL_MS);
    return () => clearInterval(timer);
  }, [moneroRunning, load, onChanged]);

  const importMonero = async (file: File) => {
    try {
      const result = await api.importMonero(await file.text());
      await Promise.all([load(), onChanged()]);
      toast(
        result.added > 0
          ? `${countLabel(result.added, "neue Monero-Zahlung", "neue Monero-Zahlungen")} importiert.`
          : "Keine neuen Monero-Zahlungen.",
      );
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const setIgnored = useCallback(
    async (ids: string[], ignored: boolean) => {
      try {
        await api.ignoreTransactions(ids, ignored);
        await Promise.all([load(), onChanged()]);
        setOpenId(null);
        const message = ignored ? "ausgeblendet" : "wieder eingeblendet";
        toast(`${rowLabel(ids.length)} ${message}.`, {
          action: {
            label: "Rückgängig",
            onClick: () => {
              void api
                .ignoreTransactions(ids, !ignored)
                .then(() => Promise.all([load(), onChanged()]));
            },
          },
        });
      } catch (error) {
        toast.error((error as Error).message);
      }
    },
    [load, onChanged],
  );

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const inRange = rangeFilter(range, new Date());
    return (rows ?? []).filter(
      (row) =>
        (statuses.length === 0 || statuses.includes(row.status)) &&
        (sources.length === 0 || sources.includes(row.source)) &&
        inRange(row) &&
        (!query ||
          `${row.name ?? ""} ${row.purpose}`.toLowerCase().includes(query)),
    );
  }, [rows, search, statuses, sources, range]);

  const columns = useMemo<AppColumn<TransactionDto>[]>(
    () => [
      {
        id: "select",
        size: 40,
        enableSorting: false,
        header: ({ table }) => (
          <Checkbox
            aria-label="Alle bereiten Zeilen auswählen"
            checked={
              table.getIsAllRowsSelected() ||
              (table.getIsSomeRowsSelected() && "indeterminate")
            }
            onCheckedChange={(value) =>
              table.toggleAllRowsSelected(value === true)
            }
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label="Zeile auswählen"
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            onCheckedChange={(value) => row.toggleSelected(value === true)}
          />
        ),
      },
      {
        accessorKey: "occurredAt",
        size: 150,
        header: ({ column }) => <SortHeader column={column} label="Datum" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground tabular-nums">
            {formatStamp(row.original.occurredAt)}
          </span>
        ),
      },
      {
        accessorKey: "source",
        size: 116,
        enableSorting: false,
        header: "Quelle",
        cell: ({ row }) => {
          const { label, icon: Icon } = SOURCES[row.original.source];
          return (
            <span className="inline-flex items-center gap-2">
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              {label}
            </span>
          );
        },
      },
      {
        accessorKey: "name",
        size: 260,
        header: ({ column }) => <SortHeader column={column} label="Name" />,
        cell: ({ row }) => (
          <button
            type="button"
            className={
              row.original.name
                ? "max-w-full truncate hover:underline"
                : "text-status-amber-foreground hover:underline"
            }
            onClick={() => setOpenId(row.original.id)}
          >
            {row.original.name ? mask(row.original.name) : "Name fehlt"}
          </button>
        ),
      },
      {
        accessorKey: "purpose",
        size: 0,
        enableSorting: false,
        header: "Verwendungszweck",
        cell: ({ row }) => (
          <span
            className="text-muted-foreground"
            title={mask(row.original.purpose)}
          >
            <Private>{row.original.purpose}</Private>
          </span>
        ),
      },
      {
        accessorKey: "amountCents",
        size: 128,
        header: ({ column }) => (
          <SortHeader column={column} label="Betrag" align="right" />
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-[13px] tabular-nums">
            <Private>{formatSignedEuro(row.original.amountCents)}</Private>
          </div>
        ),
      },
      {
        accessorKey: "status",
        size: 104,
        enableSorting: false,
        header: "Status",
        cell: ({ row }) => {
          const status = STATUS[row.original.status];
          return <StatusBadge tone={status.tone}>{status.label}</StatusBadge>;
        },
      },
      {
        id: "actions",
        size: 48,
        enableSorting: false,
        header: () => <span className="sr-only">Aktionen</span>,
        cell: ({ row }) => {
          const { id, status } = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Aktionen für diese Zeile"
                >
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setOpenId(id)}>
                  <PanelRightOpen />
                  Details öffnen
                </DropdownMenuItem>
                {status !== "exported" && (
                  <DropdownMenuItem
                    onClick={() => void setIgnored([id], status !== "ignored")}
                  >
                    {status === "ignored" ? <Eye /> : <EyeOff />}
                    {status === "ignored" ? "Einblenden" : "Ausblenden"}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [setIgnored, mask],
  );

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: visible,
    getRowId: (row) => row.id,
    enableRowSelection: (row) => row.original.status === "ready",
    state: { rowSelection, sorting, pagination },
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
  });

  const selected = selectedVisibleRows(visible, rowSelection);
  const net = selected.reduce((sum, row) => sum + row.amountCents, 0);
  const count = (predicate: (row: TransactionDto) => boolean) =>
    (rows ?? []).filter(predicate).length;
  const filtered =
    search !== "" ||
    sources.length > 0 ||
    range !== "Seit letztem Export" ||
    statuses.join() !== DEFAULT_STATUSES.join();
  const openRow = (rows ?? []).find((row) => row.id === openId) ?? null;

  const openMonths = summary?.openFeeMonths ?? [];
  const openFeeCents = openMonths.reduce(
    (sum, entry) => sum + entry.feeCents,
    0,
  );

  const showOpenFees = () => {
    setSearch("");
    setStatuses(DEFAULT_STATUSES);
    setRange("Seit letztem Export");
    setSources(["fees"]);
    setPagination({ ...pagination, pageIndex: 0 });
  };

  const resetFilters = () => {
    setSearch("");
    setSources([]);
    setStatuses(DEFAULT_STATUSES);
    setRange("Seit letztem Export");
  };

  const undoExport = async (batchIds: number[], ids: string[]) => {
    try {
      await Promise.all(batchIds.map((id) => api.voidExport(id)));
      await Promise.all([load(), onChanged()]);
      setRowSelection((selection) => ({
        ...selection,
        ...Object.fromEntries(ids.map((id) => [id, true])),
      }));
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const exportSelected = async () => {
    const ids = selected.map((row) => row.id);
    const batches = await api.createExport(ids);
    setDialogOpen(false);
    await Promise.all([load(), onChanged()]);
    toast(`${countLabel(batches.length, "Datei", "Dateien")} gespeichert.`, {
      description: batches
        .map((batch) => `${batch.account}: ${rowLabel(batch.rowCount)}`)
        .join(", "),
      duration: 10000,
      action: {
        label: "Rückgängig",
        onClick: () =>
          void undoExport(
            batches.map((batch) => batch.id),
            ids,
          ),
      },
    });
  };

  return (
    <>
      {openMonths.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md bg-status-amber px-3 py-2 text-status-amber-foreground text-sm">
          <span className="flex items-center gap-2">
            <CalendarCheck className="size-4 shrink-0" aria-hidden="true" />
            <span>
              Monatsabschluss: Gebühren für {monthList(openMonths)} sind noch
              nicht exportiert (<Private>{formatEuro(openFeeCents)}</Private>).
            </span>
          </span>
          <Button variant="outline" size="sm" onClick={showOpenFees}>
            Anzeigen
          </Button>
        </div>
      )}
      <div
        data-tour="toolbar"
        className="flex shrink-0 flex-wrap items-center gap-2"
      >
        <div className="relative">
          <Search
            className="absolute top-2.5 left-2.5 size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            aria-label="Transaktionen suchen"
            placeholder="Suchen..."
            className="h-8 w-56 pl-8"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <FacetedFilter
          title="Status"
          selected={statuses}
          onChange={setStatuses}
          options={(["ready", "review", "exported", "ignored"] as const).map(
            (value) => ({
              value,
              label: STATUS[value].label,
              count: count((row) => row.status === value),
            }),
          )}
        />
        <FacetedFilter
          title="Quelle"
          selected={sources}
          onChange={setSources}
          options={(["stripe", "monero", "fees"] as const).map((value) => ({
            value,
            label: SOURCES[value].label,
            icon: SOURCES[value].icon,
            count: count((row) => row.source === value),
          }))}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <CalendarDays />
              {range}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {RANGES.map((option) => (
              <DropdownMenuItem key={option} onClick={() => setRange(option)}>
                {option}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {filtered && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            Zurücksetzen
            <X />
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            aria-label="Monero-CSV auswählen"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) {
                void importMonero(file);
              }
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInput.current?.click()}
          >
            <Upload />
            Monero importieren
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={
              syncing ||
              moneroRunning ||
              !(summary?.stripeConfigured || summary?.moneroConfigured)
            }
            data-tour="sync"
            onClick={() => void sync(false)}
          >
            <RefreshCw
              className={syncing || moneroRunning ? "animate-spin" : undefined}
            />
            Aktualisieren
          </Button>
        </div>
      </div>

      <DataTable
        table={table}
        footer={`${selected.length} von ${rowLabel(visible.length)} ausgewählt`}
        empty={
          rows === null ? (
            "Lädt..."
          ) : summary?.stripeConfigured ? (
            "Keine Treffer für diese Filter."
          ) : (
            <a className="underline" href="#/einstellungen">
              Stripe-Schlüssel in den Einstellungen hinterlegen
            </a>
          )
        }
      />

      {selected.length > 0 && (
        <div className="-translate-x-1/2 slide-in-from-bottom-4 fixed bottom-4 left-1/2 z-30 flex w-max max-w-[calc(100vw-2rem)] animate-in flex-wrap items-center justify-center gap-2 rounded-lg border bg-card p-1.5 shadow-lg duration-200">
          <span className="flex h-8 items-center gap-1 rounded-md border border-dashed pr-1 pl-2.5">
            {selected.length} ausgewählt
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Auswahl aufheben"
              onClick={() => setRowSelection({})}
            >
              <X />
            </Button>
          </span>
          <Separator
            orientation="vertical"
            className="data-[orientation=vertical]:h-5"
          />
          <span className="px-2 font-mono text-[13px] tabular-nums">
            <Private>{formatSignedEuro(net)}</Private>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void setIgnored(
                selected.map((row) => row.id),
                true,
              )
            }
          >
            <EyeOff />
            Ausblenden
          </Button>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Download />
            CSV exportieren
          </Button>
        </div>
      )}

      <ExportDialog
        open={dialogOpen}
        rows={selected}
        onOpenChange={setDialogOpen}
        onConfirm={exportSelected}
      />
      <TransactionSheet
        row={openRow}
        onClose={() => setOpenId(null)}
        onToggleIgnored={(row) =>
          void setIgnored([row.id], row.status !== "ignored")
        }
        onSaved={async () => {
          setOpenId(null);
          await Promise.all([load(), onChanged()]);
        }}
      />
    </>
  );
}
