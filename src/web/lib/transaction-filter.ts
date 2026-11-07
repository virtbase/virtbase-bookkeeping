import type { KindGroup } from "@shared/kinds.ts";
import { kindGroup, reviewKey } from "@shared/kinds.ts";
import { formatEuro, plainAmount } from "@shared/money.ts";
import { bucketEnd, bucketKey, shiftMonth } from "@shared/periods.ts";
import type {
  Source,
  TransactionDto,
  TransactionStatus,
} from "@shared/types.ts";
import { isoDay } from "@/lib/format";

export type RangePreset =
  | "since-export"
  | "week"
  | "last-month"
  | "year"
  | "all";
export type Direction = "in" | "out";

export const RANGE_LABELS: Record<RangePreset, string> = {
  "since-export": "Seit letztem Export",
  week: "Diese Woche",
  "last-month": "Letzter Monat",
  year: "Dieses Jahr",
  all: "Gesamter Zeitraum",
};

export const KIND_LABELS: Record<KindGroup, string> = {
  payment: "Zahlung",
  refund: "Erstattung",
  payout: "Auszahlung",
  adjustment: "Anpassung",
  fee: "Gebühr",
  other: "Sonstige",
};

const REVIEW_LABELS: Record<string, string> = {
  name: "Name fehlt",
  type: "Unbekannter Typ",
  details: "Name und Produkt fehlen",
  rate: "Kurs fehlt",
};

export function reviewLabel(key: string): string {
  return REVIEW_LABELS[key] ?? key;
}

export interface TransactionFilter {
  search: string;
  statuses: TransactionStatus[];
  sources: Source[];
  kinds: KindGroup[];
  reasons: string[];
  methods: string[];
  direction: Direction | null;
  minCents: number | null;
  maxCents: number | null;
  range: RangePreset | null;
  from: string | null;
  to: string | null;
  batchId: number | null;
  customers: string[];
  products: string[];
  ids: string[];
  days: string[];
  revenueOnly: boolean;
}

export const DEFAULT_TRANSACTION_FILTER: TransactionFilter = {
  search: "",
  statuses: ["ready", "review"],
  sources: [],
  kinds: [],
  reasons: [],
  methods: [],
  direction: null,
  minCents: null,
  maxCents: null,
  range: "since-export",
  from: null,
  to: null,
  batchId: null,
  customers: [],
  products: [],
  ids: [],
  days: [],
  revenueOnly: false,
};

export function contextFilter(
  change: Partial<TransactionFilter>,
): Partial<TransactionFilter> {
  return { statuses: [], range: "all", ...change };
}

export function missingDaysFilter(days: string[]): Partial<TransactionFilter> {
  return contextFilter({
    days,
    sources: ["stripe"],
    statuses: ["ready", "review"],
  });
}

export const OPEN_FEES_FILTER: Partial<TransactionFilter> = {
  sources: ["fees"],
};

export function presetBounds(
  range: RangePreset,
  today: string,
): { from: string; to: string } | null {
  if (range === "week") {
    return { from: bucketKey(today, "week"), to: today };
  }
  if (range === "last-month") {
    const from = shiftMonth(today, -1);
    return { from, to: bucketEnd(from, "month") };
  }
  if (range === "year") {
    return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
  return null;
}

function dateBounds(
  filter: TransactionFilter,
  today: string,
): { from: string; to: string } | null {
  if (filter.range !== null) {
    return presetBounds(filter.range, today);
  }
  if (!filter.from) {
    return null;
  }
  return { from: filter.from, to: filter.to ?? filter.from };
}

const days = new WeakMap<TransactionDto, string>();
const texts = new WeakMap<TransactionDto, string>();

function dayOf(row: TransactionDto): string {
  let day = days.get(row);
  if (day === undefined) {
    day = isoDay(row.occurredAt);
    days.set(row, day);
  }
  return day;
}

export function searchText(row: TransactionDto): string {
  let text = texts.get(row);
  if (text === undefined) {
    text = [
      row.name ?? "",
      row.purpose,
      plainAmount(row.amountCents),
      (row.amountCents / 100).toFixed(2),
      formatEuro(row.amountCents),
    ]
      .join(" ")
      .toLowerCase();
    texts.set(row, text);
  }
  return text;
}

export function reviewKeyOf(row: TransactionDto): string | null {
  return row.status === "review" && row.reviewReason
    ? reviewKey(row.reviewReason)
    : null;
}

export function filterTransactions(
  rows: TransactionDto[],
  filter: TransactionFilter,
  today: string,
): TransactionDto[] {
  const query = filter.search.trim().toLowerCase();
  const bounds = dateBounds(filter, today);
  const sinceExport = filter.range === "since-export";
  const daySet = new Set(filter.days);
  const ids = new Set(filter.ids);
  return rows.filter((row) => {
    const amount = Math.abs(row.amountCents);
    const reason = filter.reasons.length > 0 ? reviewKeyOf(row) : null;
    return (
      (filter.statuses.length === 0 || filter.statuses.includes(row.status)) &&
      (filter.sources.length === 0 || filter.sources.includes(row.source)) &&
      (filter.kinds.length === 0 ||
        filter.kinds.includes(kindGroup(row.kind))) &&
      (filter.reasons.length === 0 ||
        (reason !== null && filter.reasons.includes(reason))) &&
      (filter.methods.length === 0 ||
        (row.method !== null && filter.methods.includes(row.method))) &&
      (filter.direction === null ||
        (filter.direction === "in"
          ? row.amountCents > 0
          : row.amountCents < 0)) &&
      (filter.minCents === null || amount >= filter.minCents) &&
      (filter.maxCents === null || amount <= filter.maxCents) &&
      (!sinceExport || row.status !== "exported" || row.batchId !== null) &&
      (!bounds || (dayOf(row) >= bounds.from && dayOf(row) <= bounds.to)) &&
      (daySet.size === 0 || daySet.has(dayOf(row))) &&
      (filter.batchId === null || row.batchId === filter.batchId) &&
      (filter.customers.length === 0 ||
        (row.customerKey !== null &&
          filter.customers.includes(row.customerKey))) &&
      (filter.products.length === 0 ||
        (row.productLabel !== null &&
          filter.products.includes(row.productLabel))) &&
      (ids.size === 0 || ids.has(row.id)) &&
      (!filter.revenueOnly || row.countsAsRevenue) &&
      (!query || searchText(row).includes(query))
    );
  });
}

export function customerLabel(
  rows: TransactionDto[],
  key: string,
): string | null {
  return rows.find((row) => row.customerKey === key)?.customerName ?? null;
}
