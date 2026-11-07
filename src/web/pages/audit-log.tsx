import {
  AUDIT_LABELS,
  auditLabel,
  formatAuditDetail,
  formatAuditTime,
} from "@shared/audit.ts";
import type { AuditEventDto } from "@shared/types.ts";
import type { RowSelectionState, SortingState } from "@tanstack/react-table";
import { useTable } from "@tanstack/react-table";
import { Archive, Download, Ellipsis, List, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import type { AuditFilter, AuditTarget } from "@/lib/audit-filter";
import {
  EMPTY_AUDIT_FILTER,
  exportIdOf,
  filterAudit,
  transactionIdsOf,
} from "@/lib/audit-filter";
import { downloadFile } from "@/lib/download";
import { useStoredFilter } from "@/lib/filter-state";
import { countLabel, rowLabel, shortenMiddle } from "@/lib/format";
import { AUDIT_FILTER, showExports, showTransactions } from "@/lib/navigate";
import { contextFilter } from "@/lib/transaction-filter";

function targetLabel(target: AuditTarget): string {
  return target.type === "export"
    ? `Export #${target.id}`
    : `Zeile ${shortenMiddle(target.id)}`;
}

function EventLinks({ event }: { event: AuditEventDto }) {
  const exportId = exportIdOf(event);
  const ids = transactionIdsOf(event);
  if (exportId === null && ids.length === 0) {
    return null;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Verknüpfungen für diesen Eintrag"
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {exportId !== null && (
          <>
            <DropdownMenuItem
              onClick={() => showExports({ batchId: exportId })}
            >
              <Archive />
              Export #{exportId} anzeigen
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                showTransactions(contextFilter({ batchId: exportId }))
              }
            >
              <List />
              Zeilen des Exports anzeigen
            </DropdownMenuItem>
          </>
        )}
        {ids.length > 0 && (
          <DropdownMenuItem
            onClick={() => showTransactions(contextFilter({ ids }))}
          >
            <List />
            {ids.length === 1
              ? "Zeile anzeigen"
              : `${rowLabel(ids.length)} anzeigen`}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AuditLogPage() {
  const [events, setEvents] = useState<AuditEventDto[] | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [sorting, setSorting] = useState<SortingState>([
    { id: "at", desc: true },
  ]);
  const {
    filter,
    filtered,
    update,
    replace: setFilter,
    pagination,
    setPagination,
  } = useStoredFilter<AuditFilter>(AUDIT_FILTER, EMPTY_AUDIT_FILTER, 50);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.audit().then(setEvents);
  }, []);

  const visible = useMemo(
    () => filterAudit(events ?? [], filter),
    [events, filter],
  );

  const columns = useMemo<AppColumn<AuditEventDto>[]>(
    () => [
      selectColumn<AuditEventDto>(
        "Alle Einträge auswählen",
        () => "Eintrag auswählen",
      ),
      {
        accessorKey: "at",
        size: 180,
        header: ({ column }) => (
          <SortHeader column={column} label="Zeitpunkt" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground tabular-nums">
            {formatAuditTime(row.original.at)}
          </span>
        ),
      },
      {
        accessorKey: "type",
        size: 260,
        enableSorting: false,
        header: "Ereignis",
        cell: ({ row }) => auditLabel(row.original.type),
      },
      {
        id: "detail",
        size: 0,
        enableSorting: false,
        header: "Details",
        cell: ({ row }) => {
          const detail = formatAuditDetail(row.original.detail);
          return (
            <span className="text-muted-foreground" title={detail}>
              {detail || "—"}
            </span>
          );
        },
      },
      {
        id: "links",
        size: 48,
        enableSorting: false,
        header: () => <span className="sr-only">Verknüpfungen</span>,
        cell: ({ row }) => <EventLinks event={row.original} />,
      },
    ],
    [],
  );

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: visible,
    getRowId: (row) => String(row.id),
    state: { rowSelection, sorting, pagination },
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
  });

  const selected = visible.filter((event) => rowSelection[String(event.id)]);
  const target = selected.length > 0 ? selected : visible;

  const presentTypes = [...new Set((events ?? []).map((event) => event.type))];
  const typeOptions = Object.keys(AUDIT_LABELS)
    .filter((type) => presentTypes.includes(type))
    .concat(presentTypes.filter((type) => !AUDIT_LABELS[type]))
    .map((value) => ({
      value,
      label: auditLabel(value),
      count: (events ?? []).filter((event) => event.type === value).length,
    }));

  const exportEntries = async () => {
    setBusy(true);
    try {
      const { fileName, content } = await api.exportAudit(
        target.map((event) => event.id),
      );
      downloadFile(fileName, content);
      toast(`${countLabel(target.length, "Eintrag", "Einträge")} exportiert.`);
      setEvents(await api.audit());
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <SearchInput
          label="Audit-Log durchsuchen"
          value={filter.search}
          onChange={(search) => update({ search })}
        />
        <FacetedFilter
          title="Ereignis"
          selected={filter.types}
          onChange={(types) => update({ types })}
          options={typeOptions}
        />
        <DateRangeFilter
          title="Zeitraum"
          from={filter.from}
          to={filter.to}
          onChange={(from, to) => update({ from, to })}
        />
        {filter.target && (
          <FilterChip
            title="Objekt"
            label={targetLabel(filter.target)}
            onRemove={() => update({ target: null })}
          />
        )}
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFilter(EMPTY_AUDIT_FILTER)}
          >
            Zurücksetzen
            <X />
          </Button>
        )}
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || target.length === 0}
            onClick={() => void exportEntries()}
          >
            <Download />
            {selected.length > 0
              ? `${countLabel(selected.length, "Eintrag", "Einträge")} exportieren`
              : filtered
                ? "Treffer exportieren"
                : "Alle exportieren"}
          </Button>
        </div>
      </div>

      <DataTable
        table={table}
        footer={`${selected.length} von ${countLabel(visible.length, "Eintrag", "Einträgen")} ausgewählt`}
        empty={
          events === null
            ? "Lädt..."
            : filtered
              ? "Keine Treffer für diese Filter."
              : "Noch keine Einträge."
        }
      />
    </>
  );
}
