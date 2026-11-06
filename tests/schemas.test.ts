import { describe, expect, test } from "bun:test";
import { DEFAULT_PURPOSE_TEMPLATES } from "../src/shared/purpose.ts";
import {
  lexwareKeySchema,
  moneroFormSchema,
  settingsSchema,
  stripeKeySchema,
} from "../src/shared/schemas.ts";
import type { SettingsDto } from "../src/shared/types.ts";

const valid: SettingsDto = {
  exportDir: "/home/name/Bookkeeping/exports",
  dateFormat: "iso",
  decimalFormat: "dot",
  baselineDate: "2026-01-04T15:30",
  feesClosedThrough: "2026-01",
  rateSource: "auto",
  stripeName: "Stripe Technology Europe, Limited",
  paypalName: "PayPal (Europe) S.à r.l. et Cie, S.C.A.",
  moneroNodes: ["https://node.example.org:18089"],
  accounts: { stripe: "Stripe", fees: "Stripe", monero: "Monero" },
  purposeTemplates: DEFAULT_PURPOSE_TEMPLATES,
};

function errorFor(change: Partial<SettingsDto>): string | undefined {
  return settingsSchema.safeParse({ ...valid, ...change }).error?.issues[0]
    ?.message;
}

describe("settingsSchema", () => {
  test("accepts valid and empty values", () => {
    expect(errorFor({})).toBeUndefined();
    expect(
      errorFor({ baselineDate: "", feesClosedThrough: "" }),
    ).toBeUndefined();
  });

  test("rejects relative folders", () => {
    expect(errorFor({ exportDir: "~/exports" })).toContain("absoluten Pfad");
    expect(errorFor({ exportDir: " " })).toContain("Ordner");
  });

  test("rejects future dates and unfinished months", () => {
    expect(errorFor({ baselineDate: "2999-01-01T00:00" })).toContain("Zukunft");
    expect(
      errorFor({ feesClosedThrough: new Date().toISOString().slice(0, 7) }),
    ).toContain("nicht abgeschlossen");
  });

  test("rejects malformed values", () => {
    expect(errorFor({ baselineDate: "04.10.2026" })).toContain(
      "Datum und Uhrzeit",
    );
    expect(errorFor({ feesClosedThrough: "2026" })).toContain("gültigen Monat");
  });
});

describe("purpose templates", () => {
  function issue(payment: string) {
    return settingsSchema.safeParse({
      ...valid,
      purposeTemplates: { ...valid.purposeTemplates, payment },
    }).error?.issues[0];
  }

  test("accepts the defaults and free text", () => {
    expect(issue("Zahlung {name} am {datum}")).toBeUndefined();
    expect(issue("Nur fester Text")).toBeUndefined();
  });

  test("names the unknown placeholder and its field", () => {
    expect(issue("{datum} {kurs}")?.message).toBe(
      "Unbekannter Platzhalter: {kurs}",
    );
    expect(issue("{datum} {kurs}")?.path).toEqual([
      "purposeTemplates",
      "payment",
    ]);
  });

  test("rejects an empty template", () => {
    expect(issue("  ")?.message).toContain("nicht leer");
  });

  test("rejects an empty company name", () => {
    expect(errorFor({ stripeName: " " })).toContain("Namen");
  });
});

describe("key schemas", () => {
  test("accepts Stripe keys and trims them", () => {
    expect(stripeKeySchema.parse({ value: " rk_live_abc123 " }).value).toBe(
      "rk_live_abc123",
    );
    expect(stripeKeySchema.safeParse({ value: "sk_test_abc" }).success).toBe(
      true,
    );
  });

  test("rejects other strings", () => {
    expect(stripeKeySchema.safeParse({ value: "pk_live_abc" }).success).toBe(
      false,
    );
    expect(lexwareKeySchema.safeParse({ value: "short" }).success).toBe(false);
    expect(
      lexwareKeySchema.safeParse({ value: "abcdefghij-klmnopqrst_uvw" })
        .success,
    ).toBe(true);
  });
});

describe("moneroFormSchema", () => {
  const form = {
    name: "Lena",
    product: "EPYC-02",
    booked: "7,99",
    rate: "530,76",
  };

  test("accepts German amounts", () => {
    expect(moneroFormSchema.safeParse(form).success).toBe(true);
  });

  test("names the broken field", () => {
    const result = moneroFormSchema.safeParse({
      ...form,
      booked: "abc",
      name: " ",
    });
    const fields = result.error?.issues.map((issue) => issue.path[0]);
    expect(fields).toEqual(["name", "booked"]);
  });

  test("rejects zero", () => {
    expect(moneroFormSchema.safeParse({ ...form, rate: "0" }).success).toBe(
      false,
    );
  });
});
