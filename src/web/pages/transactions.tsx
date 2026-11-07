import type { KindGroup } from "@shared/kinds.ts";
import { KIND_GROUPS, kindGroup } from "@shared/kinds.ts";
import { formatEuro, formatSignedEuro, plainAmount } from "@shared/money.ts";
import type {
  BatchDto,
  OpenFeeMonthDto,
  SummaryDto,
  TransactionDto,
  TransactionStatus,
} from "@shared/types.ts";
import type { RowSelectionState, SortingState } from "@tanstack/react-table";
import { useTable } from "@tanstack/react-table";
import type { LucideIcon } from "lucide-react";
import {
  BanknoteArrowDown,
  BanknoteArrowUp,
  CalendarCheck,
  CircleHelp,
  Download,
  Ellipsis,
  Eye,
  EyeOff,
  PanelRightOpen,
  Receipt,
  RefreshCw,
  Scale,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/copy-button";
import { AmountFilter } from "@/components/data-table/amount-filter";
import type { AppColumn } from "@/components/data-table/data-table";
import {
  DataTable,
  SortHeader,
  selectColumn,
} from "@/components/data-table/data-table";
import type { FilterOption } from "@/components/data-table/faceted-filter";
import { FacetedFilter } from "@/components/data-table/faceted-filter";
import { dataTableFeatures } from "@/components/data-table/features";
import { FilterChip } from "@/components/data-table/filter-chip";
import { PeriodFilter } from "@/components/data-table/period-filter";
import { SearchInput } from "@/components/data-table/search-input";
import { SelectionBar } from "@/components/data-table/selection-bar";
import { Private } from "@/components/private";
import { ShortcutHint } from "@/components/shortcut-hint";
import type { Tone } from "@/components/status-badge";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { useStoredFilter } from "@/lib/filter-state";
import {
  countLabel,
  formatMonth,
  formatStamp,
  isoDay,
  rowLabel,
} from "@/lib/format";
import { TRANSACTIONS_FILTER } from "@/lib/navigate";
import { usePageActions } from "@/lib/page-actions";
import { methodIcon } from "@/lib/payment-methods";
import { usePrivacy } from "@/lib/preferences";
import { selectedVisibleRows } from "@/lib/selection";
import { useShortcut } from "@/lib/shortcuts";
import { SOURCES } from "@/lib/sources";
import type { TransactionFilter } from "@/lib/transaction-filter";
import {
  customerLabel,
  DEFAULT_TRANSACTION_FILTER,
  filterTransactions,
  KIND_LABELS,
  OPEN_FEES_FILTER,
  reviewKeyOf,
  reviewLabel,
} from "@/lib/transaction-filter";
import { ExportDialog } from "@/pages/export-dialog";
import { TransactionSheet } from "@/pages/transaction-sheet";

const STATUS: Record<TransactionStatus, { label: string; tone: Tone }> = {
  ready: { label: "Bereit", tone: "blue" },
  review: { label: "Prüfen", tone: "amber" },
  exported: { label: "Exportiert", tone: "neutral" },
  ignored: { label: "Ausgeblendet", tone: "neutral" },
};

const KIND_ICONS: Record<KindGroup, LucideIcon> = {
  payment: BanknoteArrowDown,
  refund: Undo2,
  payout: BanknoteArrowUp,
  adjustment: Scale,
  fee: Receipt,
  other: CircleHelp,
};

const HOVER_COPY = "opacity-0 group-hover/row:opacity-100";
const MONERO_POLL_MS = 2000;

interface OptionStyle<T extends string> {
  label: (value: T) => string;
  icon?: (value: T) => LucideIcon;
  order?: readonly T[];
}

function optionsOf<T extends string>(
  rows: TransactionDto[],
  pick: (row: TransactionDto) => T | null,
  { label: labelOf, icon: iconOf, order }: OptionStyle<T>,
): FilterOption<T>[] {
  const counts = new Map<T, number>();
  for (const row of rows) {
    const value = pick(row);
    if (value !== null) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  const values = order
    ? order.filter((value) => counts.has(value))
    : [...counts.keys()].sort((a, b) =>
        labelOf(a).localeCompare(labelOf(b), "de-DE"),
      );
  return values.map((value) => ({
    value,
    label: labelOf(value),
    icon: iconOf?.(value),
    count: counts.get(value) ?? 0,
  }));
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
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [sorting, setSorting] = useState<SortingState>([
    { id: "occurredAt", desc: true },
  ]);
  const {
    filter,
    filtered,
    update,
    replace: setFilter,
    pagination,
    setPagination,
  } = useStoredFilter<TransactionFilter>(
    TRANSACTIONS_FILTER,
    DEFAULT_TRANSACTION_FILTER,
    50,
  );
  const { mask } = usePrivacy();
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [moneroRunning, setMoneroRunning] = useState(false);
  const seen = useRef(new Set<string>());
  const fileInput = useRef<HTMLInputElement>(null);
  const autoSynced = useRef(false);
  const lastToggled = useRef<string | null>(null);
  const exportedIds = useRef<string[]>([]);

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

  const allRows = useMemo(() => rows ?? [], [rows]);
  const today = isoDay(Math.floor(Date.now() / 1000));
  const visible = useMemo(
    () => filterTransactions(allRows, filter, today),
    [allRows, filter, today],
  );
  const facets = useMemo(
    () => ({
      kinds: optionsOf<KindGroup>(allRows, (row) => kindGroup(row.kind), {
        label: (value) => KIND_LABELS[value],
        icon: (value) => KIND_ICONS[value],
        order: KIND_GROUPS,
      }),
      reasons: optionsOf(allRows, reviewKeyOf, { label: reviewLabel }),
      methods: optionsOf(allRows, (row) => row.method, {
        label: (value) => value,
        icon: methodIcon,
      }),
    }),
    [allRows],
  );

  const columns = useMemo<AppColumn<TransactionDto>[]>(
    () => [
      {
        ...selectColumn<TransactionDto>(
          "Alle bereiten Zeilen auswählen",
          () => "Zeile auswählen",
        ),
        cell: ({ row, table }) => (
          <Checkbox
            aria-label="Zeile auswählen"
            className="translate-y-0.5"
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            onCheckedChange={(value) => {
              lastToggled.current = row.id;
              row.toggleSelected(value === true);
            }}
            onClick={(event) => {
              if (event.shiftKey && lastToggled.current) {
                event.preventDefault();
                const rows = table.getRowModel().rows;
                const from = rows.findIndex(
                  (entry) => entry.id === lastToggled.current,
                );
                const to = rows.findIndex((entry) => entry.id === row.id);
                setRowSelection((selection) => ({
                  ...selection,
                  ...Object.fromEntries(
                    rows
                      .slice(Math.min(from, to), Math.max(from, to) + 1)
                      .filter((entry) => entry.getCanSelect())
                      .map((entry) => [entry.id, true]),
                  ),
                }));
                lastToggled.current = row.id;
              }
            }}
          />
        ),
      },
      {
        accessorKey: "occurredAt",
        size: 140,
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
        size: 272,
        header: ({ column }) => <SortHeader column={column} label="Name" />,
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              className={
                row.original.name
                  ? "min-w-0 truncate hover:underline"
                  : "text-status-amber-foreground hover:underline"
              }
              onClick={() => setOpenId(row.original.id)}
            >
              {row.original.name ? mask(row.original.name) : "Name fehlt"}
            </button>
            {row.original.name && (
              <CopyButton
                value={row.original.name}
                label="Name kopieren"
                className={HOVER_COPY}
              />
            )}
          </div>
        ),
      },
      {
        accessorKey: "purpose",
        size: 0,
        enableSorting: false,
        header: "Verwendungszweck",
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-1">
            <span
              className="min-w-0 truncate text-muted-foreground"
              title={mask(row.original.purpose)}
            >
              <Private>{row.original.purpose}</Private>
            </span>
            <CopyButton
              value={row.original.purpose}
              label="Verwendungszweck kopieren"
              className={HOVER_COPY}
            />
          </div>
        ),
      },
      {
        accessorKey: "amountCents",
        size: 128,
        header: ({ column }) => (
          <SortHeader column={column} label="Betrag" align="right" />
        ),
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1 font-mono text-[13px] tabular-nums">
            <CopyButton
              value={plainAmount(row.original.amountCents)}
              label="Betrag kopieren"
              className={HOVER_COPY}
            />
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
  const visibleSum = visible.reduce((sum, row) => sum + row.amountCents, 0);
  const count = (predicate: (row: TransactionDto) => boolean) =>
    allRows.filter(predicate).length;
  const customerNames = filter.customers.map(
    (key) => customerLabel(allRows, key) ?? "Ohne Namen",
  );
  const chips: {
    title: string;
    label: string;
    clear: Partial<TransactionFilter>;
  }[] = [];
  if (filter.batchId !== null) {
    chips.push({
      title: "Export",
      label: `Export #${filter.batchId}`,
      clear: { batchId: null },
    });
  }
  if (customerNames.length > 0) {
    chips.push({
      title: "Kunde",
      label:
        customerNames.length === 1
          ? `Kunde: ${mask(customerNames[0] ?? "")}`
          : countLabel(customerNames.length, "Kunde", "Kunden"),
      clear: { customers: [] },
    });
  }
  if (filter.products.length > 0) {
    chips.push({
      title: "Produkt",
      label:
        filter.products.length === 1
          ? `Produkt: ${filter.products[0]}`
          : countLabel(filter.products.length, "Produkt", "Produkte"),
      clear: { products: [] },
    });
  }
  if (filter.days.length > 0) {
    chips.push({
      title: "Tage ohne Export",
      label: `${countLabel(filter.days.length, "Tag", "Tage")} ohne Export`,
      clear: { days: [] },
    });
  }
  if (filter.ids.length > 0) {
    chips.push({
      title: "Zeilen aus dem Audit-Log",
      label: `${rowLabel(filter.ids.length)} aus dem Audit-Log`,
      clear: { ids: [] },
    });
  }
  if (filter.revenueOnly) {
    chips.push({
      title: "Umsätze wie in der Statistik",
      label: "Umsätze wie in der Statistik",
      clear: { revenueOnly: false },
    });
  }
  const openRow = allRows.find((row) => row.id === openId) ?? null;

  const openMonths = summary?.openFeeMonths ?? [];
  const openFeeCents = openMonths.reduce(
    (sum, entry) => sum + entry.feeCents,
    0,
  );

  const showOpenFees = () => setFilter(OPEN_FEES_FILTER);
  const resetFilters = () => setFilter(DEFAULT_TRANSACTION_FILTER);

  const undoExport = async (batches: BatchDto[]) => {
    const ids = exportedIds.current;
    try {
      await Promise.all(batches.map((batch) => api.voidExport(batch.id)));
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
    exportedIds.current = ids;
    await Promise.all([load(), onChanged()]);
    return batches;
  };

  useShortcut("sync", () => void sync(false));

  usePageActions((action) => {
    if (action.type === "open") {
      setOpenId(action.id);
    } else {
      void sync(false);
    }
  });

  const pageRows = table.getRowModel().rows;
  const pageIds = pageRows.map((row) => row.id);
  const openIndex = openId ? pageIds.indexOf(openId) : -1;
  const previousId = openIndex > 0 ? pageIds[openIndex - 1] : undefined;
  const nextId =
    openIndex >= 0 && openIndex < pageIds.length - 1
      ? pageIds[openIndex + 1]
      : undefined;
  const reviewIds = pageRows
    .filter((row) => row.original.status === "review")
    .map((row) => row.id);
  const nextReviewId = () =>
    pageIds
      .slice(openIndex + 1)
      .find((id) => id !== openId && reviewIds.includes(id)) ??
    reviewIds.find((id) => id !== openId) ??
    null;

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
        <SearchInput
          label="Transaktionen suchen"
          value={filter.search}
          onChange={(search) => update({ search })}
        />
        <FacetedFilter
          title="Status"
          selected={filter.statuses}
          onChange={(statuses) => update({ statuses })}
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
          selected={filter.sources}
          onChange={(sources) => update({ sources })}
          options={(["stripe", "monero", "fees"] as const).map((value) => ({
            value,
            label: SOURCES[value].label,
            icon: SOURCES[value].icon,
            count: count((row) => row.source === value),
          }))}
        />
        <FacetedFilter
          title="Typ"
          selected={filter.kinds}
          onChange={(kinds) => update({ kinds })}
          options={facets.kinds}
        />
        {(facets.reasons.length > 0 || filter.reasons.length > 0) && (
          <FacetedFilter
            title="Prüfgrund"
            selected={filter.reasons}
            onChange={(reasons) => update({ reasons })}
            options={facets.reasons}
          />
        )}
        <FacetedFilter
          title="Zahlungsart"
          selected={filter.methods}
          onChange={(methods) => update({ methods })}
          options={facets.methods}
        />
        <AmountFilter value={filter} onChange={update} />
        <PeriodFilter value={filter} today={today} onChange={update} />
        {chips.map((chip) => (
          <FilterChip
            key={chip.title}
            title={chip.title}
            label={chip.label}
            onRemove={() => update(chip.clear)}
          />
        ))}
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
            <ShortcutHint id="sync" />
          </Button>
        </div>
      </div>

      <DataTable
        table={table}
        stickyHeader
        onOpenRow={(row) => setOpenId(row.id)}
        footer={
          <>
            <span>
              {selected.length} von {rowLabel(visible.length)} ausgewählt
            </span>
            <span className="font-mono text-[13px] tabular-nums">
              Summe <Private>{formatSignedEuro(visibleSum)}</Private>
            </span>
          </>
        }
        empty={
          rows === null ? (
            "Lädt..."
          ) : summary?.stripeConfigured || filtered ? (
            "Keine Treffer für diese Filter."
          ) : (
            <a className="underline" href="#/einstellungen">
              Stripe-Schlüssel in den Einstellungen hinterlegen
            </a>
          )
        }
      />

      <SelectionBar count={selected.length} onClear={() => setRowSelection({})}>
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
      </SelectionBar>

      <ExportDialog
        open={dialogOpen}
        rows={selected}
        onOpenChange={setDialogOpen}
        onConfirm={exportSelected}
        onUndo={undoExport}
        onImported={onChanged}
      />
      <TransactionSheet
        row={openRow}
        onClose={() => setOpenId(null)}
        onToggleIgnored={(row) =>
          void setIgnored([row.id], row.status !== "ignored")
        }
        onPrevious={previousId ? () => setOpenId(previousId) : undefined}
        onNext={nextId ? () => setOpenId(nextId) : undefined}
        reviewLeft={reviewIds.length}
        onSaved={async () => {
          setOpenId(nextReviewId());
          await Promise.all([load(), onChanged()]);
        }}
      />
    </>
  );
}
