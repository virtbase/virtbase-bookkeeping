import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/server/db/client.ts";
import { auditEvents, transactions } from "../src/server/db/schema.ts";
import {
  createExport,
  regenerateExport,
  voidExport,
} from "../src/server/export/service.ts";
import { openFeeMonths } from "../src/server/fees.ts";
import { listExports } from "../src/server/queries.ts";
import { readSettings } from "../src/server/settings.ts";
import type { SettingsDto, TransactionStatus } from "../src/shared/types.ts";

const NOW = 1793900000;

function setup(overrides: Partial<SettingsDto> = {}) {
  const exportDir = mkdtempSync(join(tmpdir(), "bookkeeping-"));
  const db = openDatabase(":memory:");
  const settings: SettingsDto = {
    ...readSettings(db, exportDir),
    ...overrides,
  };
  const row = {
    source: "stripe" as const,
    kind: "charge",
    valueAt: NOW,
    purpose: "EPYC-01",
    createdAt: NOW,
  };
  db.insert(transactions)
    .values([
      { ...row, id: "b", occurredAt: NOW + 60, name: "Bea", amountCents: 799 },
      { ...row, id: "a", occurredAt: NOW, name: "Anna", amountCents: 399 },
      { ...row, id: "c", occurredAt: NOW, name: "Carl", amountCents: 1250 },
    ])
    .run();
  const [batch] = createExport(db, ["a", "b", "c"], settings, NOW);
  if (!batch) {
    throw new Error("no batch");
  }
  const original = readFileSync(batch.filePath);
  return { db, settings, batch, original, exportDir };
}

describe("regenerateExport", () => {
  test("rebuilds a lost file byte for byte", () => {
    const { db, settings, batch, original } = setup();
    rmSync(batch.filePath);
    expect(regenerateExport(db, batch.id, settings)).toEqual({
      fileName: batch.fileName,
      existed: false,
      identical: true,
    });
    expect(readFileSync(batch.filePath).equals(original)).toBe(true);
    expect(createHash("sha256").update(original).digest("hex")).toBe(
      batch.sha256,
    );
  });

  test("finds the old format after the settings changed", () => {
    const { db, settings, batch, original } = setup({
      dateFormat: "de",
      decimalFormat: "comma",
    });
    rmSync(batch.filePath);
    const later: SettingsDto = {
      ...settings,
      dateFormat: "iso",
      decimalFormat: "dot",
    };
    expect(regenerateExport(db, batch.id, later).identical).toBe(true);
    expect(readFileSync(batch.filePath).equals(original)).toBe(true);
  });

  test("leaves an unchanged file alone", () => {
    const { db, settings, batch, exportDir } = setup();
    expect(regenerateExport(db, batch.id, settings)).toEqual({
      fileName: batch.fileName,
      existed: true,
      identical: true,
    });
    expect(readdirSync(exportDir)).toHaveLength(1);
  });

  test("never overwrites a changed file", () => {
    const { db, settings, batch, exportDir } = setup();
    writeFileSync(batch.filePath, "von Hand geändert");
    const result = regenerateExport(db, batch.id, settings);
    expect(result.existed).toBe(false);
    expect(result.fileName).not.toBe(batch.fileName);
    expect(readFileSync(batch.filePath, "utf8")).toBe("von Hand geändert");
    expect(readdirSync(exportDir)).toHaveLength(2);
  });

  test("points the export at the new folder after a move", () => {
    const { db, settings, batch } = setup();
    rmSync(batch.filePath);
    const moved = mkdtempSync(join(tmpdir(), "bookkeeping-"));
    regenerateExport(db, batch.id, { ...settings, exportDir: moved });
    const stored = listExports(db, settings).batches[0];
    expect(stored?.filePath).toBe(join(moved, batch.fileName));
    expect(existsSync(join(moved, batch.fileName))).toBe(true);
  });

  test("warns when the data no longer matches", () => {
    const { db, settings, batch } = setup();
    rmSync(batch.filePath);
    db.update(transactions).set({ amountCents: 1 }).run();
    expect(regenerateExport(db, batch.id, settings).identical).toBe(false);
  });

  test("refuses a voided export", () => {
    const { db, settings, batch } = setup();
    rmSync(batch.filePath);
    voidExport(db, batch.id);
    expect(() => regenerateExport(db, batch.id, settings)).toThrow(
      "stornierter Export",
    );
    expect(existsSync(batch.filePath)).toBe(false);
  });

  test("reports a missing export", () => {
    const { db, settings } = setup();
    expect(() => regenerateExport(db, 99, settings)).toThrow("nicht gefunden");
  });

  test("reports a folder it cannot write to", () => {
    const { db, settings, batch } = setup();
    rmSync(batch.filePath);
    const blocked = join(batch.filePath, "kein-ordner");
    writeFileSync(batch.filePath, "x");
    expect(() =>
      regenerateExport(db, batch.id, { ...settings, exportDir: blocked }),
    ).toThrow("nicht beschreibbar");
  });

  test("logs the new file", () => {
    const { db, settings, batch } = setup();
    rmSync(batch.filePath);
    regenerateExport(db, batch.id, settings);
    const types = db
      .select()
      .from(auditEvents)
      .all()
      .map((event) => event.type);
    expect(types).toContain("export.regenerate");
  });
});

describe("openFeeMonths", () => {
  const fee = (
    month: string,
    kind: string,
    amountCents: number,
    status: TransactionStatus = "ready",
  ) =>
    ({
      id: `fee:${month}:${kind}`,
      source: "fees",
      status,
      amountCents,
    }) as const;

  test("adds Stripe and PayPal per month", () => {
    expect(
      openFeeMonths([
        fee("2026-10", "stripe", -1960),
        fee("2026-10", "paypal", -846),
      ]),
    ).toEqual([{ month: "2026-10", feeCents: 2806 }]);
  });

  test("sorts the oldest month first", () => {
    const months = openFeeMonths([
      fee("2026-10", "stripe", -1),
      fee("2026-09", "stripe", -1),
    ]);
    expect(months.map((entry) => entry.month)).toEqual(["2026-09", "2026-10"]);
  });

  test("forgets exported and hidden months", () => {
    expect(
      openFeeMonths([
        fee("2026-09", "stripe", -1, "exported"),
        fee("2026-10", "stripe", -1, "ignored"),
      ]),
    ).toEqual([]);
  });

  test("ignores everything else", () => {
    expect(
      openFeeMonths([
        { id: "txn_1", source: "stripe", status: "ready", amountCents: 500 },
      ]),
    ).toEqual([]);
  });
});
