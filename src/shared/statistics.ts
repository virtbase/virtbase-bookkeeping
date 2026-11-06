import { neutralizeField, quoteField } from "./csv.ts";
import type { Source } from "./types.ts";

export type Granularity = "day" | "week" | "month";
export type GroupBy = "source" | "account";

export interface StatRow {
  day: string;
  feeDay: string;
  source: Source;
  account: string;
  revenueCents: number;
  stripeFeeCents: number;
  passthroughFeeCents: number;
  product: string | null;
  payment: boolean;
}

export interface StatOptions {
  from: string;
  to: string;
  granularity: Granularity;
  groupBy: GroupBy;
  sources: Source[];
  today: string;
}

export interface StatBucket {
  key: string;
  label: string;
  groups: Record<string, number>;
  totalCents: number;
  stripeFeeCents: number;
  passthroughFeeCents: number;
  netCents: number;
  partial: boolean;
  forecastCents: number | null;
  projected: boolean;
}

export interface StatGroup {
  name: string;
  totalCents: number;
}

export interface StatTotals {
  revenueCents: number;
  feeCents: number;
  netCents: number;
  payments: number;
}

export interface StatForecast {
  basis: number;
  horizon: number;
  totalCents: number;
  untilLabel: string;
}

export interface StatisticsDto {
  rows: StatRow[];
  today: string;
}

export interface Statistics {
  buckets: StatBucket[];
  groups: StatGroup[];
  allGroups: string[];
  products: StatGroup[];
  totals: StatTotals;
  previous: StatTotals;
  forecast: StatForecast | null;
}

const MINIMUM_HISTORY: Record<Granularity, number> = {
  day: 14,
  week: 4,
  month: 3,
};
const FORECAST_BASIS: Record<Granularity, number> = {
  day: 28,
  week: 12,
  month: 12,
};
const FORECAST_HORIZON: Record<Granularity, number> = {
  day: 14,
  week: 6,
  month: 3,
};
const MAX_PRODUCTS = 6;
const OTHER = "Sonstige";
const SOURCE_ORDER: Source[] = ["stripe", "monero", "fees"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mär",
  "Apr",
  "Mai",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dez",
];

function toUtc(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function shiftDay(day: string, days: number): string {
  const date = toUtc(day);
  date.setUTCDate(date.getUTCDate() + days);
  return toDay(date);
}

export function shiftMonth(day: string, months: number): string {
  const date = toUtc(`${day.slice(0, 7)}-01`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return toDay(date);
}

function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86400000);
}

export function bucketKey(day: string, granularity: Granularity): string {
  if (granularity === "day") {
    return day;
  }
  if (granularity === "month") {
    return `${day.slice(0, 7)}-01`;
  }
  const weekday = (toUtc(day).getUTCDay() + 6) % 7;
  return shiftDay(day, -weekday);
}

function nextKey(key: string, granularity: Granularity): string {
  if (granularity === "day") {
    return shiftDay(key, 1);
  }
  return granularity === "week" ? shiftDay(key, 7) : shiftMonth(key, 1);
}

function bucketKeys(
  from: string,
  to: string,
  granularity: Granularity,
): string[] {
  const keys: string[] = [];
  let key = bucketKey(from, granularity);
  const last = bucketKey(to, granularity);
  while (key <= last) {
    keys.push(key);
    key = nextKey(key, granularity);
  }
  return keys;
}

export function bucketLabel(key: string, granularity: Granularity): string {
  const [year = "", month = "1", day = ""] = key.split("-");
  if (granularity === "month") {
    return `${MONTHS[Number(month) - 1]} ${year.slice(2)}`;
  }
  return `${day}.${month}.`;
}

export function suggestedGranularity(from: string, to: string): Granularity {
  const span = daysBetween(from, to);
  if (span <= 45) {
    return "day";
  }
  return span <= 180 ? "week" : "month";
}

export function productLabel(text: string): string | null {
  const refund = /^REFUND FOR \w+ \((.+)\)$/.exec(text.trim());
  const cleaned = (refund?.[1] ?? text)
    .trim()
    .replace(/^Verlängerung\s+/, "")
    .replace(/\s+renewal$/i, "");
  if (/^Upgrade\b/.test(cleaned)) {
    return "Upgrade";
  }
  return /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/.test(cleaned) ? cleaned : null;
}

export function linearForecast(values: number[], horizon: number): number[] {
  const count = values.length;
  const meanX = (count - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / count;
  const spread = values.reduce((sum, _, x) => sum + (x - meanX) ** 2, 0);
  const slope = spread
    ? values.reduce((sum, y, x) => sum + (x - meanX) * (y - meanY), 0) / spread
    : 0;
  return Array.from({ length: horizon }, (_, step) =>
    Math.max(0, Math.round(meanY + slope * (count + step - meanX))),
  );
}

function groupName(
  row: StatRow,
  groupBy: GroupBy,
  labels: SourceLabels,
): string {
  return groupBy === "source" ? labels[row.source] : row.account;
}

export type SourceLabels = Record<Source, string>;

function totalsOf(rows: StatRow[], from: string, to: string): StatTotals {
  const earned = rows.filter((row) => row.day >= from && row.day <= to);
  const revenueCents = earned.reduce((sum, row) => sum + row.revenueCents, 0);
  const feeCents = rows
    .filter((row) => row.feeDay >= from && row.feeDay <= to)
    .reduce(
      (sum, row) => sum + row.stripeFeeCents + row.passthroughFeeCents,
      0,
    );
  return {
    revenueCents,
    feeCents,
    netCents: revenueCents - feeCents,
    payments: earned.filter((row) => row.payment).length,
  };
}

function rankedProducts(rows: StatRow[]): StatGroup[] {
  const sums = new Map<string, number>();
  for (const row of rows) {
    if (row.revenueCents !== 0) {
      const name = row.product ?? OTHER;
      sums.set(name, (sums.get(name) ?? 0) + row.revenueCents);
    }
  }
  const ranked = [...sums.entries()]
    .filter(([name]) => name !== OTHER)
    .map(([name, totalCents]) => ({ name, totalCents }))
    .sort((a, b) => b.totalCents - a.totalCents);
  const top = ranked.slice(0, MAX_PRODUCTS);
  const rest =
    (sums.get(OTHER) ?? 0) +
    ranked.slice(MAX_PRODUCTS).reduce((sum, item) => sum + item.totalCents, 0);
  return rest === 0 ? top : [...top, { name: OTHER, totalCents: rest }];
}

function emptyBucket(key: string, granularity: Granularity): StatBucket {
  return {
    key,
    label: bucketLabel(key, granularity),
    groups: {},
    totalCents: 0,
    stripeFeeCents: 0,
    passthroughFeeCents: 0,
    netCents: 0,
    partial: false,
    forecastCents: null,
    projected: false,
  };
}

function completedTotals(
  rows: StatRow[],
  granularity: Granularity,
  today: string,
): number[] {
  const earned = rows.filter((row) => row.revenueCents !== 0);
  const firstDay = earned.map((row) => row.day).sort()[0] ?? today;
  const current = bucketKey(today, granularity);
  const sums = new Map<string, number>();
  for (const row of earned) {
    const key = bucketKey(row.day, granularity);
    sums.set(key, (sums.get(key) ?? 0) + row.revenueCents);
  }
  return bucketKeys(firstDay, today, granularity)
    .filter((key) => key < current)
    .map((key) => sums.get(key) ?? 0)
    .slice(-FORECAST_BASIS[granularity]);
}

export function buildStatistics(
  rows: StatRow[],
  options: StatOptions,
  labels: SourceLabels,
): Statistics {
  const { from, to, granularity, groupBy, sources, today } = options;
  const allGroups = [
    ...new Set(
      SOURCE_ORDER.flatMap((source) =>
        rows
          .filter((row) => row.source === source)
          .map((row) => groupName(row, groupBy, labels))
          .sort((a, b) => a.localeCompare(b, "de-DE")),
      ),
    ),
  ];
  const scoped = rows.filter(
    (row) => sources.length === 0 || sources.includes(row.source),
  );
  const inRange = scoped.filter((row) => row.day >= from && row.day <= to);
  const span = daysBetween(from, to);
  const previousTo = shiftDay(from, -1);
  const previousFrom = shiftDay(previousTo, -span);
  const previous = totalsOf(scoped, previousFrom, previousTo);

  const currentKey = bucketKey(today, granularity);
  const buckets = new Map(
    bucketKeys(from, to, granularity).map((key) => [
      key,
      emptyBucket(key, granularity),
    ]),
  );
  for (const row of inRange) {
    const bucket = buckets.get(bucketKey(row.day, granularity));
    if (bucket) {
      const name = groupName(row, groupBy, labels);
      bucket.groups[name] = (bucket.groups[name] ?? 0) + row.revenueCents;
      bucket.totalCents += row.revenueCents;
      bucket.netCents += row.revenueCents;
    }
  }
  for (const row of scoped) {
    const bucket =
      row.feeDay >= from && row.feeDay <= to
        ? buckets.get(bucketKey(row.feeDay, granularity))
        : undefined;
    if (bucket) {
      bucket.stripeFeeCents += row.stripeFeeCents;
      bucket.passthroughFeeCents += row.passthroughFeeCents;
      bucket.netCents -= row.stripeFeeCents + row.passthroughFeeCents;
    }
  }
  const current = buckets.get(currentKey);
  if (current) {
    current.partial = true;
  }

  const history = completedTotals(scoped, granularity, today);
  let forecast: StatForecast | null = null;
  if (to >= today && history.length >= MINIMUM_HISTORY[granularity]) {
    const horizon = FORECAST_HORIZON[granularity];
    const projected = linearForecast(history, horizon + 1);
    let key = currentKey;
    let lastKey = currentKey;
    for (const cents of projected) {
      const bucket = buckets.get(key) ?? emptyBucket(key, granularity);
      bucket.forecastCents = cents;
      bucket.projected = key !== currentKey;
      buckets.set(key, bucket);
      lastKey = key;
      key = nextKey(key, granularity);
    }
    forecast = {
      basis: history.length,
      horizon,
      totalCents: projected.slice(1).reduce((sum, cents) => sum + cents, 0),
      untilLabel: bucketLabel(lastKey, granularity),
    };
  }

  const groupTotals = new Map<string, number>();
  for (const row of inRange) {
    const name = groupName(row, groupBy, labels);
    groupTotals.set(name, (groupTotals.get(name) ?? 0) + row.revenueCents);
  }

  return {
    buckets: [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)),
    groups: allGroups
      .filter((name) => groupTotals.has(name))
      .map((name) => ({ name, totalCents: groupTotals.get(name) ?? 0 })),
    allGroups,
    products: rankedProducts(inRange),
    totals: totalsOf(scoped, from, to),
    previous,
    forecast,
  };
}

function amount(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function renderStatisticsCsv(
  statistics: Statistics,
  granularity: Granularity,
): string {
  const names = statistics.groups.map((group) => group.name);
  const header = [
    "Zeitraum",
    ...names,
    "Umsatz",
    "Stripe-Gebühren",
    "PayPal-Gebühren",
    "Netto",
    "Prognose",
    "Art",
  ];
  const lines = statistics.buckets.map((bucket) => {
    const kind = bucket.projected
      ? "Prognose"
      : bucket.partial
        ? "Laufend"
        : "Abgeschlossen";
    return [
      bucket.key.slice(0, granularity === "month" ? 7 : 10),
      ...names.map((name) => amount(bucket.groups[name] ?? 0)),
      amount(bucket.totalCents),
      amount(bucket.stripeFeeCents),
      amount(bucket.passthroughFeeCents),
      amount(bucket.netCents),
      bucket.forecastCents === null ? "" : amount(bucket.forecastCents),
      kind,
    ]
      .map((field) => quoteField(field))
      .join(";");
  });
  const head = header
    .map((field) => quoteField(neutralizeField(field)))
    .join(";");
  return `${[head, ...lines].join("\r\n")}\r\n`;
}
