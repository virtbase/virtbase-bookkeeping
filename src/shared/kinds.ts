export const KIND_GROUPS = [
  "payment",
  "refund",
  "payout",
  "adjustment",
  "fee",
  "other",
] as const;

export type KindGroup = (typeof KIND_GROUPS)[number];

const GROUPS: Record<string, KindGroup> = {
  charge: "payment",
  payment: "payment",
  incoming: "payment",
  refund: "refund",
  payment_refund: "refund",
  payment_failure_refund: "refund",
  payout: "payout",
  payout_cancel: "payout",
  payout_failure: "payout",
  adjustment: "adjustment",
  stripe_fee: "fee",
  stripe_fx_fee: "fee",
  tax_fee: "fee",
  application_fee: "fee",
  payment_method_passthrough_fee: "fee",
};

export function kindGroup(kind: string): KindGroup {
  return GROUPS[kind] ?? "other";
}

export function isRevenueKind(kind: string): boolean {
  const group = kindGroup(kind);
  return group === "payment" || group === "refund";
}

export function isPaymentKind(kind: string): boolean {
  return kindGroup(kind) === "payment";
}

export const REVIEW_MISSING_NAME =
  "Stripe liefert keinen Namen für diese Zahlung.";
export const REVIEW_UNKNOWN_TYPE = "Unbekannter Stripe-Typ";
export const REVIEW_MONERO_DETAILS = "Name und Produkt ergänzen.";
export const REVIEW_MONERO_RATE = "Kurs nicht gefunden, bitte eintragen.";

export function reviewKey(reason: string): string {
  if (reason === REVIEW_MISSING_NAME) {
    return "name";
  }
  if (reason.startsWith(REVIEW_UNKNOWN_TYPE)) {
    return "type";
  }
  if (reason === REVIEW_MONERO_DETAILS) {
    return "details";
  }
  return reason === REVIEW_MONERO_RATE ? "rate" : reason;
}
