import { formatEuro } from "@shared/money.ts";
import {
  buildStatistics,
  type Granularity,
  type GroupBy,
  renderStatisticsCsv,
  type SourceLabels,
  type StatBucket,
  type StatisticsDto,
  shiftDay,
  shiftMonth,
  suggestedGranularity,
} from "@shared/statistics.ts";
import type { Source } from "@shared/types.ts";
import {
  type PaginationState,
  type SortingState,
  useTable,
} from "@tanstack/react-table";
import {
  Download,
  Euro,
  type LucideIcon,
  Receipt,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  type AppColumn,
  DataTable,
  SortHeader,
} from "@/components/data-table/data-table";
import { DateRangeFilter } from "@/components/data-table/date-range-filter";
import { FacetedFilter } from "@/components/data-table/faceted-filter";
import { dataTableFeatures } from "@/components/data-table/features";
import { Private } from "@/components/private";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { downloadFile } from "@/lib/download";
import { countLabel, formatIsoDay } from "@/lib/format";
import { SOURCES } from "@/lib/sources";
import { cn } from "@/lib/utils";
import {
  FeeChart,
  PERIOD_UNITS,
  ProductChart,
  RevenueChart,
} from "./statistics-charts";

type Preset = "30" | "90" | "12m" | "year";

const PRESETS: { value: Preset; label: string }[] = [
  { value: "30", label: "30 Tage" },
  { value: "90", label: "90 Tage" },
  { value: "12m", label: "12 Monate" },
  { value: "year", label: "Dieses Jahr" },
];
const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: "day", label: "Tag" },
  { value: "week", label: "Woche" },
  { value: "month", label: "Monat" },
];
const GROUPINGS: { value: GroupBy; label: string }[] = [
  { value: "source", label: "Quelle" },
  { value: "account", label: "Konto" },
];
const REVENUE_SOURCES: Source[] = ["stripe", "monero"];
const SOURCE_LABELS: SourceLabels = {
  stripe: SOURCES.stripe.label,
  monero: SOURCES.monero.label,
  fees: SOURCES.fees.label,
};
const MAX_DAY_SPAN = 120;
function presetStart(preset: Preset, today: string): string {
  if (preset === "30") {
    return shiftDay(today, -29);
  }
  if (preset === "90") {
    return shiftDay(today, -89);
  }
  return preset === "12m"
    ? shiftMonth(today, -11)
    : `${today.slice(0, 4)}-01-01`;
}

function signedEuro(cents: number): string {
  return `${cents < 0 ? "−" : ""}${formatEuro(cents)}`;
}

function comparison(current: number, previous: number): string {
  if (previous <= 0) {
    return "Kein Vergleichszeitraum";
  }
  const change = Math.round(((current - previous) / previous) * 100);
  return `${change > 0 ? "+" : change < 0 ? "−" : "±"}${Math.abs(change).toLocaleString("de-DE")} % zum Vorzeitraum`;
}

function feeShare(fees: number, revenue: number): string {
  if (revenue <= 0) {
    return "Keine Umsätze";
  }
  const share = (fees / revenue) * 100;
  return `${share.toLocaleString("de-DE", { maximumFractionDigits: 1 })} % vom Umsatz`;
}

function periodLabel(bucket: StatBucket, granularity: Granularity): string {
  if (granularity === "month") {
    return bucket.label;
  }
  const day = formatIsoDay(bucket.key);
  return granularity === "week" ? `ab ${day}` : day;
}

interface SegmentedProps<T extends string> {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  disabled?: T[];
  onChange: (value: T) => void;
}

function Segmented<T extends string>({
  label,
  options,
  value,
  disabled = [],
  onChange,
}: SegmentedProps<T>) {
  return (
    <fieldset className="flex h-8 items-center gap-0.5 rounded-md border p-0.5">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          disabled={disabled.includes(option.value)}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-6.5 rounded-[5px] px-2 font-medium text-xs disabled:pointer-events-none disabled:opacity-40",
            option.value === value
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

function Tile({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  hint: ReactNode;
  icon: LucideIcon;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-sm">{label}</span>
        <Icon
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </div>
      <span className="truncate font-bold text-2xl tabular-nums">{value}</span>
      <span className="truncate text-muted-foreground text-xs">{hint}</span>
    </div>
  );
}

function euroCell(cents: number | null) {
  return (
    <div className="text-right font-mono text-[13px]">
      {cents === null ? "—" : <Private>{signedEuro(cents)}</Private>}
    </div>
  );
}

export function StatisticsPage() {
  const [data, setData] = useState<StatisticsDto | null>(null);

  useEffect(() => {
    api
      .statistics()
      .then(setData)
      .catch((error: Error) => toast.error(error.message));
  }, []);

  return data ? (
    <StatisticsView data={data} />
  ) : (
    <div className="grid gap-3">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-80 w-full" />
    </div>
  );
}

function StatisticsView({ data }: { data: StatisticsDto }) {
  const { rows, today } = data;
  const [preset, setPreset] = useState<Preset | null>("12m");
  const [{ from, to }, setRange] = useState({
    from: presetStart("12m", today),
    to: today,
  });
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [groupBy, setGroupBy] = useState<GroupBy>("source");
  const [sources, setSources] = useState<Source[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  });
  const [sorting, setSorting] = useState<SortingState>([
    { id: "key", desc: true },
  ]);

  const statistics = useMemo(
    () =>
      buildStatistics(
        rows,
        { from, to, granularity, groupBy, sources, today },
        SOURCE_LABELS,
      ),
    [rows, from, to, granularity, groupBy, sources, today],
  );

  const columns = useMemo<AppColumn<StatBucket>[]>(
    () => [
      {
        accessorKey: "key",
        size: 0,
        header: ({ column }) => <SortHeader column={column} label="Zeitraum" />,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {periodLabel(row.original, granularity)}
            {(row.original.partial || row.original.projected) && (
              <span className="ml-2 text-muted-foreground text-xs">
                {row.original.projected ? "Prognose" : "laufend"}
              </span>
            )}
          </span>
        ),
      },
      ...statistics.groups.map(
        (group): AppColumn<StatBucket> => ({
          id: `group-${group.name}`,
          size: 128,
          enableSorting: false,
          header: () => <div className="text-right">{group.name}</div>,
          cell: ({ row }) =>
            euroCell(
              row.original.projected
                ? null
                : (row.original.groups[group.name] ?? 0),
            ),
        }),
      ),
      {
        id: "revenue",
        size: 128,
        enableSorting: false,
        header: () => <div className="text-right">Umsatz</div>,
        cell: ({ row }) =>
          euroCell(row.original.projected ? null : row.original.totalCents),
      },
      {
        id: "fees",
        size: 128,
        enableSorting: false,
        header: () => <div className="text-right">Gebühren</div>,
        cell: ({ row }) =>
          euroCell(
            row.original.projected
              ? null
              : row.original.stripeFeeCents + row.original.passthroughFeeCents,
          ),
      },
      {
        id: "net",
        size: 128,
        enableSorting: false,
        header: () => <div className="text-right">Netto</div>,
        cell: ({ row }) =>
          euroCell(row.original.projected ? null : row.original.netCents),
      },
      {
        id: "forecast",
        size: 128,
        enableSorting: false,
        header: () => <div className="text-right">Prognose</div>,
        cell: ({ row }) => euroCell(row.original.forecastCents),
      },
    ],
    [statistics.groups, granularity],
  );

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: statistics.buckets,
    getRowId: (row) => row.key,
    state: { pagination, sorting, rowSelection: {} },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
  });

  const firstPage = () => setPagination({ ...pagination, pageIndex: 0 });

  const choosePreset = (value: Preset) => {
    const start = presetStart(value, today);
    setPreset(value);
    setRange({ from: start, to: today });
    setGranularity(suggestedGranularity(start, today));
    firstPage();
  };

  const chooseRange = (start: string | null, end: string | null) => {
    if (!start) {
      choosePreset("12m");
      return;
    }
    const last = end ?? start;
    setPreset(null);
    setRange({ from: start, to: last });
    setGranularity(suggestedGranularity(start, last));
    firstPage();
  };

  const exportCsv = async () => {
    try {
      downloadFile(
        `statistik_${from}_${to}_${granularity}.csv`,
        renderStatisticsCsv(statistics, granularity),
      );
      await api.statisticsExported(statistics.buckets.length);
      toast(
        `${countLabel(statistics.buckets.length, "Zeile", "Zeilen")} exportiert.`,
      );
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const sourceOptions = REVENUE_SOURCES.map((value) => ({
    value,
    label: SOURCES[value].label,
    icon: SOURCES[value].icon,
    count: rows.filter(
      (row) =>
        row.source === value &&
        row.day >= from &&
        row.day <= to &&
        row.revenueCents !== 0,
    ).length,
  }));
  const dayDisabled =
    shiftDay(from, MAX_DAY_SPAN).localeCompare(to) < 0
      ? (["day"] as const)
      : [];
  const { forecast, totals, previous } = statistics;

  return (
    <>
      <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-2">
        <Segmented
          label="Zeitraum wählen"
          options={PRESETS}
          value={preset}
          onChange={choosePreset}
        />
        <DateRangeFilter
          title="Zeitraum"
          from={preset ? null : from}
          to={preset ? null : to}
          onChange={chooseRange}
        />
        <FacetedFilter
          title="Quelle"
          options={sourceOptions}
          selected={sources}
          onChange={(selected) => {
            setSources(selected);
            firstPage();
          }}
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented
            label="Auflösung"
            options={GRANULARITIES}
            value={granularity}
            disabled={[...dayDisabled]}
            onChange={(value) => {
              setGranularity(value);
              firstPage();
            }}
          />
          <Segmented
            label="Gruppierung"
            options={GROUPINGS}
            value={groupBy}
            onChange={setGroupBy}
          />
          <Button variant="outline" size="sm" onClick={() => void exportCsv()}>
            <Download />
            CSV exportieren
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Umsatz brutto"
          icon={Euro}
          value={<Private>{signedEuro(totals.revenueCents)}</Private>}
          hint={
            <Private>
              {comparison(totals.revenueCents, previous.revenueCents)}
            </Private>
          }
        />
        <Tile
          label="Gebühren"
          icon={Receipt}
          value={<Private>{formatEuro(totals.feeCents)}</Private>}
          hint={
            <Private>{feeShare(totals.feeCents, totals.revenueCents)}</Private>
          }
        />
        <Tile
          label="Netto nach Gebühren"
          icon={Wallet}
          value={<Private>{signedEuro(totals.netCents)}</Private>}
          hint={
            <Private>{comparison(totals.netCents, previous.netCents)}</Private>
          }
        />
        <Tile
          label={forecast ? `Prognose bis ${forecast.untilLabel}` : "Prognose"}
          icon={TrendingUp}
          value={
            forecast ? (
              <Private>{formatEuro(forecast.totalCents)}</Private>
            ) : (
              "—"
            )
          }
          hint={
            forecast
              ? `Nächste ${forecast.horizon} ${PERIOD_UNITS[granularity]}`
              : "Noch nicht verfügbar"
          }
        />
      </div>

      <RevenueChart
        statistics={statistics}
        title={
          groupBy === "source" ? "Umsatz nach Quelle" : "Umsatz nach Konto"
        }
      />

      <div className="grid gap-3 xl:grid-cols-2">
        <ProductChart statistics={statistics} />
        <FeeChart statistics={statistics} />
      </div>

      <DataTable
        table={table}
        footer={countLabel(statistics.buckets.length, "Zeitraum", "Zeiträume")}
        empty="Keine Daten in diesem Zeitraum."
      />
    </>
  );
}
