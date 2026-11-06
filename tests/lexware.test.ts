import { describe, expect, test } from "bun:test";
import { openDatabase } from "../src/server/db/client.ts";
import { transactions } from "../src/server/db/schema.ts";
import type {
  InvoiceDetail,
  InvoiceReader,
  Voucher,
} from "../src/server/lexware/client.ts";
import { findInvoices, isCandidate } from "../src/server/lexware/matching.ts";

const occurredAt = Date.parse("2026-11-02T19:12:09Z") / 1000;

const vouchers: Voucher[] = [
  {
    id: "a",
    voucherNumber: "RE-1",
    voucherDate: "2026-11-02",
    totalAmount: 7.99,
  },
  {
    id: "b",
    voucherNumber: "RE-2",
    voucherDate: "2026-11-01",
    totalAmount: 8.1,
  },
  {
    id: "c",
    voucherNumber: "RE-3",
    voucherDate: "2026-11-02",
    totalAmount: 53.9,
  },
  {
    id: "d",
    voucherNumber: "RE-4",
    voucherDate: "2026-11-02",
    voucherStatus: "voided",
    totalAmount: 7.99,
  },
  {
    id: "e",
    voucherNumber: "RE-5",
    voucherDate: "2026-11-02T00:00:00.000+01:00",
    voucherStatus: "paid",
    contactName: "Max Muster",
    totalAmount: 7.99,
  },
];

function reader() {
  const calls = { list: [] as string[][], detail: [] as string[] };
  const client: InvoiceReader = {
    listInvoices: async (from, to) => {
      calls.list.push([from, to]);
      return vouchers;
    },
    retrieveInvoice: async (id): Promise<InvoiceDetail> => {
      calls.detail.push(id);
      return {
        id,
        voucherDate: "2026-11-02T00:00:00.000+01:00",
        address: { name: `Kunde ${id}` },
        lineItems: [{ name: "EPYC-02" }],
      };
    },
  };
  return { client, calls };
}

function seed() {
  const db = openDatabase(":memory:");
  db.insert(transactions)
    .values({
      id: "xmr:1",
      source: "monero",
      kind: "incoming",
      occurredAt,
      valueAt: occurredAt,
      purpose: "0.01514805 XMR",
      amountCents: 804,
      marketValueCents: 804,
      needsReview: true,
      createdAt: occurredAt,
    })
    .run();
  return db;
}

describe("findInvoices", () => {
  test("uses the real customer and puts the closest date first", async () => {
    const { client, calls } = reader();
    const matches = await findInvoices(seed(), client, "xmr:1", occurredAt);
    expect(calls.list).toEqual([["2026-10-30", "2026-11-03"]]);
    expect(matches.map((match) => match.customer)).toEqual([
      "Kunde a",
      "Kunde e",
      "Kunde b",
    ]);
    expect(matches[0]).toMatchObject({
      number: "RE-1",
      amountCents: 799,
      product: "EPYC-02",
      date: "2026-11-02",
    });
  });

  test("caches invoice details", async () => {
    const db = seed();
    const { client, calls } = reader();
    await findInvoices(db, client, "xmr:1", occurredAt);
    await findInvoices(db, client, "xmr:1", occurredAt);
    expect(calls.detail).toHaveLength(3);
  });

  test("skips invoices already linked to another payment", async () => {
    const db = seed();
    db.insert(transactions)
      .values({
        id: "xmr:2",
        source: "monero",
        kind: "incoming",
        occurredAt,
        valueAt: occurredAt,
        purpose: "x",
        amountCents: 799,
        invoiceId: "a",
        createdAt: occurredAt,
      })
      .run();
    const { client } = reader();
    const matches = await findInvoices(db, client, "xmr:1", occurredAt);
    expect(matches.map((match) => match.id)).toEqual(["e", "b"]);
  });
});

describe("findInvoices filters", () => {
  test("hides invoices already paid through Stripe", async () => {
    const db = seed();
    db.insert(transactions)
      .values({
        id: "txn_1",
        source: "stripe",
        kind: "charge",
        occurredAt,
        valueAt: occurredAt,
        name: "max muster",
        purpose: "EPYC-02",
        amountCents: 799,
        createdAt: occurredAt,
      })
      .run();
    const { client } = reader();
    const matches = await findInvoices(db, client, "xmr:1", occurredAt);
    expect(matches.map((match) => match.id)).toEqual(["a", "b"]);
  });

  test("never offers a voided invoice", async () => {
    const { client } = reader();
    const matches = await findInvoices(seed(), client, "xmr:1", occurredAt);
    expect(matches.map((match) => match.id)).not.toContain("d");
  });
});

describe("isCandidate", () => {
  test("tolerates the gap between market value and invoice price", () => {
    expect(isCandidate(799, 804)).toBe(true);
    expect(isCandidate(5390, 804)).toBe(false);
    expect(isCandidate(10000, 10700)).toBe(true);
    expect(isCandidate(10000, 11000)).toBe(false);
  });
});
