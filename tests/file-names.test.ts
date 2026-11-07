import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/server/db/client.ts";
import {
  auditEvents,
  exportBatches,
  transactions,
} from "../src/server/db/schema.ts";
import { fileNameStatus, renameExports } from "../src/server/export/rename.ts";
import {
  createExport,
  ExportError,
  regenerateExport,
} from "../src/server/export/service.ts";
import { readSettings } from "../src/server/settings.ts";
import {
  DEFAULT_FILE_NAME_TEMPLATE,
  FILE_NAME_SAMPLE,
  fileNameProblem,
  renderFileName,
} from "../src/shared/file-name.ts";
import { fileNameSchema } from "../src/shared/schemas.ts";

const NOW = 1793900000;
const locked: string[] = [];

afterEach(() => {
  for (const dir of locked.splice(0)) {
    chmodSync(dir, 0o755);
  }
});

function setup() {
  const exportDir = mkdtempSync(join(tmpdir(), "bookkeeping-"));
  const db = openDatabase(":memory:");
  const settings = readSettings(db, exportDir);
  const row = {
    source: "stripe" as const,
    kind: "charge",
    occurredAt: NOW,
    valueAt: NOW,
    purpose: "EPYC-01",
    name: "Anna",
    amountCents: 399,
    createdAt: NOW,
  };
  db.insert(transactions)
    .values(["a", "b", "c"].map((id) => ({ ...row, id })))
    .run();
  const batches = ["a", "b", "c"].map((id) => {
    const [batch] = createExport(db, [id], settings, NOW);
    if (!batch) {
      throw new Error("no batch");
    }
    return batch;
  });
  const stored = () =>
    db.select().from(exportBatches).orderBy(exportBatches.id).all();
  return { db, settings, batches, exportDir, stored };
}

const files = (dir: string) => readdirSync(dir).sort();

describe("file name template", () => {
  test("renders the default as number, account and period", () => {
    expect(renderFileName(DEFAULT_FILE_NAME_TEMPLATE, FILE_NAME_SAMPLE)).toBe(
      "0012 Stripe 01.10.2026 bis 31.10.2026.csv",
    );
  });

  test("cleans values that would break a file name", () => {
    const name = renderFileName("{nummer}  {konto}.", {
      nummer: "0001",
      konto: 'Bank/Kasse: "Ä"\t?',
    });
    expect(name).toBe("0001 Bank-Kasse- -Ä---.csv");
    expect(renderFileName(".{nummer}", { nummer: "0001" })).toBe("0001.csv");
  });

  test("keeps names within the file system limit", () => {
    const name = renderFileName("{nummer} {konto}", {
      nummer: "0001",
      konto: "ü".repeat(300),
    });
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(204);
    expect(name.endsWith("ü.csv")).toBe(true);
  });

  test("requires the number and known placeholders", () => {
    expect(fileNameProblem(DEFAULT_FILE_NAME_TEMPLATE)).toBeNull();
    expect(fileNameProblem("{konto}")).toContain("{nummer}");
    expect(fileNameProblem("{nummer} {monat}")).toContain("{monat}");
    expect(fileNameProblem("{nummer} a:b")).toContain("nicht erlaubt");
    expect(fileNameSchema.safeParse({ template: "{nummer}" }).success).toBe(
      true,
    );
  });
});

describe("renaming exports", () => {
  test("new exports use the template", () => {
    const { batches, exportDir } = setup();
    expect(batches.map((batch) => batch.fileName)).toEqual([
      "0001 Stripe 05.11.2026.csv",
      "0002 Stripe 05.11.2026.csv",
      "0003 Stripe 05.11.2026.csv",
    ]);
    expect(files(exportDir)).toHaveLength(3);
  });

  test("renames every file and keeps its content", () => {
    const { db, exportDir, batches, stored } = setup();
    const content = readFileSync(batches[1]?.filePath ?? "", "utf8");
    expect(fileNameStatus(db, "Export {nummer}", exportDir)).toEqual({
      pending: 3,
      example: { from: "0003 Stripe 05.11.2026.csv", to: "Export 0003.csv" },
    });

    expect(renameExports(db, "Export {nummer}", exportDir)).toEqual({
      renamed: 3,
      missing: 0,
    });
    expect(files(exportDir)).toEqual([
      "Export 0001.csv",
      "Export 0002.csv",
      "Export 0003.csv",
    ]);
    expect(readFileSync(join(exportDir, "Export 0002.csv"), "utf8")).toBe(
      content,
    );
    expect(stored().map((batch) => batch.filePath)).toEqual(
      files(exportDir).map((name) => join(exportDir, name)),
    );
    expect(fileNameStatus(db, "Export {nummer}", exportDir).pending).toBe(0);
    const events = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.type, "export.rename"))
      .all();
    expect(events).toHaveLength(1);
  });

  test("handles a change in case only", () => {
    const { db, exportDir } = setup();
    renameExports(db, "{nummer} stripe", exportDir);
    renameExports(db, "{nummer} STRIPE", exportDir);
    expect(files(exportDir)).toEqual([
      "0001 STRIPE.csv",
      "0002 STRIPE.csv",
      "0003 STRIPE.csv",
    ]);
  });

  test("renames missing files in the database only", () => {
    const { db, settings, exportDir, batches, stored } = setup();
    rmSync(batches[1]?.filePath ?? "");
    expect(renameExports(db, "{nummer}", exportDir)).toEqual({
      renamed: 2,
      missing: 1,
    });
    expect(stored()[1]?.fileName).toBe("0002.csv");
    const result = regenerateExport(db, batches[1]?.id ?? 0, {
      ...settings,
      fileNameTemplate: "{nummer}",
    });
    expect(result.fileName).toBe("0002.csv");
    expect(files(exportDir)).toEqual(["0001.csv", "0002.csv", "0003.csv"]);
  });

  test("keeps files where they are", () => {
    const { db, exportDir, batches, stored } = setup();
    const moved = join(exportDir, "alt");
    mkdirSync(moved);
    const first = batches[0];
    renameSync(first?.filePath ?? "", join(moved, first?.fileName ?? ""));
    db.update(exportBatches)
      .set({ filePath: join(moved, first?.fileName ?? "") })
      .where(eq(exportBatches.id, first?.id ?? 0))
      .run();
    renameExports(db, "{nummer}", exportDir);
    expect(stored()[0]?.filePath).toBe(join(moved, "0001.csv"));
    expect(existsSync(join(moved, "0001.csv"))).toBe(true);
  });

  test("changes nothing when a foreign file is in the way", () => {
    const { db, exportDir, stored } = setup();
    writeFileSync(join(exportDir, "0002.csv"), "fremd");
    const before = files(exportDir);
    expect(() => renameExports(db, "{nummer}", exportDir)).toThrow(
      "0002.csv gibt es schon",
    );
    expect(files(exportDir)).toEqual(before);
    expect(stored()[0]?.fileName).toBe("0001 Stripe 05.11.2026.csv");
  });

  test("puts every file back when a rename fails midway", () => {
    const { db, exportDir, batches } = setup();
    const readOnly = join(exportDir, "gesperrt");
    mkdirSync(readOnly);
    const last = batches[2];
    const target = join(readOnly, last?.fileName ?? "");
    renameSync(last?.filePath ?? "", target);
    db.update(exportBatches)
      .set({ filePath: target })
      .where(eq(exportBatches.id, last?.id ?? 0))
      .run();
    chmodSync(readOnly, 0o555);
    locked.push(readOnly);
    const before = files(exportDir);

    expect(() => renameExports(db, "{nummer}", exportDir)).toThrow(ExportError);
    expect(files(exportDir)).toEqual(before);
    expect(files(readOnly)).toEqual([last?.fileName ?? ""]);
  });
});
