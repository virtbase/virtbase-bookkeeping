import { formatEuro } from "@shared/money.ts";
import type {
  Granularity,
  StatBucket,
  Statistics,
} from "@shared/statistics.ts";
import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ComposedChart,
  LabelList,
  Rectangle,
  XAxis,
  YAxis,
} from "@/components/ui/chart";
import { usePrivacy } from "@/lib/preferences";

interface ChartRow {
  key: string;
  label: string;
  partial: boolean;
  projected: boolean;
  forecast: number | null;
  [series: string]: string | number | boolean | null;
}

const euroAxis = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const signedEuro = (cents: number) =>
  `${cents < 0 ? "−" : ""}${formatEuro(cents)}`;
const axisEuro = (cents: number) => euroAxis.format(cents / 100);
const TOP_RADIUS: [number, number, number, number] = [4, 4, 0, 0];
const FORECAST_SERIES = "forecastRest";
const FORECAST_COLOR = "var(--muted-foreground)";
const FEE_SERIES = [
  { key: "stripe", label: "Stripe-Gebühren", color: "var(--chart-1)" },
  { key: "paypal", label: "PayPal-Gebühren", color: "var(--chart-3)" },
];

export function chartColor(allGroups: string[], name: string): string {
  return `var(--chart-${(allGroups.indexOf(name) % 8) + 1})`;
}

function seriesKey(allGroups: string[], name: string): string {
  return `s${allGroups.indexOf(name)}`;
}

function topSeries(row: ChartRow, keys: string[]): string | undefined {
  return keys.findLast((key) => Number(row[key] ?? 0) > 0);
}

interface StackedBarProps {
  series: string;
  keys: string[];
  payload: ChartRow;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
}

function barOpacity(series: string, row: ChartRow): number {
  if (series === FORECAST_SERIES) {
    return 0.35;
  }
  return row.partial ? 0.5 : 1;
}

function StackedBar({ series, keys, payload, ...shape }: StackedBarProps) {
  return (
    <Rectangle
      {...shape}
      stroke="var(--background)"
      strokeWidth={2}
      fillOpacity={barOpacity(series, payload)}
      radius={topSeries(payload, keys) === series ? TOP_RADIUS : 0}
    />
  );
}

function Swatch({ color, faded }: { color: string; faded?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="size-2.5 shrink-0 rounded-[3px]"
      style={{ background: color, opacity: faded ? 0.35 : 1 }}
    />
  );
}

function TooltipLine({
  label,
  value,
  children,
  strong,
}: {
  label: string;
  value: string;
  children?: ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      {children}
      <span className={strong ? "font-medium" : "text-muted-foreground"}>
        {label}
      </span>
      <span className="ml-auto pl-4 font-mono tabular-nums">{value}</span>
    </div>
  );
}

function TooltipBox({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-44 gap-1.5 rounded-lg border bg-popover px-3 py-2 text-popover-foreground text-xs shadow-md">
      <div className="flex items-center justify-between gap-4">
        <span className="font-medium">{title}</span>
        {note && <span className="text-muted-foreground">{note}</span>}
      </div>
      {children}
    </div>
  );
}

function forecastRest(bucket: StatBucket): number {
  return Math.max(
    0,
    (bucket.forecastCents ?? 0) - Math.max(0, bucket.totalCents),
  );
}

function labelOf(rows: ChartRow[], key: string): string {
  return rows.find((row) => row.key === key)?.label ?? "";
}

function noteOf(row: ChartRow): string | undefined {
  if (row.projected) {
    return "Prognose";
  }
  return row.partial ? "laufend" : undefined;
}

interface PanelProps {
  title: string;
  aside?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

export function Panel({ title, aside, footer, children }: PanelProps) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <h2 className="font-medium text-sm">{title}</h2>
        {aside}
      </div>
      {children}
      {footer && <p className="text-muted-foreground text-xs">{footer}</p>}
    </section>
  );
}

function Legend({
  items,
}: {
  items: { label: string; value?: string; color: string; faded?: boolean }[];
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <Swatch color={item.color} faded={item.faded} />
          <span className="text-muted-foreground">{item.label}</span>
          {item.value && (
            <span className="font-mono tabular-nums">{item.value}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

const NO_FORECAST =
  "Für eine Prognose fehlen noch abgeschlossene Zeiträume, oder der Zeitraum endet vor heute.";
export const PERIOD_UNITS: Record<Granularity, string> = {
  day: "Tage",
  week: "Wochen",
  month: "Monate",
};

interface RevenueChartProps {
  statistics: Statistics;
  title: string;
}

export function RevenueChart({ statistics, title }: RevenueChartProps) {
  const { allGroups, buckets, groups, forecast } = statistics;
  const { mask } = usePrivacy();
  const keys = groups.map((group) => seriesKey(allGroups, group.name));
  const config: ChartConfig = Object.fromEntries(
    groups.map((group) => [
      seriesKey(allGroups, group.name),
      { label: group.name, color: chartColor(allGroups, group.name) },
    ]),
  );
  const stacked = [...keys, FORECAST_SERIES];
  const data: ChartRow[] = buckets.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    partial: bucket.partial,
    projected: bucket.projected,
    forecast: bucket.forecastCents,
    [FORECAST_SERIES]: forecastRest(bucket),
    ...(bucket.projected
      ? {}
      : Object.fromEntries(
          groups.map((group) => [
            seriesKey(allGroups, group.name),
            bucket.groups[group.name] ?? 0,
          ]),
        )),
  }));

  return (
    <Panel
      title={title}
      aside={
        <Legend
          items={[
            ...groups.map((group) => ({
              label: group.name,
              value: mask(formatEuro(group.totalCents)),
              color: chartColor(allGroups, group.name),
            })),
            ...(forecast
              ? [{ label: "Prognose", color: FORECAST_COLOR, faded: true }]
              : []),
          ]}
        />
      }
      footer={forecast ? undefined : NO_FORECAST}
    >
      <ChartContainer config={config} className="aspect-auto h-72 w-full">
        <ComposedChart
          data={data}
          stackOffset="sign"
          margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
        >
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="key"
            tickFormatter={(key) => labelOf(data, key)}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            tickMargin={8}
          />
          <YAxis
            tickFormatter={(cents) => mask(axisEuro(cents))}
            tickLine={false}
            axisLine={false}
            width="auto"
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", fillOpacity: 0.6 }}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as ChartRow | undefined;
              if (!active || !row) {
                return null;
              }
              const total = keys.reduce(
                (sum, key) => sum + Number(row[key] ?? 0),
                0,
              );
              return (
                <TooltipBox title={row.label} note={noteOf(row)}>
                  {!row.projected &&
                    groups.map((group) => {
                      const key = seriesKey(allGroups, group.name);
                      return (
                        <TooltipLine
                          key={key}
                          label={group.name}
                          value={mask(signedEuro(Number(row[key] ?? 0)))}
                        >
                          <Swatch color={chartColor(allGroups, group.name)} />
                        </TooltipLine>
                      );
                    })}
                  {!row.projected && groups.length > 1 && (
                    <TooltipLine
                      strong
                      label="Gesamt"
                      value={mask(signedEuro(total))}
                    />
                  )}
                  {row.forecast !== null && (
                    <TooltipLine
                      label="Prognose"
                      value={mask(signedEuro(row.forecast))}
                    >
                      <Swatch color={FORECAST_COLOR} faded />
                    </TooltipLine>
                  )}
                </TooltipBox>
              );
            }}
          />
          {keys.map((key) => (
            <Bar
              key={key}
              dataKey={key}
              stackId="revenue"
              fill={`var(--color-${key})`}
              maxBarSize={24}
              isAnimationActive={false}
              shape={(props) => (
                <StackedBar
                  {...(props as unknown as StackedBarProps)}
                  series={key}
                  keys={stacked}
                />
              )}
            />
          ))}
          {forecast && (
            <Bar
              dataKey={FORECAST_SERIES}
              stackId="revenue"
              fill={FORECAST_COLOR}
              maxBarSize={24}
              isAnimationActive={false}
              shape={(props) => (
                <StackedBar
                  {...(props as unknown as StackedBarProps)}
                  series={FORECAST_SERIES}
                  keys={stacked}
                />
              )}
            />
          )}
        </ComposedChart>
      </ChartContainer>
    </Panel>
  );
}

export function ProductChart({ statistics }: { statistics: Statistics }) {
  const { mask } = usePrivacy();
  const data = statistics.products.filter((item) => item.totalCents > 0);
  const config: ChartConfig = {
    totalCents: { label: "Umsatz", color: "var(--chart-7)" },
  };
  return (
    <Panel title="Umsatz nach Produkt">
      {data.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">
          Keine Umsätze in diesem Zeitraum.
        </p>
      ) : (
        <ChartContainer
          config={config}
          className="aspect-auto w-full"
          style={{ height: Math.max(120, data.length * 34) }}
        >
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 84, bottom: 0, left: 0 }}
          >
            <XAxis type="number" hide domain={[0, "dataMax"]} />
            <YAxis
              type="category"
              dataKey="name"
              tickLine={false}
              axisLine={false}
              width="auto"
            />
            <ChartTooltip
              cursor={{ fill: "var(--muted)", fillOpacity: 0.6 }}
              content={({ active, payload }) => {
                const item = payload?.[0]?.payload as
                  | (typeof data)[number]
                  | undefined;
                return active && item ? (
                  <TooltipBox title={item.name}>
                    <TooltipLine
                      label="Umsatz"
                      value={mask(signedEuro(item.totalCents))}
                    />
                  </TooltipBox>
                ) : null;
              }}
            />
            <Bar
              dataKey="totalCents"
              fill="var(--color-totalCents)"
              radius={[0, 4, 4, 0]}
              maxBarSize={20}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="totalCents"
                position="right"
                formatter={(value) => mask(formatEuro(Number(value)))}
                className="fill-foreground font-mono"
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      )}
    </Panel>
  );
}

export function FeeChart({ statistics }: { statistics: Statistics }) {
  const { mask } = usePrivacy();
  const data: ChartRow[] = statistics.buckets
    .filter((bucket) => !bucket.projected)
    .map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      partial: bucket.partial,
      projected: false,
      forecast: null,
      stripe: bucket.stripeFeeCents,
      paypal: bucket.passthroughFeeCents,
    }));
  const keys = FEE_SERIES.map((series) => series.key);
  const config: ChartConfig = Object.fromEntries(
    FEE_SERIES.map((series) => [
      series.key,
      { label: series.label, color: series.color },
    ]),
  );
  const sum = (key: string) =>
    data.reduce((total, row) => total + Number(row[key] ?? 0), 0);

  return (
    <Panel
      title="Gebühren"
      aside={
        <Legend
          items={FEE_SERIES.map((series) => ({
            label: series.label,
            value: mask(formatEuro(sum(series.key))),
            color: series.color,
          }))}
        />
      }
    >
      <ChartContainer config={config} className="aspect-auto h-60 w-full">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="key"
            tickFormatter={(key) => labelOf(data, key)}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            tickMargin={8}
          />
          <YAxis
            tickFormatter={(cents) => mask(axisEuro(cents))}
            tickLine={false}
            axisLine={false}
            width="auto"
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", fillOpacity: 0.6 }}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as ChartRow | undefined;
              return active && row ? (
                <TooltipBox title={row.label} note={noteOf(row)}>
                  {FEE_SERIES.map((series) => (
                    <TooltipLine
                      key={series.key}
                      label={series.label}
                      value={mask(formatEuro(Number(row[series.key] ?? 0)))}
                    >
                      <Swatch color={series.color} />
                    </TooltipLine>
                  ))}
                </TooltipBox>
              ) : null;
            }}
          />
          {FEE_SERIES.map((series) => (
            <Bar
              key={series.key}
              dataKey={series.key}
              stackId="fees"
              fill={series.color}
              maxBarSize={24}
              isAnimationActive={false}
              shape={(props) => (
                <StackedBar
                  {...(props as unknown as StackedBarProps)}
                  series={series.key}
                  keys={keys}
                />
              )}
            />
          ))}
        </BarChart>
      </ChartContainer>
    </Panel>
  );
}
