export const PURPOSE_KEYS = [
  "payment",
  "payout",
  "refund",
  "failedRefund",
  "other",
  "feeStripe",
  "feePaypal",
  "monero",
] as const;

export type PurposeKey = (typeof PURPOSE_KEYS)[number];
export type PurposeTemplates = Record<PurposeKey, string>;

export interface PurposeDefinition {
  label: string;
  template: string;
  placeholders: string[];
  sample: Record<string, string>;
}

const BASE_SAMPLE = {
  datum: "05.11.2026",
  betrag: "53,90",
  name: "Anna Beispiel",
  beschreibung: "EPYC-08",
};

export const PURPOSE_DEFINITIONS: Record<PurposeKey, PurposeDefinition> = {
  payment: {
    label: "Zahlungen",
    template: "{beschreibung}",
    placeholders: ["beschreibung", "datum", "betrag", "name", "zahlungsart"],
    sample: { ...BASE_SAMPLE, zahlungsart: "Visa" },
  },
  payout: {
    label: "Auszahlungen",
    template:
      "Geldtransit vom {datum} über {betrag}€ - Auszahlung von gesammelten Transaktionen",
    placeholders: ["datum", "betrag"],
    sample: BASE_SAMPLE,
  },
  refund: {
    label: "Rückerstattungen",
    template:
      "Rückerstattung vom {datum} über {betrag}€, Kunde: {name}, Grund: {grund}",
    placeholders: ["datum", "betrag", "name", "grund"],
    sample: { ...BASE_SAMPLE, grund: "Doppelte Zahlung" },
  },
  failedRefund: {
    label: "Fehlgeschlagene Zahlungen",
    template:
      "Rückerstattung vom {datum} über {betrag}€, Kunde: {name}, Grund: Fehlgeschlagene Zahlung",
    placeholders: ["datum", "betrag", "name"],
    sample: BASE_SAMPLE,
  },
  other: {
    label: "Sonstige Stripe-Buchungen",
    template: "{beschreibung}",
    placeholders: ["beschreibung", "datum", "betrag", "name"],
    sample: { ...BASE_SAMPLE, beschreibung: "Chargeback reversal" },
  },
  feeStripe: {
    label: "Stripe-Gebühren",
    template: "Stripe Processing Fees {monat}",
    placeholders: ["monat", "betrag"],
    sample: { monat: "10/26", betrag: "19,60" },
  },
  feePaypal: {
    label: "PayPal-Gebühren",
    template: "Stripe PayPal Passthrough-Fees {monat}",
    placeholders: ["monat", "betrag"],
    sample: { monat: "10/26", betrag: "8,46" },
  },
  monero: {
    label: "Monero-Zahlungen",
    template: "{produkt} - {xmr} XMR (1 XMR = {kurs} EUR)",
    placeholders: ["produkt", "xmr", "kurs", "datum", "betrag", "name"],
    sample: {
      ...BASE_SAMPLE,
      betrag: "7,99",
      produkt: "EPYC-02",
      xmr: "0.01514805",
      kurs: "530,76",
    },
  },
};

export const PLACEHOLDER_DESCRIPTIONS: Record<string, string> = {
  beschreibung: "Text aus Stripe, meist das Produkt",
  datum: "Buchungsdatum, zum Beispiel 05.11.2026",
  betrag: "Betrag ohne Vorzeichen, zum Beispiel 53,90",
  name: "Name des Kunden",
  zahlungsart: "Zahlungsart, zum Beispiel Visa oder PayPal",
  grund: "Grund der Rückerstattung",
  monat: "Monat der Gebühren, zum Beispiel 10/26",
  produkt: "Produkt aus der Rechnung",
  xmr: "Erhaltene Menge in XMR",
  kurs: "XMR/EUR-Kurs zum Zahlungszeitpunkt",
};

export const DEFAULT_PURPOSE_TEMPLATES = Object.fromEntries(
  PURPOSE_KEYS.map((key) => [key, PURPOSE_DEFINITIONS[key].template]),
) as PurposeTemplates;

const PLACEHOLDER = /\{([^{}]*)\}/g;

export function renderTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(
    PLACEHOLDER,
    (match, name: string) => values[name] ?? match,
  );
}

export function unknownPlaceholders(
  template: string,
  allowed: string[],
): string[] {
  return [...template.matchAll(PLACEHOLDER)]
    .map((match) => match[1] ?? "")
    .filter((name) => !allowed.includes(name));
}
