import { STRIPE_NAME } from "../constants.ts";

export interface FeeDetail {
  amount: number;
  type: string;
}

export interface StripeCustomer {
  object?: string;
  deleted?: boolean;
  name?: string | null;
  email?: string | null;
}

export interface StripeCharge {
  object: "charge";
  id: string;
  billing_details?: { name?: string | null; email?: string | null } | null;
  customer?: StripeCustomer | string | null;
  receipt_email?: string | null;
  shipping?: { name?: string | null } | null;
  payment_method_details?: {
    type?: string;
    card?: { brand?: string | null } | null;
  } | null;
}

export interface StripeRefund {
  object: "refund";
  id: string;
  reason?: string | null;
  charge?: StripeCharge | string | null;
}

export interface StripeDispute {
  object: "dispute";
  id: string;
  charge?: StripeCharge | string | null;
}

export type StripeSource =
  | StripeCharge
  | StripeRefund
  | StripeDispute
  | { object: string; id: string }
  | string
  | null;

export interface BalanceTransaction {
  id: string;
  type: string;
  amount: number;
  fee: number;
  net: number;
  created: number;
  available_on: number;
  description: string | null;
  fee_details: FeeDetail[];
  source: StripeSource;
}

export interface MappedTransaction {
  id: string;
  source: "stripe";
  kind: string;
  occurredAt: number;
  valueAt: number;
  name: string | null;
  purpose: string;
  amountCents: number;
  stripeFeeCents: number;
  passthroughFeeCents: number;
  method: string | null;
  reference: string | null;
  needsReview: boolean;
  reviewReason: string | null;
  hidden: boolean;
  description: string | null;
  refundReason: string | null;
  company: "stripe" | null;
}

const INTERNAL_TYPES = new Set([
  "payout_minimum_balance_hold",
  "payout_minimum_balance_release",
  "advance",
  "advance_funding",
]);

const STANDALONE_FEE_TYPES = new Set([
  "stripe_fee",
  "stripe_fx_fee",
  "tax_fee",
  "application_fee",
]);

const CUSTOMER_TYPES = new Set([
  "charge",
  "payment",
  "refund",
  "payment_refund",
  "payment_failure_refund",
]);

const REFUND_REASONS: Record<string, string> = {
  duplicate: "Doppelte Zahlung",
  fraudulent: "Verdacht auf Betrug",
  requested_by_customer: "Kunde hat Rückerstattung angefordert",
};

function isObject<T extends { object: string }>(
  source: unknown,
  object: T["object"],
): source is T {
  return (
    typeof source === "object" &&
    source !== null &&
    (source as { object?: unknown }).object === object
  );
}

function chargeOf(source: StripeSource): StripeCharge | null {
  if (isObject<StripeCharge>(source, "charge")) {
    return source;
  }
  if (
    isObject<StripeRefund>(source, "refund") ||
    isObject<StripeDispute>(source, "dispute")
  ) {
    return isObject<StripeCharge>(source.charge, "charge")
      ? source.charge
      : null;
  }
  return null;
}

function customerName(charge: StripeCharge | null): string | null {
  if (!charge) {
    return null;
  }
  const customer =
    typeof charge.customer === "object" && charge.customer !== null
      ? charge.customer
      : null;
  return (
    charge.billing_details?.name ||
    customer?.name ||
    customer?.email ||
    charge.shipping?.name ||
    charge.billing_details?.email ||
    charge.receipt_email ||
    null
  );
}

function methodLabel(charge: StripeCharge | null): string | null {
  const details = charge?.payment_method_details;
  if (!details?.type) {
    return null;
  }
  if (details.type === "card") {
    const brand = details.card?.brand ?? "Karte";
    return brand.charAt(0).toUpperCase() + brand.slice(1);
  }
  if (details.type === "paypal") {
    return "PayPal";
  }
  return details.type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function refundReason(source: StripeSource): string | null {
  if (isObject<StripeRefund>(source, "refund") && source.reason) {
    return REFUND_REASONS[source.reason] ?? source.reason;
  }
  return null;
}

function splitFees(details: FeeDetail[]): {
  stripe: number;
  passthrough: number;
} {
  let stripe = 0;
  let passthrough = 0;
  for (const detail of details) {
    if (detail.type === "payment_method_passthrough_fee") {
      passthrough += detail.amount;
    } else {
      stripe += detail.amount;
    }
  }
  return { stripe, passthrough };
}

function referenceOf(source: StripeSource): string | null {
  if (typeof source === "string") {
    return source;
  }
  return source?.id ?? null;
}

export function mapBalanceTransaction(
  transaction: BalanceTransaction,
): MappedTransaction | null {
  if (INTERNAL_TYPES.has(transaction.type)) {
    return null;
  }
  const fees = splitFees(transaction.fee_details);
  const charge = chargeOf(transaction.source);
  const description = transaction.description?.trim() || null;
  const base = {
    id: transaction.id,
    source: "stripe" as const,
    kind: transaction.type,
    occurredAt: transaction.created,
    valueAt: transaction.available_on,
    reference: referenceOf(transaction.source),
    description,
    refundReason: refundReason(transaction.source),
  };

  if (STANDALONE_FEE_TYPES.has(transaction.type)) {
    return {
      ...base,
      name: STRIPE_NAME,
      company: "stripe",
      purpose: description ?? transaction.type,
      amountCents: transaction.amount,
      stripeFeeCents: fees.stripe - transaction.amount,
      passthroughFeeCents: fees.passthrough,
      method: null,
      needsReview: false,
      reviewReason: null,
      hidden: true,
    };
  }

  const isCustomerRow = CUSTOMER_TYPES.has(transaction.type);
  const customer = customerName(charge);
  const usesCompany = !isCustomerRow && !customer;
  const name = usesCompany ? STRIPE_NAME : customer;
  const known =
    isCustomerRow ||
    transaction.type === "payout" ||
    transaction.type === "adjustment";

  let reviewReason: string | null = null;
  if (!name) {
    reviewReason = "Stripe liefert keinen Namen für diese Zahlung.";
  } else if (!known) {
    reviewReason = `Unbekannter Stripe-Typ: ${transaction.type}`;
  }

  return {
    ...base,
    name,
    company: usesCompany ? "stripe" : null,
    purpose: description ?? transaction.type.replaceAll("_", " "),
    amountCents: transaction.amount,
    stripeFeeCents: fees.stripe,
    passthroughFeeCents: fees.passthrough,
    method:
      methodLabel(charge) ??
      (transaction.type === "payout" ? "Auszahlung" : null),
    needsReview: reviewReason !== null,
    reviewReason,
    hidden: false,
  };
}
