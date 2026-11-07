import { neutralizeField, quoteField } from "./csv.ts";
import {
  bucketRange,
  dailyRevenue,
  forecastBuckets,
  forecastRange,
} from "./forecast.ts";
import type { Granularity } from "./periods.ts";
import {
  bucketKey,
  bucketKeys,
  daysBetween,
  nextKey,
  shiftDay,
} from "./periods.ts";
import type { Source } from "./types.ts";

export type { Granularity } from "./periods.ts";
export { bucketKey, shiftDay, shiftMonth } from "./periods.ts";

export type GroupBy = "source" | "account" | "customer";

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
  customer: string | null;
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
  lowCents: number | null;
  highCents: number | null;
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
  paymentCents: number;
}

export interface StatCustomers {
  new: number;
  returning: number;
}

export interface StatForecast {
  basis: number;
  horizon: number;
  totalCents: number;
  lowCents: number | null;
  highCents: number | null;
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
  previous: StatTotals | null;
  customers: StatCustomers;
  forecast: StatForecast | null;
}

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

export const NEW_CUSTOMERS = "Neu";
export const RETURNING_CUSTOMERS = "Wiederkehrend";
const REFUNDS = "Rückerstattungen";
const UNNAMED = "Ohne Namen";
const CUSTOMER_GROUPS = [NEW_CUSTOMERS, RETURNING_CUSTOMERS, REFUNDS, UNNAMED];

function firstPayments(rows: StatRow[]): Map<string, string> {
  const first = new Map<string, string>();
  for (const row of rows) {
    if (row.customer && row.revenueCents > 0) {
      const seen = first.get(row.customer);
      if (!seen || row.day < seen) {
        first.set(row.customer, row.day);
      }
    }
  }
  return first;
}

function customerGroup(row: StatRow, first: Map<string, string>): string {
  if (row.revenueCents < 0) {
    return REFUNDS;
  }
  if (!row.customer) {
    return UNNAMED;
  }
  return first.get(row.customer) === row.day
    ? NEW_CUSTOMERS
    : RETURNING_CUSTOMERS;
}

function countCustomers(
  rows: StatRow[],
  first: Map<string, string>,
  from: string,
): StatCustomers {
  const fresh = new Set<string>();
  const known = new Set<string>();
  for (const row of rows) {
    const day = row.customer ? first.get(row.customer) : undefined;
    if (row.customer && day && row.revenueCents > 0) {
      (day >= from ? fresh : known).add(row.customer);
    }
  }
  return { new: fresh.size, returning: known.size };
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
    paymentCents: earned
      .filter((row) => row.payment)
      .reduce((sum, row) => sum + row.revenueCents, 0),
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
    lowCents: null,
    highCents: null,
    projected: false,
  };
}

export function buildStatistics(
  rows: StatRow[],
  options: StatOptions,
  labels: SourceLabels,
): Statistics {
  const { from, to, granularity, groupBy, sources, today } = options;
  const first = firstPayments(rows);
  const groupName = (row: StatRow) => {
    if (groupBy === "customer") {
      return customerGroup(row, first);
    }
    return groupBy === "source" ? labels[row.source] : row.account;
  };
  const allGroups =
    groupBy === "customer"
      ? CUSTOMER_GROUPS.filter((name) =>
          rows.some((row) => row.revenueCents !== 0 && groupName(row) === name),
        )
      : [
          ...new Set(
            SOURCE_ORDER.flatMap((source) =>
              rows
                .filter((row) => row.source === source)
                .map(groupName)
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
  const historyStart = scoped
    .filter((row) => row.revenueCents !== 0)
    .reduce<string | null>(
      (earliest, row) =>
        earliest === null || row.day < earliest ? row.day : earliest,
      null,
    );
  const previous =
    historyStart !== null && historyStart <= previousFrom
      ? totalsOf(scoped, previousFrom, previousTo)
      : null;

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
      const name = groupName(row);
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

  let forecast: StatForecast | null = null;
  if (to >= today) {
    const horizon = FORECAST_HORIZON[granularity];
    const daily = dailyRevenue(scoped);
    const plan = forecastBuckets(daily, today, granularity, horizon + 1);
    if (plan) {
      const spread = bucketRange(daily, today, granularity);
      let key = currentKey;
      let lastKey = currentKey;
      for (const [step, cents] of plan.values.entries()) {
        const bucket = buckets.get(key) ?? emptyBucket(key, granularity);
        const earned = step === 0 ? plan.earned : 0;
        bucket.forecastCents = cents;
        bucket.lowCents = spread
          ? Math.round(earned + (cents - earned) * spread.low)
          : null;
        bucket.highCents = spread
          ? Math.round(earned + (cents - earned) * spread.high)
          : null;
        bucket.projected = step > 0;
        buckets.set(key, bucket);
        lastKey = key;
        key = nextKey(key, granularity);
      }
      const totalCents = plan.values
        .slice(1)
        .reduce((sum, cents) => sum + cents, 0);
      const range = forecastRange(daily, today, granularity, horizon);
      forecast = {
        basis: plan.basis,
        horizon,
        totalCents,
        lowCents: range ? Math.round(totalCents * range.low) : null,
        highCents: range ? Math.round(totalCents * range.high) : null,
        untilLabel: bucketLabel(lastKey, granularity),
      };
    }
  }

  const groupTotals = new Map<string, number>();
  for (const row of inRange) {
    const name = groupName(row);
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
    customers: countCustomers(inRange, first, from),
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
