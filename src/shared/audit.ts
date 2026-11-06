export const AUDIT_LABELS: Record<string, string> = {
  sync: "Stripe synchronisiert",
  export: "Export erstellt",
  "export.void": "Export storniert",
  "export.imported": "In Lexware importiert",
  "monero.import": "Monero-Zahlungen importiert",
  "monero.wallet": "Monero-Wallet eingerichtet",
  "monero.wallet.remove": "Monero-Wallet entfernt",
  settings: "Einstellungen geändert",
  "transaction.edit": "Zeile bearbeitet",
  "transaction.ignore": "Zeile ausgeblendet",
  "transaction.restore": "Zeile eingeblendet",
  "reset.exports": "Exporte zurückgesetzt",
  "reset.all": "Datenbank zurückgesetzt",
  "audit.export": "Audit-Log exportiert",
  "statistics.export": "Statistik exportiert",
  backup: "Sicherung erstellt",
  "backup.failed": "Sicherung fehlgeschlagen",
};

const DETAIL_LABELS: Record<string, string> = {
  from: "ab",
  file: "Datei",
  reason: "Grund",
  account: "Konto",
  fetched: "abgerufen",
  added: "neu",
  feeRows: "Gebührenzeilen",
  id: "Nr.",
  ids: "Zeilen",
  rows: "Zeilen",
  sha256: "SHA-256",
  skipped: "übersprungen",
  withoutRate: "ohne Kurs",
  restoreHeight: "Höhe",
};

const stamp = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function formatAuditTime(unix: number): string {
  return stamp.format(new Date(unix * 1000)).replace(",", "");
}

export function auditLabel(type: string): string {
  return AUDIT_LABELS[type] ?? type;
}

export function formatAuditDetail(detail: Record<string, unknown>): string {
  return Object.entries(detail)
    .map(([key, value]) => {
      const label = DETAIL_LABELS[key] ?? key;
      const text =
        key === "from" && typeof value === "number"
          ? formatAuditTime(value)
          : Array.isArray(value)
            ? value.join(", ")
            : String(value);
      return `${label}: ${text}`;
    })
    .join(", ");
}
