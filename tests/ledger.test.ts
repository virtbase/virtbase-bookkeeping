import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { openDatabase } from "../src/server/db/client.ts";
import { transactions } from "../src/server/db/schema.ts";
import {
  createExport as createExports,
  ExportError,
  markImported,
  voidExport,
} from "../src/server/export/service.ts";
import { sumMonthFees } from "../src/server/fees.ts";
import { listExports, listTransactions } from "../src/server/queries.ts";
import type { BalanceReader } from "../src/server/stripe/client.ts";
import type { BalanceTransaction } from "../src/server/stripe/mapping.ts";
import { refreshFeeRows, syncStripe } from "../src/server/stripe/sync.ts";
import { DEFAULT_PURPOSE_TEMPLATES } from "../src/shared/purpose.ts";
import type { SettingsDto } from "../src/shared/types.ts";

const now = Date.parse("2026-11-05T12:00:00Z") / 1000;

function createExport(...args: Parameters<typeof createExports>) {
  const [batch] = createExports(...args);
  if (!batch) {
    throw new Error("Kein Export erstellt.");
  }
  return batch;
}

function settings(overrides: Partial<SettingsDto> = {}): SettingsDto {
  return {
    exportDir: mkdtempSync(join(tmpdir(), "bookkeeping-")),
    backupDir: "",
    dateFormat: "iso",
    decimalFormat: "dot",
    baselineDate: "",
    feesClosedThrough: "2026-09",
    rateSource: "auto",
    stripeName: "Stripe Technology Europe, Limited",
    paypalName: "PayPal (Europe) S.à r.l. et Cie, S.C.A.",
    moneroNodes: ["https://node.example.org:18089"],
    accounts: { stripe: "Stripe", fees: "Stripe", monero: "Monero" },
    purposeTemplates: DEFAULT_PURPOSE_TEMPLATES,
    ...overrides,
  };
}

function charge(id: string, iso: string, amount: number): BalanceTransaction {
  return {
    id,
    type: "charge",
    amount,
    fee: 50,
    net: amount - 50,
    created: Date.parse(iso) / 1000,
    available_on: Date.parse(iso) / 1000,
    description: "EPYC-01",
    fee_details: [
      { amount: 20, type: "stripe_fee" },
      { amount: 30, type: "payment_method_passthrough_fee" },
    ],
    source: {
      object: "charge",
      id: `ch_${id}`,
      billing_details: { name: "Anna Beispiel" },
    },
  } as BalanceTransaction;
}

function reader(rows: BalanceTransaction[]): BalanceReader {
  return {
    listBalanceTransactions: async () => rows,
    retrieveBalanceCents: async () => 9355,
  };
}

const october = [
  charge("txn_a", "2026-10-02T10:00:00Z", 399),
  charge("txn_b", "2026-10-31T23:30:00Z", 799),
  charge("txn_c", "2026-11-01T00:30:00Z", 799),
];

async function seeded(config: SettingsDto) {
  const db = openDatabase(":memory:");
  await syncStripe(db, reader(october), config, now);
  return db;
}

describe("sync and fee rows", () => {
  test("creates fee rows for finished UTC months only", async () => {
    const config = settings();
    const db = await seeded(config);
    const rows = listTransactions(db, config);
    const fees = rows.filter((row) => row.source === "fees");
    expect(fees.map((row) => [row.purpose, row.amountCents])).toEqual([
      ["Stripe Processing Fees 10/26", -40],
      ["Stripe PayPal Passthrough-Fees 10/26", -60],
    ]);
    expect(sumMonthFees(db, "2026-11").stripeCents).toBe(20);
  });

  test("counts a charge in its UTC month, not its German month", async () => {
    const db = await seeded(settings());
    expect(sumMonthFees(db, "2026-10").count).toBe(2);
  });

  test("a second sync adds nothing", async () => {
    const config = settings();
    const db = await seeded(config);
    const result = await syncStripe(db, reader(october), config, now + 60);
    expect(result).toEqual({ added: 0, feeRows: 0 });
  });

  test("the baseline marks old rows as exported but keeps fee rows open", async () => {
    const config = settings({ baselineDate: "2026-11-01T23:59" });
    const db = await seeded(config);
    const rows = listTransactions(db, config);
    expect(
      rows.filter((row) => row.status === "ready").map((row) => row.source),
    ).toEqual(["fees", "fees"]);
  });
});

describe("closing fee months", () => {
  async function voidedFeeExport(config: SettingsDto) {
    const db = await seeded(config);
    const batch = createExport(
      db,
      ["fee:2026-10:stripe", "fee:2026-10:paypal"],
      config,
      now,
    );
    voidExport(db, batch.id);
    return db;
  }

  test("closing a month survives fee rows from a voided export", async () => {
    const config = settings();
    const db = await voidedFeeExport(config);
    const closed = { ...config, feesClosedThrough: "2026-10" };
    expect(() => refreshFeeRows(db, closed, now)).not.toThrow();
    expect(
      listTransactions(db, closed).filter((row) => row.source === "fees"),
    ).toEqual([]);
    expect(listExports(db, closed).batches[0]?.status).toBe("void");
  });

  test("reopening the month brings the same rows back", async () => {
    const config = settings();
    const db = await voidedFeeExport(config);
    refreshFeeRows(db, { ...config, feesClosedThrough: "2026-10" }, now);
    refreshFeeRows(db, config, now);
    const fees = listTransactions(db, config).filter(
      (row) => row.source === "fees",
    );
    expect(fees.map((row) => row.status)).toEqual(["ready", "ready"]);
  });

  test("a closed fee row cannot be exported", async () => {
    const config = settings();
    const db = await voidedFeeExport(config);
    const closed = { ...config, feesClosedThrough: "2026-10" };
    refreshFeeRows(db, closed, now);
    expect(() => createExport(db, ["fee:2026-10:stripe"], closed, now)).toThrow(
      ExportError,
    );
  });

  test("exported fee rows stay when their month is closed", async () => {
    const config = settings();
    const db = await seeded(config);
    createExport(db, ["fee:2026-10:stripe"], config, now);
    const closed = { ...config, feesClosedThrough: "2026-10" };
    refreshFeeRows(db, closed, now);
    const fees = listTransactions(db, closed).filter(
      (row) => row.source === "fees",
    );
    expect(fees.map((row) => [row.id, row.status])).toEqual([
      ["fee:2026-10:stripe", "exported"],
    ]);
  });
});

describe("names and purpose templates", () => {
  const custom = (config: SettingsDto) => ({
    ...config,
    stripeName: "Stripe Payments Europe, Limited",
    purposeTemplates: {
      ...config.purposeTemplates,
      payment: "{beschreibung} vom {datum}",
      feeStripe: "Gebühren {monat}",
    },
  });

  test("changes apply to open rows at once", async () => {
    const config = settings();
    const db = await seeded(config);
    const rows = listTransactions(db, custom(config));
    const fee = rows.find((row) => row.id === "fee:2026-10:stripe");
    expect(fee).toMatchObject({
      name: "Stripe Payments Europe, Limited",
      purpose: "Gebühren 10/26",
    });
    expect(rows.find((row) => row.id === "txn_a")?.purpose).toBe(
      "EPYC-01 vom 02.10.2026",
    );
  });

  test("the file uses the current names and templates", async () => {
    const config = custom(settings());
    const db = await seeded(config);
    const batch = createExport(db, ["fee:2026-10:stripe"], config, now);
    const line = readFileSync(batch.filePath, "utf8").split("\r\n")[1];
    expect(line).toContain(";Stripe Payments Europe, Limited;Gebühren 10/26;");
  });

  test("exported rows keep what the file contains", async () => {
    const config = settings();
    const db = await seeded(config);
    createExport(db, ["fee:2026-10:stripe"], config, now);
    const row = listTransactions(db, custom(config)).find(
      (entry) => entry.id === "fee:2026-10:stripe",
    );
    expect(row).toMatchObject({
      name: "Stripe Technology Europe, Limited",
      purpose: "Stripe Processing Fees 10/26",
    });
  });

  test("a voided row follows the current settings again", async () => {
    const config = settings();
    const db = await seeded(config);
    const batch = createExport(db, ["fee:2026-10:stripe"], config, now);
    voidExport(db, batch.id);
    const row = listTransactions(db, custom(config)).find(
      (entry) => entry.id === "fee:2026-10:stripe",
    );
    expect(row).toMatchObject({
      name: "Stripe Payments Europe, Limited",
      purpose: "Gebühren 10/26",
    });
  });
});

describe("exports", () => {
  test("writes the file and records the batch", async () => {
    const config = settings();
    const db = await seeded(config);
    const batch = createExport(db, ["txn_a", "txn_b"], config, now);
    expect(batch).toMatchObject({
      rowCount: 2,
      netCents: 1198,
      status: "pending",
    });
    const lines = readFileSync(batch.filePath, "utf8").split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain(
      "2026-10-02 12:00:00;Anna Beispiel;EPYC-01;3.99;;3.99",
    );
  });

  test("refuses a second export of the same row", async () => {
    const config = settings();
    const db = await seeded(config);
    const batch = createExport(db, ["txn_a"], config, now);
    expect(() => createExport(db, ["txn_a", "txn_b"], config, now)).toThrow(
      `bereits in Export #${batch.id}`,
    );
  });

  test("the database itself blocks double rows", async () => {
    const config = settings();
    const db = await seeded(config);
    const first = createExport(db, ["txn_a"], config, now);
    const insert = () =>
      db.run(
        sql`INSERT INTO export_rows (batch_id, transaction_id) VALUES (${first.id}, 'txn_a')`,
      );
    expect(insert).toThrow();
  });

  test("voiding frees the rows and keeps the record", async () => {
    const config = settings();
    const db = await seeded(config);
    const batch = createExport(db, ["txn_a"], config, now);
    voidExport(db, batch.id);
    const row = listTransactions(db, config).find(
      (entry) => entry.id === "txn_a",
    );
    expect(row?.status).toBe("ready");
    expect(listExports(db, config).batches[0]?.status).toBe("void");
    expect(createExport(db, ["txn_a"], config, now).id).toBeGreaterThan(
      batch.id,
    );
  });

  test("refuses rows that still need review", async () => {
    const config = settings();
    const db = await seeded(config);
    db.update(transactions).set({ needsReview: true }).run();
    expect(() => createExport(db, ["txn_a"], config, now)).toThrow(ExportError);
  });

  test("reports rows skipped between exports", async () => {
    const config = settings();
    const db = await seeded(config);
    createExport(db, ["txn_a", "txn_c"], config, now);
    const report = listExports(db, config);
    expect(report.missingCount).toBe(1);
    expect(report.missingDays).toEqual(["2026-11-01"]);
  });

  test("marks an export as imported", async () => {
    const config = settings();
    const db = await seeded(config);
    const batch = createExport(db, ["txn_a"], config, now);
    markImported(db, batch.id);
    expect(listExports(db, config).batches[0]?.status).toBe("imported");
  });
});

describe("exports per account", () => {
  async function withMonero(config: SettingsDto) {
    const db = await seeded(config);
    db.insert(transactions)
      .values({
        id: "xmr:1",
        source: "monero",
        kind: "incoming",
        occurredAt: Date.parse("2026-11-02T12:00:00Z") / 1000,
        valueAt: Date.parse("2026-11-02T12:00:00Z") / 1000,
        name: "Lena Demo",
        purpose: "x",
        amountCents: 799,
        product: "EPYC-02",
        xmrAtomic: "15148050000",
        xmrRate: 530.76,
        createdAt: now,
      })
      .run();
    return db;
  }
  const mixed = ["txn_a", "fee:2026-10:stripe", "xmr:1"];
  const names = (dir: string) => readdirSync(dir).sort();
  const lines = (path: string) =>
    readFileSync(path, "utf8").trim().split("\r\n").slice(1);

  test("writes one file per account by default", async () => {
    const config = settings();
    const db = await withMonero(config);
    const batches = createExports(db, mixed, config, now);
    expect(batches.map((batch) => [batch.account, batch.rowCount])).toEqual([
      ["Monero", 1],
      ["Stripe", 2],
    ]);
    expect(names(config.exportDir)).toEqual([
      "virtbase_monero_2026-11-02_2026-11-02_0001.csv",
      "virtbase_stripe_2026-10-02_2026-10-31_0002.csv",
    ]);
    const [monero, stripe] = batches;
    expect(lines(monero?.filePath ?? "")[0]).toContain("Lena Demo");
    expect(lines(stripe?.filePath ?? "").join()).not.toContain("Lena Demo");
    expect(lines(stripe?.filePath ?? "")).toHaveLength(2);
  });

  test("moves a category through its account name", async () => {
    const config = settings({
      accounts: { stripe: "Stripe", fees: "Gebühren", monero: "Monero" },
    });
    const db = await withMonero(config);
    const batches = createExports(db, mixed, config, now);
    expect(batches.map((batch) => batch.account)).toEqual([
      "Gebühren",
      "Monero",
      "Stripe",
    ]);
    expect(batches[0]?.fileName).toContain("virtbase_gebuehren_");
  });

  test("merges everything with the same name, ignoring case", async () => {
    const config = settings({
      accounts: { stripe: "Bank", fees: "bank", monero: " BANK " },
    });
    const db = await withMonero(config);
    const batches = createExports(db, mixed, config, now);
    expect(batches.map((batch) => batch.rowCount)).toEqual([3]);
    expect(names(config.exportDir)).toHaveLength(1);
  });

  test("a single category creates a single file", async () => {
    const config = settings();
    const db = await withMonero(config);
    expect(createExports(db, ["txn_a"], config, now)).toHaveLength(1);
  });

  test("leaves nothing behind when the second file fails", async () => {
    const config = settings({
      accounts: {
        stripe: "x".repeat(300),
        fees: "x".repeat(300),
        monero: "Monero",
      },
    });
    const db = await withMonero(config);
    expect(() => createExports(db, mixed, config, now)).toThrow();
    expect(names(config.exportDir)).toEqual([]);
    expect(listExports(db, config).batches).toEqual([]);
    const statuses = listTransactions(db, config)
      .filter((row) => mixed.includes(row.id))
      .map((row) => row.status);
    expect(statuses).toEqual(["ready", "ready", "ready"]);
    const retry = { ...config, accounts: settings().accounts };
    expect(createExports(db, mixed, retry, now)).toHaveLength(2);
  });

  test("each file can be voided on its own", async () => {
    const config = settings();
    const db = await withMonero(config);
    const [monero] = createExports(db, mixed, config, now);
    voidExport(db, monero?.id ?? 0);
    const rows = listTransactions(db, config);
    expect(rows.find((row) => row.id === "xmr:1")?.status).toBe("ready");
    expect(rows.find((row) => row.id === "txn_a")?.status).toBe("exported");
  });

  test("rows report their account", async () => {
    const config = settings();
    const db = await withMonero(config);
    const account = (id: string) =>
      listTransactions(db, config).find((row) => row.id === id)?.account;
    expect(account("txn_a")).toBe("Stripe");
    expect(account("fee:2026-10:stripe")).toBe("Stripe");
    expect(account("xmr:1")).toBe("Monero");
  });
});
