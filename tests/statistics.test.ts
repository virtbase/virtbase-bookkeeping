import { describe, expect, test } from "bun:test";
import { openDatabase } from "../src/server/db/client.ts";
import { transactions } from "../src/server/db/schema.ts";
import { listStatRows, listTransactions } from "../src/server/queries.ts";
import { historyStart } from "../src/server/stripe/sync.ts";
import { DEFAULT_PURPOSE_TEMPLATES } from "../src/shared/purpose.ts";
import {
  bucketKey,
  bucketLabel,
  buildStatistics,
  linearForecast,
  productLabel,
  renderStatisticsCsv,
  type StatOptions,
  type StatRow,
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
    ...values,
  };
}

const options: StatOptions = {
  from: "2026-01-01",
  to: "2026-12-31",
  granularity: "month",
  groupBy: "source",
  sources: [],
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

describe("linearForecast", () => {
  test("continues a straight trend", () => {
    expect(linearForecast([100, 200, 300], 2)).toEqual([400, 500]);
  });

  test("stays flat without a trend", () => {
    expect(linearForecast([500, 500, 500], 2)).toEqual([500, 500]);
  });

  test("never predicts negative revenue", () => {
    expect(linearForecast([300, 200, 100], 3)).toEqual([0, 0, 0]);
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
      rows,
      { ...options, from: "2026-10-01", to: "2026-10-31" },
      labels,
    );
    expect(result.totals.revenueCents).toBe(3799);
    expect(result.previous.revenueCents).toBe(500);
  });

  test("ranks products and folds the rest", () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      row({ product: `EPYC-0${index}`, revenueCents: 100 * (index + 1) }),
    );
    const result = buildStatistics(
      [...many, row({ product: null, revenueCents: 50 })],
      options,
      labels,
    );
    expect(result.products).toHaveLength(7);
    expect(result.products[0]).toEqual({ name: "EPYC-07", totalCents: 800 });
    expect(result.products.at(-1)).toEqual({
      name: "Sonstige",
      totalCents: 350,
    });
  });
});

describe("forecast in the statistics", () => {
  const months = ["2026-07", "2026-08", "2026-09", "2026-10"];
  const rows = months.map((month, index) =>
    row({ day: `${month}-10`, revenueCents: 1000 * (index + 1) }),
  );

  test("projects from finished months only", () => {
    const withCurrent = [
      ...rows,
      row({ day: "2026-11-03", revenueCents: 99999 }),
    ];
    const result = buildStatistics(withCurrent, options, labels);
    expect(result.forecast).toEqual({
      basis: 4,
      horizon: 3,
      totalCents: 21000,
      untilLabel: "Feb 27",
    });
    const december = result.buckets.find((b) => b.key === "2026-12-01");
    expect(december).toMatchObject({ forecastCents: 6000, projected: true });
  });

  test("adds buckets beyond the chosen end", () => {
    const result = buildStatistics(
      rows,
      { ...options, to: "2026-11-06" },
      labels,
    );
    expect(result.buckets.at(-1)).toMatchObject({
      key: "2027-02-01",
      projected: true,
    });
  });

  test("starts the line at the running month", () => {
    const result = buildStatistics(rows, options, labels);
    const october = result.buckets.find((b) => b.key === "2026-10-01");
    const november = result.buckets.find((b) => b.key === "2026-11-01");
    expect(october?.forecastCents).toBeNull();
    expect(november).toMatchObject({
      forecastCents: 5000,
      partial: true,
      projected: false,
    });
  });

  test("counts quiet months as zero", () => {
    const gap = [row({ day: "2026-07-10" }), row({ day: "2026-10-10" })];
    expect(buildStatistics(gap, options, labels).forecast?.basis).toBe(4);
  });

  test("ignores rows without revenue when it looks for the start", () => {
    const early = row({ day: "2025-01-10", revenueCents: 0 });
    expect(
      buildStatistics([early, ...rows], options, labels).forecast?.basis,
    ).toBe(4);
  });

  test("needs enough history", () => {
    expect(buildStatistics(rows.slice(2), options, labels).forecast).toBeNull();
  });

  test("hides the forecast for ranges in the past", () => {
    const result = buildStatistics(
      rows,
      { ...options, to: "2026-10-31" },
      labels,
    );
    expect(result.forecast).toBeNull();
    expect(result.buckets.every((b) => b.forecastCents === null)).toBe(true);
  });
});

describe("CSV export", () => {
  test("writes German amounts and marks the forecast", () => {
    const rows = ["2026-08", "2026-09", "2026-10"].map((month) =>
      row({ day: `${month}-10`, revenueCents: 1050 }),
    );
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
      "2026-10;10,50;10,50;0,50;0,20;9,80;;Abgeschlossen",
      "2026-11;0,00;0,00;0,00;0,00;0,00;10,50;Laufend",
      "2026-12;0,00;0,00;0,00;0,00;0,00;10,50;Prognose",
      "2027-01;0,00;0,00;0,00;0,00;0,00;10,50;Prognose",
      "2027-02;0,00;0,00;0,00;0,00;0,00;10,50;Prognose",
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
