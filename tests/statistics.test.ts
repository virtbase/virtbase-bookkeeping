import { describe, expect, test } from "bun:test";
import { openDatabase } from "../src/server/db/client.ts";
import { transactions } from "../src/server/db/schema.ts";
import { listStatRows, listTransactions } from "../src/server/queries.ts";
import { historyStart } from "../src/server/stripe/sync.ts";
import { DEFAULT_FILE_NAME_TEMPLATE } from "../src/shared/file-name.ts";
import { bucketEnd } from "../src/shared/periods.ts";
import { DEFAULT_PURPOSE_TEMPLATES } from "../src/shared/purpose.ts";
import type { StatOptions, StatRow } from "../src/shared/statistics.ts";
import {
  bucketKey,
  bucketLabel,
  buildStatistics,
  customerOptions,
  MORE,
  OTHER,
  productLabel,
  productOptions,
  renderStatisticsCsv,
  shiftDay,
  suggestedGranularity,
} from "../src/shared/statistics.ts";
import type { SettingsDto } from "../src/shared/types.ts";

const labels = { stripe: "Stripe", monero: "Monero", fees: "Gebühren" };

function row(values: Partial<StatRow>): StatRow {
  return {
    day: "2026-10-15",
    feeDay: values.day ?? "2026-10-15",
    source: "stripe",
    account: "Stripe",
    revenueCents: 1000,
    stripeFeeCents: 50,
    passthroughFeeCents: 20,
    product: "EPYC-01",
    payment: true,
    customer: null,
    customerName: null,
    ...values,
  };
}

const options: StatOptions = {
  from: "2026-01-01",
  to: "2026-12-31",
  granularity: "month",
  groupBy: "source",
  sources: [],
  customers: [],
  products: [],
  today: "2026-11-06",
};

describe("buckets", () => {
  test("weeks start on Monday", () => {
    expect(bucketKey("2026-11-06", "week")).toBe("2026-11-02");
    expect(bucketKey("2026-11-02", "week")).toBe("2026-11-02");
    expect(bucketKey("2026-11-01", "week")).toBe("2026-10-26");
  });

  test("labels read German", () => {
    expect(bucketLabel("2026-03-01", "month")).toBe("Mär 26");
    expect(bucketLabel("2026-11-02", "week")).toBe("02.11.");
  });

  test("suggests a resolution that fits the range", () => {
    expect(suggestedGranularity("2026-10-01", "2026-11-01")).toBe("day");
    expect(suggestedGranularity("2026-07-01", "2026-11-01")).toBe("week");
    expect(suggestedGranularity("2025-01-01", "2026-11-01")).toBe("month");
  });
});

describe("product names", () => {
  test("groups renewals, refunds and upgrades", () => {
    expect(productLabel("EPYC-02")).toBe("EPYC-02");
    expect(productLabel("Verlängerung EPYC-04")).toBe("EPYC-04");
    expect(productLabel("EPYC-03 renewal")).toBe("EPYC-03");
    expect(productLabel("REFUND FOR PAYMENT (EPYC-02)")).toBe("EPYC-02");
    expect(productLabel("Upgrade EPYC-BETA-2 => EPYC-02")).toBe("Upgrade");
    expect(productLabel("RYZEN-9")).toBe("RYZEN-9");
    expect(productLabel("Geldtransit")).toBeNull();
  });
});

describe("buildStatistics", () => {
  const rows = [
    row({ day: "2026-10-05" }),
    row({ day: "2026-10-20", revenueCents: 2000 }),
    row({
      day: "2026-10-21",
      source: "monero",
      account: "Monero",
      revenueCents: 799,
      stripeFeeCents: 0,
      passthroughFeeCents: 0,
      product: "EPYC-02",
    }),
    row({ day: "2026-09-10", revenueCents: 500 }),
  ];

  test("sums revenue and fees per group and month", () => {
    const result = buildStatistics(rows, options, labels);
    const october = result.buckets.find((b) => b.key === "2026-10-01");
    expect(october).toMatchObject({
      groups: { Stripe: 3000, Monero: 799 },
      totalCents: 3799,
      stripeFeeCents: 100,
      passthroughFeeCents: 40,
      netCents: 3659,
    });
    expect(result.totals).toEqual({
      revenueCents: 4299,
      feeCents: 210,
      netCents: 4089,
      payments: 4,
      paymentCents: 4299,
    });
  });

  test("books fees on the UTC day like the Stripe invoice", () => {
    const result = buildStatistics(
      [row({ day: "2026-11-01", feeDay: "2026-10-31", revenueCents: 1000 })],
      options,
      labels,
    );
    const october = result.buckets.find((b) => b.key === "2026-10-01");
    const november = result.buckets.find((b) => b.key === "2026-11-01");
    expect(october).toMatchObject({
      totalCents: 0,
      stripeFeeCents: 50,
      netCents: -70,
    });
    expect(november).toMatchObject({
      totalCents: 1000,
      stripeFeeCents: 0,
      netCents: 1000,
    });
    expect(result.totals.netCents).toBe(930);
  });

  test("groups by account and merges shared accounts", () => {
    const merged = rows.map((entry) => ({ ...entry, account: "Bank" }));
    const result = buildStatistics(
      merged,
      { ...options, groupBy: "account" },
      labels,
    );
    expect(result.groups).toEqual([{ name: "Bank", totalCents: 4299 }]);
  });

  test("keeps the color order when a filter removes a group", () => {
    const result = buildStatistics(
      rows,
      { ...options, sources: ["monero"] },
      labels,
    );
    expect(result.allGroups).toEqual(["Stripe", "Monero"]);
    expect(result.groups.map((group) => group.name)).toEqual(["Monero"]);
  });

  test("compares with the period right before", () => {
    const result = buildStatistics(
      [...rows, row({ day: "2026-08-20", revenueCents: 100 })],
      { ...options, from: "2026-10-01", to: "2026-10-31" },
      labels,
    );
    expect(result.totals.revenueCents).toBe(3799);
    expect(result.previous?.revenueCents).toBe(500);
  });

  test("skips the comparison when the history starts inside it", () => {
    const result = buildStatistics(
      rows,
      { ...options, from: "2026-10-01", to: "2026-10-31" },
      labels,
    );
    expect(result.previous).toBeNull();
  });

  test("splits new and returning customers", () => {
    const customers = [
      row({ day: "2026-09-10", customer: "anna", revenueCents: 500 }),
      row({ day: "2026-10-15", customer: "anna", revenueCents: 1000 }),
      row({ day: "2026-10-15", customer: "bob", revenueCents: 2000 }),
      row({ day: "2026-10-20", customer: "anna", revenueCents: -300 }),
      row({ day: "2026-10-21", revenueCents: 100 }),
    ];
    const result = buildStatistics(
      customers,
      { ...options, from: "2026-10-01", to: "2026-10-31", groupBy: "customer" },
      labels,
    );
    expect(result.groups).toEqual([
      { name: "Neu", totalCents: 2000 },
      { name: "Wiederkehrend", totalCents: 1000 },
      { name: "Rückerstattungen", totalCents: -300 },
      { name: "Ohne Namen", totalCents: 100 },
    ]);
    expect(result.customers).toEqual({ new: 1, returning: 1 });
  });

  test("ranks products and keeps Sonstige apart from the rest", () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      row({ product: `EPYC-0${index}`, revenueCents: 100 * (index + 1) }),
    );
    const result = buildStatistics(
      [...many, row({ product: OTHER, revenueCents: 50 })],
      options,
      labels,
    );
    expect(result.products).toHaveLength(8);
    expect(result.products[0]).toEqual({ name: "EPYC-07", totalCents: 800 });
    expect(result.products.slice(-2)).toEqual([
      { name: OTHER, totalCents: 50 },
      { name: MORE, totalCents: 300 },
    ]);
  });
});

function everyDay(from: string, until: string, cents = 100): StatRow[] {
  const rows: StatRow[] = [];
  for (let day = from; day < until; day = shiftDay(day, 1)) {
    rows.push(row({ day, revenueCents: cents }));
  }
  return rows;
}

describe("customer and product filters", () => {
  const rows = [
    row({
      day: "2026-10-05",
      customer: "id:a",
      customerName: "Anna B.",
      product: "A-1",
    }),
    row({
      day: "2026-10-06",
      customer: "id:a",
      customerName: "Anna B.",
      revenueCents: 300,
    }),
    row({
      day: "2026-10-07",
      customer: "id:b",
      customerName: "Ben",
      product: OTHER,
    }),
    row({
      day: "2026-10-08",
      customer: null,
      product: "A-1",
      revenueCents: 50,
    }),
  ];

  test("keeps only the chosen customers", () => {
    const result = buildStatistics(
      rows,
      { ...options, customers: ["id:a"] },
      labels,
    );
    expect(result.totals.revenueCents).toBe(1300);
  });

  test("keeps only the chosen products", () => {
    const product = (products: string[]) =>
      buildStatistics(rows, { ...options, products }, labels).totals
        .revenueCents;
    expect(product(["A-1"])).toBe(1050);
    expect(product([OTHER])).toBe(1000);
  });

  test("lists customers by name", () => {
    expect(customerOptions(rows)).toEqual([
      { value: "id:a", label: "Anna B.", count: 2 },
      { value: "id:b", label: "Ben", count: 1 },
    ]);
  });

  test("lists products with Sonstige last", () => {
    expect(productOptions(rows).map((option) => option.value)).toEqual([
      "A-1",
      "EPYC-01",
      OTHER,
    ]);
  });

  test("ends a bucket on the day before the next one", () => {
    expect(bucketEnd("2026-02-01", "month")).toBe("2026-02-28");
    expect(bucketEnd("2026-11-02", "week")).toBe("2026-11-08");
    expect(bucketEnd("2026-11-02", "day")).toBe("2026-11-02");
  });
});

describe("forecast in the statistics", () => {
  const steady = everyDay("2026-07-01", "2026-11-06");

  test("projects a steady business at its daily rate", () => {
    const result = buildStatistics(steady, options, labels);
    expect(result.forecast).toEqual({
      basis: 4,
      horizon: 3,
      totalCents: 9000,
      lowCents: null,
      highCents: null,
      untilLabel: "Feb 27",
    });
    const forecasts = result.buckets
      .filter((bucket) => bucket.forecastCents !== null)
      .map((bucket) => [bucket.key, bucket.forecastCents]);
    expect(forecasts).toEqual([
      ["2026-11-01", 3000],
      ["2026-12-01", 3100],
      ["2027-01-01", 3100],
      ["2027-02-01", 2800],
    ]);
  });

  test("counts what the running month already earned", () => {
    const withCurrent = [
      ...steady,
      row({ day: "2026-11-03", revenueCents: 99999 }),
    ];
    const result = buildStatistics(withCurrent, options, labels);
    const november = result.buckets.find((b) => b.key === "2026-11-01");
    expect(november?.forecastCents).toBeGreaterThanOrEqual(100499);
  });

  test("adds buckets beyond the chosen end", () => {
    const result = buildStatistics(
      steady,
      { ...options, to: "2026-11-06" },
      labels,
    );
    expect(result.buckets.at(-1)).toMatchObject({
      key: "2027-02-01",
      projected: true,
    });
  });

  test("starts the line at the running month", () => {
    const result = buildStatistics(steady, options, labels);
    const october = result.buckets.find((b) => b.key === "2026-10-01");
    const november = result.buckets.find((b) => b.key === "2026-11-01");
    expect(october?.forecastCents).toBeNull();
    expect(november).toMatchObject({ partial: true, projected: false });
  });

  test("counts quiet months as zero", () => {
    const gap = [row({ day: "2026-07-10" }), row({ day: "2026-10-10" })];
    expect(buildStatistics(gap, options, labels).forecast?.basis).toBe(4);
  });

  test("ignores rows without revenue when it looks for the start", () => {
    const early = row({ day: "2025-01-10", revenueCents: 0 });
    expect(
      buildStatistics([early, ...steady], options, labels).forecast?.basis,
    ).toBe(4);
  });

  test("needs enough history", () => {
    const short = everyDay("2026-09-01", "2026-11-06");
    expect(buildStatistics(short, options, labels).forecast).toBeNull();
  });

  test("hides the forecast for ranges in the past", () => {
    const result = buildStatistics(
      steady,
      { ...options, to: "2026-10-31" },
      labels,
    );
    expect(result.forecast).toBeNull();
    expect(result.buckets.every((b) => b.forecastCents === null)).toBe(true);
  });

  test("gives each forecast bar its own range", () => {
    const rows = everyDay("2026-03-02", "2026-11-06").map((entry, index) => ({
      ...entry,
      revenueCents: 100 + ((index * 37) % 90),
    }));
    const result = buildStatistics(
      rows,
      { ...options, granularity: "week", from: "2026-09-01" },
      labels,
    );
    const forecasted = result.buckets.filter((b) => b.forecastCents !== null);
    expect(forecasted.length).toBeGreaterThan(1);
    for (const bucket of forecasted) {
      expect(bucket.lowCents ?? 0).toBeGreaterThan(0);
      expect(bucket.lowCents ?? 0).toBeLessThanOrEqual(bucket.highCents ?? 0);
    }
    const steadyResult = buildStatistics(steady, options, labels);
    expect(steadyResult.buckets.every((b) => b.lowCents === null)).toBe(true);
  });

  test("shows a range once enough periods can be checked", () => {
    const rows = everyDay("2026-03-02", "2026-11-06").map((entry, index) => ({
      ...entry,
      revenueCents: 100 + ((index * 37) % 90),
    }));
    const forecast = buildStatistics(
      rows,
      { ...options, granularity: "week", from: "2026-09-01" },
      labels,
    ).forecast;
    expect(forecast?.lowCents).toBeGreaterThan(0);
    expect(forecast?.lowCents ?? 0).toBeLessThanOrEqual(
      forecast?.highCents ?? 0,
    );
  });
});

describe("CSV export", () => {
  test("writes German amounts and marks the forecast", () => {
    const rows = everyDay("2026-08-01", "2026-11-06");
    const csv = renderStatisticsCsv(
      buildStatistics(
        rows,
        { ...options, from: "2026-10-01", to: "2026-12-31" },
        labels,
      ),
      "month",
    );
    expect(csv.split("\r\n").filter(Boolean)).toEqual([
      "Zeitraum;Stripe;Umsatz;Stripe-Gebühren;PayPal-Gebühren;Netto;Prognose;Art",
      "2026-10;31,00;31,00;15,50;6,20;9,30;;Abgeschlossen",
      "2026-11;5,00;5,00;2,50;1,00;1,50;30,00;Laufend",
      "2026-12;0,00;0,00;0,00;0,00;0,00;31,00;Prognose",
      "2027-01;0,00;0,00;0,00;0,00;0,00;31,00;Prognose",
      "2027-02;0,00;0,00;0,00;0,00;0,00;28,00;Prognose",
    ]);
  });
});

const base: SettingsDto = {
  exportDir: "/tmp",
  backupDir: "",
  dateFormat: "iso",
  decimalFormat: "dot",
  baselineDate: "",
  feesClosedThrough: "",
  rateSource: "auto",
  stripeName: "Stripe",
  paypalName: "PayPal",
  moneroNodes: ["https://node.example.org:18089"],
  accounts: { stripe: "Stripe", fees: "Stripe", monero: "Monero" },
  purposeTemplates: DEFAULT_PURPOSE_TEMPLATES,
  fileNameTemplate: DEFAULT_FILE_NAME_TEMPLATE,
};
const entry = {
  source: "stripe" as const,
  kind: "charge",
  occurredAt: Date.parse("2026-10-31T23:30:00Z") / 1000,
  valueAt: 1,
  name: "Anna",
  purpose: "EPYC-01",
  description: "EPYC-01",
  amountCents: 399,
  stripeFeeCents: 30,
  passthroughFeeCents: 10,
  createdAt: 1,
};

describe("rows from the ledger", () => {
  function setup() {
    const db = openDatabase(":memory:");
    db.insert(transactions)
      .values([
        { ...entry, id: "charge" },
        { ...entry, id: "payout", kind: "payout", amountCents: -5000 },
        { ...entry, id: "refund", kind: "refund", amountCents: -399 },
        { ...entry, id: "hidden", ignored: true },
        { ...entry, id: "fee", source: "fees", amountCents: -40 },
        {
          ...entry,
          id: "xmr-open",
          source: "monero",
          kind: "incoming",
          needsReview: true,
        },
        {
          ...entry,
          id: "xmr-done",
          source: "monero",
          kind: "incoming",
          stripeFeeCents: 0,
          passthroughFeeCents: 0,
        },
        {
          ...entry,
          id: "xmr-hidden",
          source: "monero",
          kind: "incoming",
          ignored: true,
        },
      ])
      .run();
    return db;
  }

  test("counts payments and refunds, never payouts", () => {
    const rows = listStatRows(setup(), base);
    const stripe = rows.filter((row) => row.source === "stripe");
    expect(stripe.reduce((sum, row) => sum + row.revenueCents, 0)).toBe(0);
    expect(stripe.filter((row) => row.payment)).toHaveLength(1);
  });

  test("keeps the real fees of a hidden Stripe row", () => {
    const rows = listStatRows(setup(), base);
    const fees = rows.reduce((sum, row) => sum + row.stripeFeeCents, 0);
    expect(fees).toBe(120);
  });

  test("leaves out unconfirmed and hidden Monero rows", () => {
    const monero = listStatRows(setup(), base).filter(
      (row) => row.source === "monero",
    );
    expect(monero).toHaveLength(1);
    expect(monero[0]?.revenueCents).toBe(399);
  });

  test("counts old Monero rows behind the baseline", () => {
    const rows = listStatRows(setup(), {
      ...base,
      baselineDate: "2026-11-05T23:59",
    }).filter((row) => row.source === "monero");
    expect(rows).toHaveLength(2);
  });

  test("keys customers by Stripe ID and falls back to the name", () => {
    const db = openDatabase(":memory:");
    const monero = {
      source: "monero" as const,
      kind: "incoming",
      stripeFeeCents: 0,
      passthroughFeeCents: 0,
    };
    db.insert(transactions)
      .values([
        { ...entry, id: "a1", name: "Anna Beispiel", customerId: "cus_anna" },
        { ...entry, id: "a2", name: " anna  beispiel " },
        { ...entry, id: "m1", name: "Max Muster", customerId: "cus_max1" },
        { ...entry, id: "m2", name: "Max Muster", customerId: "cus_max2" },
        { ...entry, id: "m3", name: "Max Muster" },
        { ...entry, ...monero, id: "x1", name: "Lena Demo" },
      ])
      .run();
    expect(listStatRows(db, base).map((row) => row.customer)).toEqual([
      "id:cus_anna",
      "id:cus_anna",
      "id:cus_max1",
      "id:cus_max2",
      "name:max muster",
      "name:lena demo",
    ]);
  });

  test("gives transactions the same customer and product as the statistics", () => {
    const db = openDatabase(":memory:");
    db.insert(transactions)
      .values([
        {
          ...entry,
          id: "a1",
          name: "Anna Beispiel",
          customerId: "cus_anna",
          occurredAt: entry.occurredAt + 60,
        },
        { ...entry, id: "a2", name: " anna  beispiel ", description: null },
        {
          ...entry,
          id: "a3",
          name: "Anna Beispiel",
          purpose: "Spende",
          description: "Spende",
        },
        {
          ...entry,
          id: "p1",
          kind: "payout",
          name: "Stripe",
          purpose: "Auszahlung",
          description: "Auszahlung",
        },
        {
          ...entry,
          id: "f1",
          source: "fees",
          kind: "stripe_fee",
          name: "Stripe",
          method: "2 Stripe-Transaktionen",
        },
      ])
      .run();
    const now = Date.parse("2026-11-06T12:00:00Z") / 1000;
    const rows = listTransactions(db, base, now);
    expect(
      rows.map((row) => [
        row.id,
        row.customerKey,
        row.customerName,
        row.productLabel,
        row.countsAsRevenue,
      ]),
    ).toEqual([
      ["a1", "id:cus_anna", "Anna Beispiel", "EPYC-01", true],
      ["p1", "name:stripe", "Stripe", null, false],
      ["f1", null, null, null, false],
      ["a3", "id:cus_anna", "Anna Beispiel", OTHER, true],
      ["a2", "id:cus_anna", "Anna Beispiel", "EPYC-01", true],
    ]);
    expect(rows.find((row) => row.id === "f1")).toMatchObject({
      method: null,
      feeBasis: "2 Stripe-Transaktionen",
    });
    expect(
      listStatRows(db, base)
        .filter((row) => row.customer)
        .map((row) => [row.customer, row.customerName, row.product]),
    ).toEqual([
      ["id:cus_anna", "Anna Beispiel", "EPYC-01"],
      ["id:cus_anna", "Anna Beispiel", "EPYC-01"],
      ["id:cus_anna", "Anna Beispiel", OTHER],
    ]);
  });

  test("uses the German day for revenue and the UTC day for fees", () => {
    expect(listStatRows(setup(), base)[0]).toMatchObject({
      day: "2026-11-01",
      feeDay: "2026-10-31",
    });
  });
});

describe("history window", () => {
  test("keeps older Stripe rows out of the transaction list", () => {
    const db = openDatabase(":memory:");
    const old = Date.parse("2025-03-10T12:00:00Z") / 1000;
    db.insert(transactions)
      .values([
        { ...entry, id: "old", occurredAt: old },
        { ...entry, id: "recent" },
      ])
      .run();
    const now = Date.parse("2026-11-06T12:00:00Z") / 1000;
    expect(listTransactions(db, base, now).map((row) => row.id)).toEqual([
      "recent",
    ]);
    expect(listStatRows(db, base)).toHaveLength(2);
  });

  test("reaches back 24 months", () => {
    const now = Date.parse("2026-11-06T12:00:00Z") / 1000;
    expect(new Date(historyStart(now) * 1000).toISOString()).toBe(
      "2024-11-01T00:00:00.000Z",
    );
  });
});
