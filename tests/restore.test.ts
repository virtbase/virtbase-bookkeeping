import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/server/db/client.ts";
import { MIGRATIONS } from "../src/server/db/migrations.ts";
import {
  exportBatches,
  exportRows,
  transactions,
} from "../src/server/db/schema.ts";
import { MoneroSync } from "../src/server/monero/sync.ts";
import { restoreBackup } from "../src/server/restore.ts";
import {
  isSetupComplete,
  markSetupComplete,
  readMoneroMarks,
  readPreferences,
  readSettings,
  wasRestored,
  writeMoneroMarks,
  writePreferences,
  writeSettings,
} from "../src/server/settings.ts";

const NOW = 1793900000;
const row = {
  source: "stripe" as const,
  kind: "charge",
  occurredAt: NOW,
  valueAt: NOW,
  purpose: "EPYC-01",
  amountCents: 399,
  createdAt: NOW,
};

function target() {
  const home = mkdtempSync(join(tmpdir(), "bookkeeping-"));
  const database = join(home, "bookkeeping.sqlite");
  const paths = {
    home,
    database,
    secrets: join(home, "secrets.json"),
    defaultExportDir: join(home, "exports"),
  };
  return { db: openDatabase(database), paths, home };
}

function backupFile(
  prepare?: (source: ReturnType<typeof openDatabase>) => void,
) {
  const home = mkdtempSync(join(tmpdir(), "bookkeeping-"));
  const source = openDatabase(join(home, "live.sqlite"));
  source
    .insert(transactions)
    .values([
      { ...row, id: "a", name: "Anna" },
      { ...row, id: "b" },
    ])
    .run();
  prepare?.(source);
  const file = join(home, "copy.sqlite");
  source.$client.run(`VACUUM INTO '${file}'`);
  return new Uint8Array(readFileSync(file));
}

const empty = (home: string) =>
  readdirSync(home).filter((name) => name.startsWith("restore-"));

describe("restoreBackup", () => {
  test("brings back rows and reports them", () => {
    const { db, paths } = target();
    expect(restoreBackup(db, paths, backupFile(), NOW)).toEqual({
      transactions: 2,
      exports: 0,
    });
    const names = db.select().from(transactions).all();
    expect(names.map((entry) => entry.id).sort()).toEqual(["a", "b"]);
  });

  test("keeps exports linked to their rows", () => {
    const { db, paths } = target();
    const file = backupFile((source) => {
      const batch = source
        .insert(exportBatches)
        .values({
          createdAt: NOW,
          firstAt: NOW,
          lastAt: NOW,
          fileName: "a.csv",
          filePath: "/tmp/a.csv",
          sha256: "x",
          rowCount: 1,
          netCents: 399,
          status: "pending",
        })
        .returning()
        .get();
      source
        .insert(exportRows)
        .values({
          batchId: batch.id,
          transactionId: "a",
          active: true,
        })
        .run();
    });
    expect(restoreBackup(db, paths, file, NOW).exports).toBe(1);
    expect(db.select().from(exportRows).all()).toHaveLength(1);
    expect(db.$client.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("keeps settings for the wizard to show", () => {
    const { db, paths } = target();
    const file = backupFile((source) => {
      writeSettings(source, {
        ...readSettings(source, "/old/exports"),
        baselineDate: "2026-10-31T23:59",
        feesClosedThrough: "2026-09",
      });
    });
    restoreBackup(db, paths, file, NOW);
    const settings = readSettings(db, paths.defaultExportDir);
    expect(settings.baselineDate).toBe("2026-10-31T23:59");
    expect(settings.feesClosedThrough).toBe("2026-09");
  });

  test("keeps the wizard open so the keys can be entered", () => {
    const { db, paths } = target();
    const file = backupFile((source) => markSetupComplete(source, NOW));
    restoreBackup(db, paths, file, NOW);
    expect(isSetupComplete(db)).toBe(false);
    expect(wasRestored(db)).toBe(true);
  });

  test("forgets the wallet because its view key is not in the backup", () => {
    const { db, paths } = target();
    const file = backupFile((source) => {
      writeMoneroMarks(source, {
        address: "4abc",
        restoreHeight: 1,
        lastSyncAt: NOW,
      });
    });
    restoreBackup(db, paths, file, NOW);
    expect(readMoneroMarks(db).address).toBeNull();
    expect(new MoneroSync(db, {} as never, "/tmp").status().configured).toBe(
      false,
    );
  });

  test("drops a backup folder that does not exist here", () => {
    const { db, paths } = target();
    const file = backupFile((source) => {
      writeSettings(source, {
        ...readSettings(source, "/old/exports"),
        backupDir: "/mnt/old-nas/backups",
      });
    });
    restoreBackup(db, paths, file, NOW);
    expect(readSettings(db, paths.defaultExportDir).backupDir).toBe("");
  });

  test("does not start the tutorial for a restored install", () => {
    const { db, paths } = target();
    const file = backupFile((source) => {
      writePreferences(source, {
        theme: "dark",
        privacy: true,
        tourPending: true,
        singleKeyShortcuts: false,
      });
    });
    restoreBackup(db, paths, file, NOW);
    expect(readPreferences(db)).toEqual({
      theme: "dark",
      privacy: true,
      tourPending: false,
      singleKeyShortcuts: false,
    });
  });

  test("upgrades an older backup", () => {
    const { db, paths } = target();
    const home = mkdtempSync(join(tmpdir(), "bookkeeping-"));
    const file = join(home, "old.sqlite");
    const old = new Database(file);
    for (const statement of MIGRATIONS.slice(0, 2)) {
      old.run(statement);
    }
    old.run("PRAGMA user_version = 2");
    old.run(
      `INSERT INTO transactions (id, source, kind, occurred_at, value_at, purpose, amount_cents, created_at)
       VALUES ('old', 'stripe', 'charge', 1, 1, 'x', 1, 1)`,
    );
    old.close();
    const result = restoreBackup(
      db,
      paths,
      new Uint8Array(readFileSync(file)),
      NOW,
    );
    expect(result.transactions).toBe(1);
  });

  test("replaces what a retry left behind", () => {
    const { db, paths } = target();
    restoreBackup(db, paths, backupFile(), NOW);
    db.insert(transactions)
      .values({ ...row, id: "stale" })
      .run();
    expect(restoreBackup(db, paths, backupFile(), NOW).transactions).toBe(2);
  });

  test("cleans up its temporary files", () => {
    const { db, paths, home } = target();
    restoreBackup(db, paths, backupFile(), NOW);
    expect(empty(home)).toEqual([]);
  });
});

describe("rejected files", () => {
  test("refuses to run on a finished install", () => {
    const { db, paths } = target();
    db.insert(transactions)
      .values({ ...row, id: "live" })
      .run();
    markSetupComplete(db, NOW);
    expect(() => restoreBackup(db, paths, backupFile(), NOW)).toThrow(
      "nur während der Einrichtung",
    );
    expect(db.select().from(transactions).all()).toHaveLength(1);
  });

  test("refuses a file that is no database", () => {
    const { db, paths, home } = target();
    const file = new TextEncoder().encode("Datum;Betrag\n1;2\n");
    expect(() => restoreBackup(db, paths, file, NOW)).toThrow(
      "keine gültige Sicherung",
    );
    expect(empty(home)).toEqual([]);
  });

  test("refuses a cut off database", () => {
    const { db, paths } = target();
    const file = backupFile().slice(0, 9000);
    expect(() => restoreBackup(db, paths, file, NOW)).toThrow(
      "keine gültige Sicherung",
    );
  });

  test("refuses a database from another app", () => {
    const { db, paths } = target();
    const home = mkdtempSync(join(tmpdir(), "bookkeeping-"));
    const file = join(home, "other.sqlite");
    const other = new Database(file);
    other.run("CREATE TABLE notes (id INTEGER)");
    other.run("PRAGMA user_version = 3");
    other.close();
    expect(() =>
      restoreBackup(db, paths, new Uint8Array(readFileSync(file)), NOW),
    ).toThrow("keine gültige Sicherung");
    expect(existsSync(file)).toBe(true);
  });

  test("refuses a backup from a newer version", () => {
    const { db, paths } = target();
    const file = backupFile((source) => {
      source.$client.run(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    });
    expect(() => restoreBackup(db, paths, file, NOW)).toThrow(
      "neueren Version",
    );
  });
});
