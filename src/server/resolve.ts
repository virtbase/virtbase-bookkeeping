import { atomicToXmr, formatPlainGerman } from "../shared/money.ts";
import { type PurposeKey, renderTemplate } from "../shared/purpose.ts";
import type { SettingsDto } from "../shared/types.ts";
import type { transactions } from "./db/schema.ts";
import { germanDay, localDay } from "./time.ts";

type Row = typeof transactions.$inferSelect;

export interface ResolvedText {
  name: string | null;
  purpose: string;
}

export function purposeKey(row: Pick<Row, "source" | "kind">): PurposeKey {
  if (row.source === "monero") {
    return "monero";
  }
  if (row.source === "fees") {
    return row.kind === "stripe_fee" ? "feeStripe" : "feePaypal";
  }
  switch (row.kind) {
    case "charge":
    case "payment":
      return "payment";
    case "payout":
      return "payout";
    case "refund":
    case "payment_refund":
      return "refund";
    case "payment_failure_refund":
      return "failedRefund";
    default:
      return "other";
  }
}

function resolveName(row: Row, settings: SettingsDto): string | null {
  if (row.company === "stripe") {
    return settings.stripeName;
  }
  return row.company === "paypal" ? settings.paypalName : row.name;
}

function monthLabel(unix: number): string {
  const day = localDay(unix);
  return `${day.slice(5, 7)}/${day.slice(2, 4)}`;
}

function placeholderValues(
  row: Row,
  name: string | null,
): Record<string, string> {
  return {
    datum: germanDay(row.occurredAt),
    betrag: formatPlainGerman(row.amountCents),
    name: name ?? "unbekannt",
    beschreibung: row.description ?? row.purpose,
    grund: row.refundReason ?? "Rückerstattung",
    zahlungsart: row.method ?? "",
    monat: monthLabel(row.occurredAt),
    produkt: row.product ?? "",
    xmr: row.xmrAtomic ? atomicToXmr(row.xmrAtomic) : "",
    kurs: row.xmrRate ? formatPlainGerman(Math.round(row.xmrRate * 100)) : "",
  };
}

export function resolveRow(row: Row, settings: SettingsDto): ResolvedText {
  const name = resolveName(row, settings);
  if (row.source === "monero" && !row.product) {
    return { name, purpose: row.purpose };
  }
  const template = settings.purposeTemplates[purposeKey(row)];
  return {
    name,
    purpose: renderTemplate(template, placeholderValues(row, name)),
  };
}

export function frozenRow(row: Row): ResolvedText {
  return { name: row.name, purpose: row.purpose };
}
