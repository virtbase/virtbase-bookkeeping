import {
  AUDIT_LABELS,
  auditLabel,
  formatAuditDetail,
  formatAuditTime,
} from "@shared/audit.ts";
import type { AuditEventDto } from "@shared/types.ts";
import {
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  useTable,
} from "@tanstack/react-table";
import { Download, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  type AppColumn,
  DataTable,
  SortHeader,
} from "@/components/data-table/data-table";
import { FacetedFilter } from "@/components/data-table/faceted-filter";
import { dataTableFeatures } from "@/components/data-table/features";
import { SearchInput } from "@/components/data-table/search-input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/api";
import { downloadFile } from "@/lib/download";
import { countLabel } from "@/lib/format";
import { useSessionState } from "@/lib/use-session-state";

export function AuditLogPage() {
  const [events, setEvents] = useState<AuditEventDto[] | null>(null);
  const [search, setSearch] = useSessionState("audit.search", "");
  const [types, setTypes] = useSessionState<string[]>("audit.types", []);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [sorting, setSorting] = useState<SortingState>([
    { id: "at", desc: true },
  ]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 50,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.audit().then(setEvents);
  }, []);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (events ?? []).filter(
      (event) =>
        (types.length === 0 || types.includes(event.type)) &&
        (!query ||
          `${auditLabel(event.type)} ${formatAuditDetail(event.detail)}`
            .toLowerCase()
            .includes(query)),
    );
  }, [events, search, types]);

  const columns = useMemo<AppColumn<AuditEventDto>[]>(
    () => [
      {
        id: "select",
        size: 40,
        enableSorting: false,
        header: ({ table }) => (
          <Checkbox
            aria-label="Alle Einträge auswählen"
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
            aria-label="Eintrag auswählen"
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(value === true)}
          />
        ),
      },
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
  const filtered = search !== "" || types.length > 0;

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
          value={search}
          onChange={setSearch}
        />
        <FacetedFilter
          title="Ereignis"
          selected={types}
          onChange={setTypes}
          options={typeOptions}
        />
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setTypes([]);
            }}
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
