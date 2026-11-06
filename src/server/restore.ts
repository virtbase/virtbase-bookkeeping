import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RestoreResultDto } from "../shared/types.ts";
import { audit } from "./audit.ts";
import { assertBackupFolder, assertIntact } from "./backup.ts";
import type { Db } from "./db/client.ts";
import { openDatabase } from "./db/client.ts";
import { MIGRATIONS } from "./db/migrations.ts";
import { ExportError } from "./export/service.ts";
import type { Paths } from "./paths.ts";
import {
  clearRestoredState,
  isSetupComplete,
  markRestored,
  readPreferences,
  readSettings,
  writePreferences,
  writeSettings,
} from "./settings.ts";

const SQLITE_HEADER = "SQLite format 3\0";
const REQUIRED_TABLES = ["transactions", "settings", "export_batches"];
const NOT_A_BACKUP = "Diese Datei ist keine gültige Sicherung.";

function count(sqlite: Database, table: string): number {
  const row = sqlite.query(`SELECT count(*) AS total FROM ${table}`).get() as {
    total: number;
  };
  return row.total;
}

function tables(sqlite: Database): string[] {
  const rows = sqlite
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

function assertBackup(path: string): void {
  let copy: Database;
  try {
    assertIntact(path);
    copy = new Database(path, { readonly: true });
  } catch {
    throw new ExportError(NOT_A_BACKUP);
  }
  try {
    const { user_version: version } = copy
      .query("PRAGMA user_version")
      .get() as { user_version: number };
    const known = tables(copy);
    if (
      version < 1 ||
      !REQUIRED_TABLES.every((table) => known.includes(table))
    ) {
      throw new ExportError(NOT_A_BACKUP);
    }
    if (version > MIGRATIONS.length) {
      throw new ExportError(
        "Diese Sicherung stammt aus einer neueren Version. Bitte aktualisiere die App zuerst.",
      );
    }
  } finally {
    copy.close();
  }
}

function copyTables(db: Db, path: string): void {
  const sqlite = db.$client;
  sqlite.query("ATTACH DATABASE ?1 AS restored").run(path);
  try {
    sqlite.transaction(() => {
      sqlite.run("PRAGMA defer_foreign_keys = ON");
      for (const table of tables(sqlite)) {
        const columns = (
          sqlite.query(`PRAGMA table_info(${table})`).all() as {
            name: string;
          }[]
        )
          .map((column) => `"${column.name}"`)
          .join(", ");
        sqlite.run(`DELETE FROM main.${table}`);
        sqlite.run(
          `INSERT INTO main.${table} (${columns}) SELECT ${columns} FROM restored.${table}`,
        );
      }
    })();
  } finally {
    sqlite.run("DETACH DATABASE restored");
  }
}

function adoptRestoredData(db: Db, paths: Paths, now: number): void {
  clearRestoredState(db);
  markRestored(db, now);
  writePreferences(db, { ...readPreferences(db), tourPending: false });
  const settings = readSettings(db, paths.defaultExportDir);
  try {
    if (settings.backupDir) {
      assertBackupFolder(settings.backupDir);
    }
  } catch {
    writeSettings(db, { ...settings, backupDir: "" });
  }
}

export function restoreBackup(
  db: Db,
  paths: Paths,
  file: Uint8Array,
  now: number,
): RestoreResultDto {
  if (isSetupComplete(db)) {
    throw new ExportError(
      "Eine Sicherung lässt sich nur während der Einrichtung laden.",
    );
  }
  const header = new TextDecoder().decode(file.slice(0, SQLITE_HEADER.length));
  if (header !== SQLITE_HEADER) {
    throw new ExportError(NOT_A_BACKUP);
  }
  const folder = mkdtempSync(join(paths.home, "restore-"));
  try {
    const path = join(folder, "backup.sqlite");
    writeFileSync(path, file, { mode: 0o600 });
    assertBackup(path);
    openDatabase(path).$client.close();
    copyTables(db, path);
    adoptRestoredData(db, paths, now);
    const result: RestoreResultDto = {
      transactions: count(db.$client, "transactions"),
      exports: count(db.$client, "export_batches"),
    };
    audit(db, "backup.restore", { rows: result.transactions });
    return result;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
