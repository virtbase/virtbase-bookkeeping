import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/server/db/client.ts";
import { MIGRATIONS } from "../src/server/db/migrations.ts";
import { transactions } from "../src/server/db/schema.ts";
import { chooseFolder } from "../src/server/folder-dialog.ts";
import { resolveRow } from "../src/server/resolve.ts";
import { readSyncMarks } from "../src/server/settings.ts";
import {
  DEFAULT_PURPOSE_TEMPLATES,
  PLACEHOLDER_DESCRIPTIONS,
  PURPOSE_DEFINITIONS,
  PURPOSE_KEYS,
  renderTemplate,
  unknownPlaceholders,
} from "../src/shared/purpose.ts";
import type { SettingsDto } from "../src/shared/types.ts";

const settings: SettingsDto = {
  exportDir: "/tmp",
  backupDir: "",
  dateFormat: "iso",
  decimalFormat: "dot",
  baselineDate: "",
  feesClosedThrough: "",
  rateSource: "auto",
  stripeName: "Stripe Technology Europe, Limited",
  paypalName: "PayPal (Europe) S.à r.l. et Cie, S.C.A.",
  moneroNodes: ["https://node.example.org:18089"],
  accounts: { stripe: "Stripe", fees: "Stripe", monero: "Monero" },
  purposeTemplates: DEFAULT_PURPOSE_TEMPLATES,
};

const occurredAt = Date.parse("2026-11-05T00:48:43Z") / 1000;

function row(values: Partial<typeof transactions.$inferSelect>) {
  return {
    id: "x",
    source: "stripe",
    kind: "charge",
    occurredAt,
    valueAt: occurredAt,
    name: "Anna Beispiel",
    purpose: "stored",
    amountCents: 6437,
    stripeFeeCents: 0,
    passthroughFeeCents: 0,
    method: null,
    reference: null,
    needsReview: false,
    reviewReason: null,
    hidden: false,
    description: null,
    refundReason: null,
    company: null,
    xmrAtomic: null,
    xmrRate: null,
    rateSource: null,
    rateWindow: null,
    marketValueCents: null,
    product: null,
    walletLabel: null,
    invoiceId: null,
    createdAt: occurredAt,
    ...values,
  } as typeof transactions.$inferSelect;
}

const purpose = (values: Parameters<typeof row>[0]) =>
  resolveRow(row(values), settings).purpose;

describe("default templates reproduce the existing texts", () => {
  test("payments", () => {
    expect(purpose({ kind: "charge", description: "EPYC-08" })).toBe("EPYC-08");
  });

  test("payouts", () => {
    expect(purpose({ kind: "payout", amountCents: -6437 })).toBe(
      "Geldtransit vom 05.11.2026 über 64,37€ - Auszahlung von gesammelten Transaktionen",
    );
  });

  test("refunds", () => {
    expect(
      purpose({
        kind: "refund",
        amountCents: -310,
        refundReason: "Doppelte Zahlung",
      }),
    ).toBe(
      "Rückerstattung vom 05.11.2026 über 3,10€, Kunde: Anna Beispiel, Grund: Doppelte Zahlung",
    );
  });

  test("failed payments", () => {
    expect(purpose({ kind: "payment_failure_refund", amountCents: -899 })).toBe(
      "Rückerstattung vom 05.11.2026 über 8,99€, Kunde: Anna Beispiel, Grund: Fehlgeschlagene Zahlung",
    );
  });

  test("fee rows", () => {
    const day = Date.parse("2026-09-29T22:00:00Z") / 1000;
    expect(
      purpose({ source: "fees", kind: "stripe_fee", occurredAt: day }),
    ).toBe("Stripe Processing Fees 09/26");
    expect(
      purpose({
        source: "fees",
        kind: "payment_method_passthrough_fee",
        occurredAt: day,
      }),
    ).toBe("Stripe PayPal Passthrough-Fees 09/26");
  });

  test("Monero rows, as in crypto.csv", () => {
    expect(
      purpose({
        source: "monero",
        kind: "incoming",
        product: "EPYC-02",
        xmrAtomic: "15148050000",
        xmrRate: 530.76,
      }),
    ).toBe("EPYC-02 - 0.01514805 XMR (1 XMR = 530,76 EUR)");
  });

  test("a Monero row without a product keeps its stored text", () => {
    expect(
      purpose({ source: "monero", kind: "incoming", purpose: "0.1 XMR" }),
    ).toBe("0.1 XMR");
  });
});

describe("template helpers", () => {
  test("every sample fills all placeholders of its template", () => {
    for (const key of PURPOSE_KEYS) {
      const definition = PURPOSE_DEFINITIONS[key];
      for (const placeholder of definition.placeholders) {
        expect(definition.sample[placeholder]).toBeDefined();
        expect(PLACEHOLDER_DESCRIPTIONS[placeholder]).toBeDefined();
      }
      expect(
        unknownPlaceholders(definition.template, definition.placeholders),
      ).toEqual([]);
    }
  });

  test("leaves unknown placeholders visible", () => {
    expect(renderTemplate("{a} {b}", { a: "1" })).toBe("1 {b}");
  });
});

describe("migration from the first database version", () => {
  test("keeps rows and prepares them for templates", () => {
    const path = join(mkdtempSync(join(tmpdir(), "bookkeeping-")), "b.sqlite");
    const old = new Database(path, { create: true });
    old.run(MIGRATIONS[0] ?? "");
    old.run("PRAGMA user_version = 1");
    old.run(
      `INSERT INTO transactions (id, source, kind, occurred_at, value_at, name, purpose, amount_cents, created_at) VALUES
      ('a', 'stripe', 'payout', 1, 1, 'Stripe Technology Europe, Limited', 'Geldtransit', -100, 1),
      ('b', 'stripe', 'charge', 1, 1, 'Anna', 'EPYC-01', 399, 1),
      ('c', 'fees', 'payment_method_passthrough_fee', 1, 1, 'PayPal (Europe) S.à r.l. et Cie, S.C.A.', 'x', -5, 1)`,
    );
    old.run("INSERT INTO settings VALUES ('stripe.syncedFrom', '1')");
    old.close();

    const db = openDatabase(path);
    const rows = db.select().from(transactions).all();
    expect(
      rows.map((entry) => [entry.id, entry.company, entry.description]),
    ).toEqual([
      ["a", "stripe", null],
      ["b", null, "EPYC-01"],
      ["c", "paypal", null],
    ]);
    expect(readSyncMarks(db).syncedFrom).toBeNull();
  });
});

describe("folder dialog", () => {
  function stub(name: string, script: string): string {
    const dir = mkdtempSync(join(tmpdir(), "bookkeeping-bin-"));
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\n${script}\n`);
    chmodSync(path, 0o755);
    return dir;
  }

  async function withDialog(dir: string, run: () => Promise<void>) {
    const saved = {
      path: process.env.PATH,
      desktop: process.env.XDG_CURRENT_DESKTOP,
    };
    process.env.PATH = dir;
    process.env.XDG_CURRENT_DESKTOP = "KDE";
    try {
      await run();
    } finally {
      process.env.PATH = saved.path;
      process.env.XDG_CURRENT_DESKTOP = saved.desktop;
    }
  }

  test("returns the chosen folder", async () => {
    await withDialog(stub("kdialog", 'echo "/data/exports"'), async () => {
      expect(await chooseFolder("/tmp")).toBe("/data/exports");
    });
  });

  test("returns nothing when cancelled", async () => {
    await withDialog(stub("kdialog", "exit 1"), async () => {
      expect(await chooseFolder("/tmp")).toBeNull();
    });
  });

  test("reports a missing dialog tool", async () => {
    await withDialog(mkdtempSync(join(tmpdir(), "empty-")), async () => {
      await expect(chooseFolder("/tmp")).rejects.toThrow("Kein Ordnerdialog");
    });
  });
});
