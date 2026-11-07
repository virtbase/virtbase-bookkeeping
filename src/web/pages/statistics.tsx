import { formatEuro } from "@shared/money.ts";
import { bucketEnd } from "@shared/periods.ts";
import type {
  Granularity,
  GroupBy,
  SourceLabels,
  StatBucket,
  StatisticsDto,
} from "@shared/statistics.ts";
import {
  buildStatistics,
  customerOptions,
  MORE,
  productOptions,
  renderStatisticsCsv,
  shiftDay,
  suggestedGranularity,
} from "@shared/statistics.ts";
import type { Source } from "@shared/types.ts";
import type { SortingState } from "@tanstack/react-table";
import { useTable } from "@tanstack/react-table";
import type { LucideIcon } from "lucide-react";
import {
  CreditCard,
  Download,
  Euro,
  Receipt,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { AppColumn } from "@/components/data-table/data-table";
import { DataTable, SortHeader } from "@/components/data-table/data-table";
import { DateRangeFilter } from "@/components/data-table/date-range-filter";
import { FacetedFilter } from "@/components/data-table/faceted-filter";
import { dataTableFeatures } from "@/components/data-table/features";
import { Private } from "@/components/private";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { downloadFile } from "@/lib/download";
import { useStoredFilter } from "@/lib/filter-state";
import { countLabel, formatIsoDay } from "@/lib/format";
import { STATISTICS_VIEW, showTransactions } from "@/lib/navigate";
import { usePrivacy } from "@/lib/preferences";
import { SOURCES } from "@/lib/sources";
import type {
  Preset,
  StatisticsView as ViewState,
} from "@/lib/statistics-view";
import {
  DEFAULT_STATISTICS_VIEW,
  presetStart,
  withPreset,
} from "@/lib/statistics-view";
import type { TransactionFilter } from "@/lib/transaction-filter";
import { contextFilter } from "@/lib/transaction-filter";
import {
  FeeChart,
  PERIOD_UNITS,
  ProductChart,
  RevenueChart,
} from "./statistics-charts";

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
  { value: "customer", label: "Kunden" },
];
const CHART_TITLES: Record<GroupBy, string> = {
  source: "Umsatz nach Quelle",
  account: "Umsatz nach Konto",
  customer: "Umsatz nach Kunden",
};
const REVENUE_SOURCES: Source[] = ["stripe", "monero"];
const SOURCE_LABELS: SourceLabels = {
  stripe: SOURCES.stripe.label,
  monero: SOURCES.monero.label,
  fees: SOURCES.fees.label,
};
const MAX_DAY_SPAN = 120;

function bucketPeriod(
  buckets: StatBucket[],
  key: string,
  { granularity, from, to }: Pick<ViewState, "granularity" | "from" | "to">,
) {
  const bucket = buckets.find((entry) => entry.key === key);
  if (!bucket || bucket.projected) {
    return null;
  }
  const end = bucketEnd(key, granularity);
  return {
    range: null,
    from: key < from ? from : key,
    to: end > to ? to : end,
  };
}

function signedEuro(cents: number): string {
  return `${cents < 0 ? "−" : ""}${formatEuro(cents)}`;
}

function comparison(current: number, previous: number | null): string {
  if (previous === null) {
    return "Kein vollständiger Vorzeitraum";
  }
  if (previous <= 0) {
    return "Kein Vergleichszeitraum";
  }
  const change = Math.round(((current - previous) / previous) * 100);
  return `${change > 0 ? "+" : change < 0 ? "−" : "±"}${Math.abs(change).toLocaleString("de-DE")} % zum Vorzeitraum`;
}

function averagePayment(cents: number, count: number): string {
  return count > 0
    ? `Ø ${formatEuro(Math.round(cents / count))} je Zahlung`
    : "Keine Zahlungen";
}

function customerNote(fresh: number, returning: number): string {
  return `${countLabel(fresh, "Kunde hat", "Kunden haben")} im Zeitraum zum ersten Mal gezahlt, ${countLabel(returning, "Kunde", "Kunden")} schon vorher. Erkannt am Namen.`;
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

const wholeEuro = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 0,
});

function euroRange(lowCents: number, highCents: number): string {
  return `${wholeEuro.format(lowCents / 100)}–${wholeEuro.format(highCents / 100)} €`;
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
  const { mask } = usePrivacy();
  const {
    filter: stored,
    update,
    pagination,
    setPagination,
  } = useStoredFilter<ViewState>(STATISTICS_VIEW, DEFAULT_STATISTICS_VIEW, 25);
  const view = useMemo(() => withPreset(stored, today), [stored, today]);
  const {
    preset,
    from,
    to,
    granularity,
    groupBy,
    sources,
    customers,
    products,
  } = view;
  const [sorting, setSorting] = useState<SortingState>([
    { id: "key", desc: true },
  ]);

  const statistics = useMemo(
    () => buildStatistics(rows, { ...view, today }, SOURCE_LABELS),
    [rows, view, today],
  );
  const customerChoices = useMemo(() => customerOptions(rows), [rows]);
  const productChoices = useMemo(() => productOptions(rows), [rows]);

  const showBucket = useCallback(
    (key: string, scope: Partial<TransactionFilter>) => {
      const period = bucketPeriod(statistics.buckets, key, view);
      if (period) {
        showTransactions(
          contextFilter({
            ...period,
            customers: view.customers,
            products: view.products,
            ...scope,
          }),
        );
      }
    },
    [statistics.buckets, view],
  );
  const showRevenue = useCallback(
    (key: string) => showBucket(key, { sources, revenueOnly: true }),
    [showBucket, sources],
  );
  const showFees = (key: string) => showBucket(key, { sources: ["stripe"] });

  const toggleProduct = (name: string) => {
    if (name === MORE) {
      return;
    }
    update({
      products: products.includes(name)
        ? products.filter((entry) => entry !== name)
        : [...products, name],
    });
  };

  const columns = useMemo<AppColumn<StatBucket>[]>(
    () => [
      {
        accessorKey: "key",
        size: 0,
        header: ({ column }) => <SortHeader column={column} label="Zeitraum" />,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.projected ? (
              periodLabel(row.original, granularity)
            ) : (
              <button
                type="button"
                className="hover:underline"
                title="Zeilen dieses Zeitraums anzeigen"
                onClick={() => showRevenue(row.original.key)}
              >
                {periodLabel(row.original, granularity)}
              </button>
            )}
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
    [statistics.groups, granularity, showRevenue],
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

  const choosePreset = (value: Preset) => {
    const start = presetStart(value, today);
    update({
      preset: value,
      granularity: suggestedGranularity(start, today),
    });
  };

  const chooseRange = (start: string | null, end: string | null) => {
    if (!start) {
      choosePreset("12m");
      return;
    }
    const last = end ?? start;
    update({
      preset: null,
      from: start,
      to: last,
      granularity: suggestedGranularity(start, last),
    });
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
          onChange={(sources) => update({ sources })}
        />
        <FacetedFilter
          title="Kunde"
          searchable
          options={customerChoices.map((option) => ({
            ...option,
            label: mask(option.label),
          }))}
          selected={customers}
          onChange={(customers) => update({ customers })}
        />
        <FacetedFilter
          title="Produkt"
          searchable
          options={productChoices}
          selected={products}
          onChange={(products) => update({ products })}
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented
            label="Auflösung"
            options={GRANULARITIES}
            value={granularity}
            disabled={[...dayDisabled]}
            onChange={(granularity) => update({ granularity })}
          />
          <Segmented
            label="Gruppierung"
            options={GROUPINGS}
            value={groupBy}
            onChange={(value) => update({ groupBy: value })}
          />
          <Button variant="outline" size="sm" onClick={() => void exportCsv()}>
            <Download />
            CSV exportieren
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Tile
          label="Umsatz brutto"
          icon={Euro}
          value={<Private>{signedEuro(totals.revenueCents)}</Private>}
          hint={
            <Private>
              {comparison(totals.revenueCents, previous?.revenueCents ?? null)}
            </Private>
          }
        />
        <Tile
          label="Zahlungen"
          icon={CreditCard}
          value={<Private>{totals.payments.toLocaleString("de-DE")}</Private>}
          hint={
            <Private>
              {averagePayment(totals.paymentCents, totals.payments)}
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
            <Private>
              {comparison(totals.netCents, previous?.netCents ?? null)}
            </Private>
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
            forecast ? (
              forecast.lowCents !== null && forecast.highCents !== null ? (
                <>
                  Meist{" "}
                  <Private>
                    {euroRange(forecast.lowCents, forecast.highCents)}
                  </Private>
                </>
              ) : (
                `Nächste ${forecast.horizon} ${PERIOD_UNITS[granularity]}`
              )
            ) : (
              "Noch nicht verfügbar"
            )
          }
        />
      </div>

      <RevenueChart
        statistics={statistics}
        onSelect={showRevenue}
        title={CHART_TITLES[groupBy]}
        note={
          groupBy === "customer"
            ? customerNote(
                statistics.customers.new,
                statistics.customers.returning,
              )
            : undefined
        }
      />

      <div className="grid gap-3 xl:grid-cols-2">
        <ProductChart
          statistics={statistics}
          selected={products}
          onSelect={toggleProduct}
        />
        <FeeChart statistics={statistics} onSelect={showFees} />
      </div>

      <DataTable
        table={table}
        footer={countLabel(statistics.buckets.length, "Zeitraum", "Zeiträume")}
        empty="Keine Daten in diesem Zeitraum."
      />
    </>
  );
}
