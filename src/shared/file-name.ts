import { renderTemplate, unknownPlaceholders } from "./purpose.ts";

export const DEFAULT_FILE_NAME_TEMPLATE = "{nummer} {konto} {zeitraum}";

export const FILE_NAME_PLACEHOLDERS = [
  "nummer",
  "konto",
  "zeitraum",
  "von",
  "bis",
  "erstellt",
  "zeilen",
];

export const FILE_NAME_DESCRIPTIONS: Record<string, string> = {
  nummer: "Laufende Exportnummer, vierstellig, zum Beispiel 0012",
  konto: "Lexware-Konto der Datei",
  zeitraum: "Erster bis letzter Buchungstag, bei einem Tag nur das Datum",
  von: "Erster Buchungstag",
  bis: "Letzter Buchungstag",
  erstellt: "Tag des Exports",
  zeilen: "Anzahl der Zeilen",
};

export const FILE_NAME_SAMPLE: Record<string, string> = {
  nummer: "0012",
  konto: "Stripe",
  zeitraum: "01.10.2026 bis 31.10.2026",
  von: "01.10.2026",
  bis: "31.10.2026",
  erstellt: "05.11.2026",
  zeilen: "42",
};

const FORBIDDEN = '/\\:*?"<>|';
const MAX_BYTES = 200;
const encoder = new TextEncoder();

function clean(value: string): string {
  return Array.from(value, (char) =>
    char < " " || FORBIDDEN.includes(char) ? "-" : char,
  ).join("");
}

export function fileNameProblem(template: string): string | null {
  const unknown = unknownPlaceholders(template, FILE_NAME_PLACEHOLDERS);
  if (unknown.length > 0) {
    return `Unbekannter Platzhalter: ${unknown
      .map((name) => `{${name}}`)
      .join(", ")}`;
  }
  if (!template.includes("{nummer}")) {
    return "{nummer} muss enthalten sein, damit jeder Dateiname eindeutig bleibt.";
  }
  const text = template.replace(/\{[^{}]*\}/g, "");
  if (clean(text) !== text) {
    return `Diese Zeichen sind nicht erlaubt: ${[...FORBIDDEN].join(" ")}`;
  }
  return null;
}

export function renderFileName(
  template: string,
  values: Record<string, string>,
): string {
  const cleaned = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, clean(value)]),
  );
  const chars = Array.from(
    clean(renderTemplate(template, cleaned))
      .replace(/\s+/g, " ")
      .replace(/^[\s.]+/, ""),
  );
  while (encoder.encode(chars.join("")).length > MAX_BYTES) {
    chars.pop();
  }
  return `${chars.join("").replace(/[\s.]+$/, "")}.csv`;
}
