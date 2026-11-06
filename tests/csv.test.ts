import { describe, expect, test } from "bun:test";
import { renderCsv } from "../src/server/export/csv.ts";
import { localMidnight } from "../src/server/time.ts";

const income = {
  occurredAt: Date.parse("2026-11-05T14:29:26Z") / 1000,
  valueAt: Date.parse("2026-11-10T00:00:00Z") / 1000,
  name: "Anna Beispiel",
  purpose: "EPYC-08",
  amountCents: 5390,
};

describe("renderCsv", () => {
  test("reproduces the existing Lexware format byte for byte", () => {
    const csv = renderCsv(
      [
        income,
        {
          ...income,
          occurredAt: Date.parse("2026-11-05T00:48:43Z") / 1000,
          valueAt: Date.parse("2026-11-05T00:48:43Z") / 1000,
          name: "Stripe Technology Europe, Limited",
          purpose:
            "Geldtransit vom 05.11.2026 über 64,37€ - Auszahlung von gesammelten Transaktionen",
          amountCents: -6437,
        },
        { ...income, amountCents: 2000 },
      ],
      { dateFormat: "iso", decimalFormat: "dot" },
    );
    expect(csv).toBe(
      [
        "Buchungsdatum;Auftraggeber / Empfänger;Verwendungszweck;Betrag;Soll Betrag (Ausgabe);Haben Betrag (Einnahme);Wertstellungsdatum",
        "2026-11-05 15:29:26;Anna Beispiel;EPYC-08;53.9;;53.9;2026-11-10 01:00:00",
        "2026-11-05 01:48:43;Stripe Technology Europe, Limited;Geldtransit vom 05.11.2026 über 64,37€ - Auszahlung von gesammelten Transaktionen;-64.37;64.37;;2026-11-05 01:48:43",
        "2026-11-05 15:29:26;Anna Beispiel;EPYC-08;20.0;;20.0;2026-11-10 01:00:00",
        "",
      ].join("\r\n"),
    );
  });

  test("reproduces the month-end fee rows", () => {
    const day = localMidnight("2026-09-30");
    const csv = renderCsv(
      [
        {
          occurredAt: day,
          valueAt: day,
          name: "PayPal (Europe) S.à r.l. et Cie, S.C.A.",
          purpose: "Stripe PayPal Passthrough-Fees 09/26",
          amountCents: -566,
        },
      ],
      { dateFormat: "iso", decimalFormat: "dot" },
    );
    expect(csv.split("\r\n")[1]).toBe(
      "2026-09-30 00:00:00;PayPal (Europe) S.à r.l. et Cie, S.C.A.;Stripe PayPal Passthrough-Fees 09/26;-5.66;5.66;;2026-09-30 00:00:00",
    );
  });

  test("supports German dates and decimal commas", () => {
    const csv = renderCsv([income], {
      dateFormat: "de",
      decimalFormat: "comma",
    });
    expect(csv.split("\r\n")[1]).toBe(
      "05.11.2026;Anna Beispiel;EPYC-08;53,90;;53,90;10.11.2026",
    );
  });

  test("quotes separators and neutralizes formulas", () => {
    const csv = renderCsv(
      [{ ...income, name: "=HYPERLINK(1)", purpose: 'a;b"c' }],
      { dateFormat: "iso", decimalFormat: "dot" },
    );
    const line = csv.split("\r\n")[1];
    expect(line).toContain(";'=HYPERLINK(1);");
    expect(line).toContain(';"a;b""c";');
  });
});
