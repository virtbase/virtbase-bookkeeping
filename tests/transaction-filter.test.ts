import { describe, expect, test } from "bun:test";
import * as lucide from "lucide-react";
import { kindGroup, reviewKey } from "../src/shared/kinds.ts";
import type { TransactionDto } from "../src/shared/types.ts";
import * as icons from "../src/web/components/icons.tsx";
import { matchesDefaults } from "../src/web/lib/filter-state.ts";
import { methodIcon } from "../src/web/lib/payment-methods.ts";
import type { TransactionFilter } from "../src/web/lib/transaction-filter.ts";
import {
  contextFilter,
  DEFAULT_TRANSACTION_FILTER,
  filterTransactions,
  presetBounds,
} from "../src/web/lib/transaction-filter.ts";

const at = (iso: string) => Date.parse(iso) / 1000;
const TODAY = "2026-11-07";

function row(values: Partial<TransactionDto>): TransactionDto {
  return {
    id: "txn",
    source: "stripe",
    account: "Stripe",
    kind: "charge",
    occurredAt: at("2026-11-05T10:00:00+01:00"),
    valueAt: at("2026-11-07T10:00:00+01:00"),
    name: "Anna Beispiel",
    purpose: "EPYC-01",
    amountCents: 1999,
    stripeFeeCents: 50,
    passthroughFeeCents: 0,
    method: "Visa",
    reviewReason: null,
    status: "ready",
    batchId: null,
    xmrAtomic: null,
    xmrRate: null,
    rateSource: null,
    marketValueCents: null,
    product: null,
    walletLabel: null,
    customerKey: "id:cus_anna",
    customerName: "Anna Beispiel",
    productLabel: "EPYC-01",
    feeBasis: null,
    countsAsRevenue: true,
    ...values,
  };
}

const rows = [
  row({ id: "charge" }),
  row({
    id: "refund",
    kind: "refund",
    amountCents: -1999,
    status: "exported",
    batchId: 4,
    occurredAt: at("2026-10-31T23:30:00+01:00"),
  }),
  row({
    id: "payout",
    kind: "payout",
    amountCents: -50000,
    name: "Stripe",
    method: "Auszahlung",
    customerKey: "name:stripe",
    productLabel: null,
    countsAsRevenue: false,
  }),
  row({
    id: "nameless",
    name: null,
    status: "review",
    reviewReason: "Stripe liefert keinen Namen für diese Zahlung.",
    customerKey: null,
  }),
  row({
    id: "xmr",
    source: "monero",
    kind: "incoming",
    status: "review",
    reviewReason: "Name und Produkt ergänzen.",
    method: "Monero",
    amountCents: 4200,
    customerKey: null,
    productLabel: null,
    countsAsRevenue: false,
  }),
  row({
    id: "old",
    status: "exported",
    occurredAt: at("2025-06-01T10:00:00+02:00"),
  }),
  row({ id: "ignored", status: "ignored", countsAsRevenue: false }),
  row({
    id: "fee",
    source: "fees",
    kind: "stripe_fee",
    amountCents: -900,
    occurredAt: at("2026-10-31T00:00:00+01:00"),
    method: null,
    feeBasis: "71 Stripe-Transaktionen",
    customerKey: null,
    productLabel: null,
    countsAsRevenue: false,
  }),
];

const viewFilter = (change: Partial<TransactionFilter>): TransactionFilter => ({
  ...DEFAULT_TRANSACTION_FILTER,
  ...change,
});

const isDefault = (filter: Partial<TransactionFilter>) =>
  matchesDefaults(viewFilter(filter), DEFAULT_TRANSACTION_FILTER);

const ids = (
  change: Partial<TransactionFilter>,
  base: (
    change: Partial<TransactionFilter>,
  ) => Partial<TransactionFilter> = contextFilter,
) =>
  filterTransactions(rows, viewFilter(base(change)), TODAY).map(
    (entry) => entry.id,
  );

describe("filterTransactions", () => {
  test("shows open rows since the last export by default", () => {
    expect(ids({}, viewFilter)).toEqual([
      "charge",
      "payout",
      "nameless",
      "xmr",
      "fee",
    ]);
    expect(
      matchesDefaults(DEFAULT_TRANSACTION_FILTER, DEFAULT_TRANSACTION_FILTER),
    ).toBe(true);
  });

  test("hides rows exported before the start point unless asked", () => {
    expect(ids({ statuses: ["exported"] }, viewFilter)).toEqual(["refund"]);
    expect(ids({ statuses: ["exported"] })).toEqual(["refund", "old"]);
  });

  test("groups Stripe types", () => {
    expect(ids({ kinds: ["refund", "payout"] })).toEqual(["refund", "payout"]);
    expect(ids({ kinds: ["fee"] })).toEqual(["fee"]);
    expect(kindGroup("payment_failure_refund")).toBe("refund");
    expect(kindGroup("something_new")).toBe("other");
  });

  test("filters by review reason", () => {
    expect(ids({ reasons: ["name"] })).toEqual(["nameless"]);
    expect(ids({ reasons: ["details"] })).toEqual(["xmr"]);
    expect(reviewKey("Unbekannter Stripe-Typ: topup")).toBe("type");
  });

  test("filters by payment method", () => {
    expect(ids({ methods: ["Monero", "Auszahlung"] })).toEqual([
      "payout",
      "xmr",
    ]);
  });

  test("filters by direction and amount without sign", () => {
    expect(ids({ direction: "out" })).toEqual(["refund", "payout", "fee"]);
    expect(ids({ minCents: 1999, maxCents: 4200 })).toEqual([
      "charge",
      "refund",
      "nameless",
      "xmr",
      "old",
      "ignored",
    ]);
  });

  test("searches names, purposes and amounts", () => {
    expect(ids({ search: "19,99" })).toEqual([
      "charge",
      "refund",
      "nameless",
      "old",
      "ignored",
    ]);
    expect(ids({ search: "42.00" })).toEqual(["xmr"]);
  });

  test("uses German days for custom ranges and months", () => {
    expect(ids({ range: null, from: "2026-10-31", to: "2026-10-31" })).toEqual([
      "refund",
      "fee",
    ]);
    expect(ids({ range: null, from: "2026-11-05", to: null })).toHaveLength(5);
  });

  test("computes the preset ranges", () => {
    expect(presetBounds("week", TODAY)).toEqual({
      from: "2026-11-02",
      to: TODAY,
    });
    expect(presetBounds("last-month", TODAY)).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(presetBounds("year", TODAY)).toEqual({
      from: "2026-01-01",
      to: TODAY,
    });
    expect(presetBounds("all", TODAY)).toBeNull();
  });

  test("filters by context from other pages", () => {
    expect(ids({ batchId: 4 })).toEqual(["refund"]);
    expect(ids({ ids: ["xmr", "fee"] })).toEqual(["xmr", "fee"]);
    expect(ids({ days: ["2026-10-31"] })).toEqual(["refund", "fee"]);
    expect(ids({ customers: ["id:cus_anna"] })).toEqual([
      "charge",
      "refund",
      "old",
      "ignored",
    ]);
    expect(ids({ products: ["EPYC-01"] })).toEqual([
      "charge",
      "refund",
      "nameless",
      "old",
      "ignored",
    ]);
  });

  test("keeps only the rows the statistics count as revenue", () => {
    expect(ids({ revenueOnly: true })).toEqual([
      "charge",
      "refund",
      "nameless",
      "old",
    ]);
  });

  test("treats a filter as default until a field differs", () => {
    expect(isDefault(viewFilter({ search: "  ", to: "2026-11-01" }))).toBe(
      true,
    );
    expect(isDefault(viewFilter({ statuses: ["review", "ready"] }))).toBe(
      false,
    );
    expect(isDefault(contextFilter({}))).toBe(false);
  });
});

describe("methodIcon", () => {
  test("uses brand marks, bank and card fallbacks", () => {
    expect(methodIcon("Visa")).toBe(icons.VisaIcon);
    expect(methodIcon("Revolut Pay")).toBe(icons.RevolutIcon);
    expect(methodIcon("Sepa Debit")).toBe(lucide.Landmark);
    expect(methodIcon("Discover")).toBe(lucide.CreditCard);
    expect(methodIcon("Something New")).toBe(lucide.Wallet);
  });
});
