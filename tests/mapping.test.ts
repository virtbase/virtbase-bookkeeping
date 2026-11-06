import { describe, expect, test } from "bun:test";
import {
  type BalanceTransaction,
  mapBalanceTransaction,
} from "../src/server/stripe/mapping.ts";

const base: BalanceTransaction = {
  id: "txn_1",
  type: "charge",
  amount: 5390,
  fee: 142,
  net: 5248,
  created: 1793888966,
  available_on: 1794268800,
  description: "EPYC-08",
  fee_details: [{ amount: 142, type: "stripe_fee" }],
  source: {
    object: "charge",
    id: "ch_1",
    billing_details: { name: "Anna Beispiel" },
    payment_method_details: { type: "card", card: { brand: "visa" } },
  },
};

describe("mapBalanceTransaction", () => {
  test("maps a card charge", () => {
    expect(mapBalanceTransaction(base)).toMatchObject({
      name: "Anna Beispiel",
      purpose: "EPYC-08",
      amountCents: 5390,
      stripeFeeCents: 142,
      passthroughFeeCents: 0,
      method: "Visa",
      needsReview: false,
    });
  });

  test("splits PayPal fees from Stripe fees", () => {
    const row = mapBalanceTransaction({
      ...base,
      type: "payment",
      fee: 110,
      fee_details: [
        { amount: 96, type: "payment_method_passthrough_fee" },
        { amount: 14, type: "stripe_fee" },
      ],
      source: {
        object: "charge",
        id: "py_1",
        billing_details: { name: "Max Muster" },
        payment_method_details: { type: "paypal" },
      },
    });
    expect(row).toMatchObject({
      stripeFeeCents: 14,
      passthroughFeeCents: 96,
      method: "PayPal",
    });
  });

  test("drops internal balance movements", () => {
    for (const type of [
      "payout_minimum_balance_hold",
      "payout_minimum_balance_release",
      "advance",
      "advance_funding",
    ]) {
      expect(mapBalanceTransaction({ ...base, type })).toBeNull();
    }
  });

  test("marks a payout as a company row", () => {
    const row = mapBalanceTransaction({
      ...base,
      type: "payout",
      amount: -6437,
      created: 1793854123,
      fee_details: [],
      source: { object: "payout", id: "po_1" },
    });
    expect(row).toMatchObject({
      name: "Stripe Technology Europe, Limited",
      company: "stripe",
      method: "Auszahlung",
    });
  });

  test("finds the customer of a refund through its charge", () => {
    const row = mapBalanceTransaction({
      ...base,
      type: "payment_refund",
      amount: -736,
      created: 1793911200,
      fee_details: [],
      source: {
        object: "refund",
        id: "pyr_1",
        reason: "requested_by_customer",
        charge: {
          object: "charge",
          id: "py_1",
          billing_details: { name: "Erika Mustermann" },
        },
      },
    });
    expect(row).toMatchObject({
      name: "Erika Mustermann",
      company: null,
      refundReason: "Kunde hat Rückerstattung angefordert",
    });
  });

  test("falls back to the customer object, then flags a missing name", () => {
    const named = mapBalanceTransaction({
      ...base,
      source: {
        object: "charge",
        id: "ch_2",
        billing_details: { name: null },
        customer: { name: "Beispiel GmbH" },
      },
    });
    expect(named?.name).toBe("Beispiel GmbH");
    const missing = mapBalanceTransaction({
      ...base,
      source: { object: "charge", id: "ch_3" },
    });
    expect(missing).toMatchObject({ name: null, needsReview: true });
  });

  test("flags unknown types instead of losing them", () => {
    const row = mapBalanceTransaction({
      ...base,
      type: "reserve_transaction",
      source: null,
    });
    expect(row).toMatchObject({ needsReview: true, hidden: false });
  });

  test("hides standalone fees but keeps their amount for the month", () => {
    const row = mapBalanceTransaction({
      ...base,
      type: "stripe_fee",
      amount: -250,
      fee_details: [],
      source: null,
    });
    expect(row).toMatchObject({ hidden: true, stripeFeeCents: 250 });
  });
});
