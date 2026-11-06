import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { accountSlug, groupByAccount } from "../../shared/accounts.ts";
import type {
  BatchDto,
  DateFormat,
  DecimalFormat,
  RegeneratedExportDto,
  SettingsDto,
} from "../../shared/types.ts";
import { audit } from "../audit.ts";
import type { Db } from "../db/client.ts";
import { exportBatches, exportRows, transactions } from "../db/schema.ts";
import { baselineEnd, statusOf } from "../queries.ts";
import { resolveRow } from "../resolve.ts";
import { localDay } from "../time.ts";
import { type CsvRow, renderCsv } from "./csv.ts";

export class ExportError extends Error {}

export class FormError extends ExportError {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

function rowCount(count: number): string {
  return count === 1 ? "1 Zeile ist" : `${count} Zeilen sind`;
}

function availableName(directory: string, name: string): string {
  let candidate = name;
  let copy = 2;
  while (existsSync(join(directory, candidate))) {
    candidate = name.replace(/\.csv$/, `_${copy}.csv`);
    copy += 1;
  }
  return candidate;
}

function targetName(
  account: string,
  firstAt: number,
  lastAt: number,
  id: number,
): string {
  const number = String(id).padStart(4, "0");
  return `virtbase_${accountSlug(account)}_${localDay(firstAt)}_${localDay(lastAt)}_${number}.csv`;
}

export function createExport(
  db: Db,
  ids: string[],
  settings: SettingsDto,
  now: number,
): BatchDto[] {
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    throw new ExportError("Keine Zeilen ausgewählt.");
  }
  const rows = db
    .select()
    .from(transactions)
    .where(inArray(transactions.id, unique))
    .all();
  if (rows.length !== unique.length) {
    throw new ExportError("Einige Zeilen wurden nicht gefunden.");
  }
  const active = db
    .select({
      transactionId: exportRows.transactionId,
      batchId: exportRows.batchId,
    })
    .from(exportRows)
    .where(
      and(
        inArray(exportRows.transactionId, unique),
        eq(exportRows.active, true),
      ),
    )
    .all();
  const conflict = active[0];
  if (conflict) {
    throw new ExportError(
      `${rowCount(active.length)} bereits in Export #${conflict.batchId}.`,
    );
  }
  const baseline = baselineEnd(settings);
  const blocked = rows.filter(
    (row) => row.hidden || statusOf(row, null, baseline) !== "ready",
  );
  if (blocked.length > 0) {
    throw new ExportError(`${rowCount(blocked.length)} nicht bereit.`);
  }
  const named = rows.flatMap((row) => {
    const { name, purpose } = resolveRow(row, settings);
    const account = settings.accounts[row.source];
    return name ? [{ ...row, name, purpose, account }] : [];
  });
  if (named.length !== rows.length) {
    throw new ExportError("Einigen Zeilen fehlt der Name.");
  }

  const plans = groupByAccount(named).map((group) => {
    const sorted = [...group.rows].sort((a, b) => a.occurredAt - b.occurredAt);
    const content = renderCsv(sorted, settings);
    return {
      account: group.account,
      sorted,
      content,
      sha256: createHash("sha256").update(content).digest("hex"),
      firstAt: sorted[0]?.occurredAt ?? now,
      lastAt: sorted.at(-1)?.occurredAt ?? now,
      netCents: sorted.reduce((sum, row) => sum + row.amountCents, 0),
    };
  });

  mkdirSync(settings.exportDir, { recursive: true });
  const written: string[] = [];
  try {
    const stored = db.transaction((tx) =>
      plans.map((plan) => {
        const batch = tx
          .insert(exportBatches)
          .values({
            account: plan.account,
            createdAt: now,
            firstAt: plan.firstAt,
            lastAt: plan.lastAt,
            rowCount: plan.sorted.length,
            netCents: plan.netCents,
            fileName: "",
            filePath: "",
            sha256: plan.sha256,
          })
          .returning()
          .get();
        const fileName = availableName(
          settings.exportDir,
          targetName(plan.account, plan.firstAt, plan.lastAt, batch.id),
        );
        const filePath = join(settings.exportDir, fileName);
        tx.insert(exportRows)
          .values(
            plan.sorted.map((row) => ({
              batchId: batch.id,
              transactionId: row.id,
            })),
          )
          .run();
        for (const row of plan.sorted) {
          tx.update(transactions)
            .set({ name: row.name, purpose: row.purpose })
            .where(eq(transactions.id, row.id))
            .run();
        }
        writeFileSync(filePath, plan.content, { flag: "wx", mode: 0o600 });
        written.push(filePath);
        return tx
          .update(exportBatches)
          .set({ fileName, filePath })
          .where(eq(exportBatches.id, batch.id))
          .returning()
          .get();
      }),
    );
    for (const batch of stored) {
      audit(db, "export", {
        id: batch.id,
        account: batch.account,
        rows: batch.rowCount,
        sha256: batch.sha256,
      });
    }
    return stored;
  } catch (error) {
    for (const path of written) {
      rmSync(path, { force: true });
    }
    throw error;
  }
}

const DATE_FORMATS: DateFormat[] = ["iso", "de"];
const DECIMAL_FORMATS: DecimalFormat[] = ["dot", "comma"];

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function isUnchanged(path: string, expected: string): boolean {
  return existsSync(path) && sha256(readFileSync(path)) === expected;
}

function batchRows(db: Db, id: number): CsvRow[] {
  const ids = db
    .select({ id: exportRows.transactionId })
    .from(exportRows)
    .where(eq(exportRows.batchId, id))
    .all()
    .map((row) => row.id);
  return db
    .select()
    .from(transactions)
    .where(inArray(transactions.id, ids))
    .all()
    .map((row) => ({ ...row, name: row.name ?? "" }))
    .sort((a, b) => a.occurredAt - b.occurredAt);
}

function originalContent(rows: CsvRow[], expected: string): string | undefined {
  return DATE_FORMATS.flatMap((dateFormat) =>
    DECIMAL_FORMATS.map((decimalFormat) =>
      renderCsv(rows, { dateFormat, decimalFormat }),
    ),
  ).find((content) => sha256(content) === expected);
}

export function regenerateExport(
  db: Db,
  id: number,
  settings: SettingsDto,
): RegeneratedExportDto {
  const batch = db
    .select()
    .from(exportBatches)
    .where(eq(exportBatches.id, id))
    .get();
  if (!batch) {
    throw new ExportError("Export nicht gefunden.");
  }
  if (batch.status === "void") {
    throw new ExportError(
      "Ein stornierter Export lässt sich nicht erneut erzeugen.",
    );
  }
  if (isUnchanged(batch.filePath, batch.sha256)) {
    return { fileName: batch.fileName, existed: true, identical: true };
  }
  const rows = batchRows(db, id);
  const original = originalContent(rows, batch.sha256);
  const content = original ?? renderCsv(rows, settings);
  const originalMissing = !existsSync(batch.filePath);
  let fileName: string;
  try {
    mkdirSync(settings.exportDir, { recursive: true });
    fileName = availableName(settings.exportDir, batch.fileName);
    writeFileSync(join(settings.exportDir, fileName), content, {
      flag: "wx",
      mode: 0o600,
    });
  } catch {
    throw new ExportError(
      "Der Exportordner ist nicht beschreibbar. Bitte prüfe ihn in den Einstellungen.",
    );
  }
  if (originalMissing) {
    db.update(exportBatches)
      .set({ fileName, filePath: join(settings.exportDir, fileName) })
      .where(eq(exportBatches.id, id))
      .run();
  }
  const identical = original !== undefined;
  audit(db, "export.regenerate", { id, file: fileName, identical });
  return { fileName, existed: false, identical };
}

export function voidExport(db: Db, id: number): void {
  db.transaction((tx) => {
    const updated = tx
      .update(exportBatches)
      .set({ status: "void" })
      .where(eq(exportBatches.id, id))
      .returning()
      .get();
    if (!updated) {
      throw new ExportError("Export nicht gefunden.");
    }
    tx.update(exportRows)
      .set({ active: false })
      .where(eq(exportRows.batchId, id))
      .run();
  });
  audit(db, "export.void", { id });
}

export function markImported(db: Db, id: number): void {
  const updated = db
    .update(exportBatches)
    .set({ status: "imported" })
    .where(and(eq(exportBatches.id, id), eq(exportBatches.status, "pending")))
    .returning()
    .get();
  if (!updated) {
    throw new ExportError("Export nicht gefunden.");
  }
  audit(db, "export.imported", { id });
}
