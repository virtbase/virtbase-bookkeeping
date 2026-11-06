import {
  auditLabel,
  formatAuditDetail,
  formatAuditTime,
} from "../../shared/audit.ts";
import { neutralizeField, quoteField } from "../../shared/csv.ts";
import type { DateFormat, DecimalFormat } from "../../shared/types.ts";
import { germanDay, localStamp } from "../time.ts";

export const CSV_HEADER = [
  "Buchungsdatum",
  "Auftraggeber / Empfänger",
  "Verwendungszweck",
  "Betrag",
  "Soll Betrag (Ausgabe)",
  "Haben Betrag (Einnahme)",
  "Wertstellungsdatum",
];

export interface CsvRow {
  occurredAt: number;
  valueAt: number;
  name: string;
  purpose: string;
  amountCents: number;
}

export interface CsvOptions {
  dateFormat: DateFormat;
  decimalFormat: DecimalFormat;
}

function formatAmount(cents: number, format: DecimalFormat): string {
  if (format === "comma") {
    return (cents / 100).toFixed(2).replace(".", ",");
  }
  const value = cents / 100;
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

function formatDate(unix: number, format: DateFormat): string {
  return format === "de" ? germanDay(unix) : localStamp(unix);
}

export function renderCsv(rows: CsvRow[], options: CsvOptions): string {
  const lines = [CSV_HEADER.join(";")];
  for (const row of rows) {
    const amount = formatAmount(row.amountCents, options.decimalFormat);
    const magnitude = formatAmount(
      Math.abs(row.amountCents),
      options.decimalFormat,
    );
    lines.push(
      [
        formatDate(row.occurredAt, options.dateFormat),
        neutralizeField(row.name),
        neutralizeField(row.purpose),
        amount,
        row.amountCents < 0 ? magnitude : "",
        row.amountCents >= 0 ? magnitude : "",
        formatDate(row.valueAt, options.dateFormat),
      ]
        .map(quoteField)
        .join(";"),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function renderAuditCsv(
  events: { at: number; type: string; detail: Record<string, unknown> }[],
): string {
  const lines = [
    ["Zeitpunkt", "Ereignis", "Details"].join(";"),
    ...events.map((event) =>
      [
        formatAuditTime(event.at),
        neutralizeField(auditLabel(event.type)),
        neutralizeField(formatAuditDetail(event.detail)),
      ]
        .map(quoteField)
        .join(";"),
    ),
  ];
  return `${lines.join("\r\n")}\r\n`;
}
