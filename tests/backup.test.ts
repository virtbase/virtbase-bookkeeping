import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BackupService,
  backupName,
  backupsToRemove,
  backupTime,
} from "../src/server/backup.ts";
import { openDatabase } from "../src/server/db/client.ts";
import { auditEvents, transactions } from "../src/server/db/schema.ts";
import { readSettings, writeSettings } from "../src/server/settings.ts";

const DAY = 86400;
const NOW = Date.parse("2026-11-06T12:00:00Z") / 1000;

const entry = {
  id: "a",
  source: "stripe" as const,
  kind: "charge",
  occurredAt: NOW,
  valueAt: NOW,
  name: "Anna",
  purpose: "EPYC-01",
  amountCents: 399,
  createdAt: NOW,
};

function setup() {
  const home = mkdtempSync(join(tmpdir(), "bookkeeping-"));
  const database = join(home, "bookkeeping.sqlite");
  const db = openDatabase(database);
  const clock = { now: NOW };
  const paths = {
    home,
    database,
    secrets: join(home, "secrets.json"),
    defaultExportDir: join(home, "exports"),
  };
  const backups = new BackupService(
    db,
    paths,
    () => readSettings(db, paths.defaultExportDir),
    () => clock.now,
  );
  const folder = join(home, "backups");
  const files = () => (existsSync(folder) ? readdirSync(folder).sort() : []);
  return { home, db, clock, backups, folder, files, paths };
}

describe("backup names", () => {
  test("carry their time", () => {
    const name = backupName(NOW);
    expect(name).toBe("bookkeeping-2026-11-06T120000Z.sqlite");
    expect(backupTime(name)).toBe(NOW);
  });

  test("ignore foreign files", () => {
    expect(backupTime("notes.sqlite")).toBeNull();
    expect(backupTime("bookkeeping.sqlite.reset-2026.bak")).toBeNull();
  });
});

describe("backupsToRemove", () => {
  const daysAgo = (days: number, hour = 0) =>
    backupName(NOW - days * DAY - hour * 3600);

  test("keeps the newest copies of a busy day", () => {
    const names = Array.from({ length: 12 }, (_, hour) => daysAgo(0, hour));
    expect(backupsToRemove(names, NOW)).toEqual(names.slice(10));
  });

  test("keeps one copy per day for two weeks", () => {
    const names = Array.from({ length: 10 }, (_, days) => daysAgo(days));
    expect(backupsToRemove(names, NOW)).toEqual([]);
  });

  test("keeps only the newest copy of older months", () => {
    const names = [
      backupName(Date.parse("2026-08-28T10:00:00Z") / 1000),
      backupName(Date.parse("2026-08-20T10:00:00Z") / 1000),
      backupName(Date.parse("2026-08-02T10:00:00Z") / 1000),
    ];
    const recent = Array.from({ length: 10 }, (_, days) => daysAgo(days));
    expect(backupsToRemove([...names, ...recent], NOW)).toEqual(names.slice(1));
  });

  test("keeps monthly copies forever", () => {
    const names = Array.from({ length: 60 }, (_, month) =>
      backupName(Date.UTC(2020, month, 15) / 1000),
    );
    expect(backupsToRemove(names, NOW)).toEqual([]);
  });

  test("never removes foreign files", () => {
    expect(backupsToRemove(["notes.txt", "my.sqlite"], NOW)).toEqual([]);
  });
});

describe("BackupService", () => {
  test("writes a complete private copy", () => {
    const { db, backups, folder, files } = setup();
    db.insert(transactions).values(entry).run();
    backups.create();
    const [file = ""] = files();
    expect(files()).toHaveLength(1);
    expect(statSync(join(folder, file)).mode & 0o777).toBe(0o600);
    expect(statSync(folder).mode & 0o777).toBe(0o700);
    const copy = new Database(join(folder, file), { readonly: true });
    expect(copy.query("SELECT id FROM transactions").all()).toEqual([
      { id: "a" },
    ]);
    copy.close();
  });

  test("restores into a working database with newer rows gone", () => {
    const { db, backups, folder, files } = setup();
    db.insert(transactions).values(entry).run();
    backups.create();
    db.insert(transactions)
      .values({ ...entry, id: "b" })
      .run();
    const restored = openDatabase(join(folder, files()[0] ?? ""));
    expect(
      restored
        .select()
        .from(transactions)
        .all()
        .map((row) => row.id),
    ).toEqual(["a"]);
  });

  test("runs when no backup exists", () => {
    const { backups, files } = setup();
    backups.runIfDue();
    expect(files()).toHaveLength(1);
  });

  test("does nothing when nothing changed today", () => {
    const { clock, backups, files } = setup();
    backups.runIfDue();
    clock.now += 3600;
    backups.runIfDue();
    expect(files()).toHaveLength(1);
  });

  test("backs up after a change", () => {
    const { db, clock, backups, files } = setup();
    backups.runIfDue();
    clock.now += 3600;
    db.insert(transactions).values(entry).run();
    backups.runIfDue();
    expect(files()).toHaveLength(2);
  });

  test("backs up once a day without changes", () => {
    const { clock, backups, files } = setup();
    backups.runIfDue();
    clock.now += DAY;
    backups.runIfDue();
    expect(files()).toHaveLength(2);
  });

  test("logs each backup", () => {
    const { db, backups } = setup();
    backups.create();
    const events = db.select().from(auditEvents).all();
    expect(events.map((event) => event.type)).toEqual(["backup"]);
  });

  test("uses the chosen folder", () => {
    const { db, backups, home, paths, files } = setup();
    const chosen = mkdtempSync(join(home, "nas-"));
    writeSettings(db, {
      ...readSettings(db, paths.defaultExportDir),
      backupDir: chosen,
    });
    backups.create();
    expect(readdirSync(chosen)).toHaveLength(1);
    expect(files()).toEqual([]);
  });

  test("does not create a missing custom folder", () => {
    const { db, backups, home, paths } = setup();
    const missing = join(home, "unmounted", "nas");
    writeSettings(db, {
      ...readSettings(db, paths.defaultExportDir),
      backupDir: missing,
    });
    expect(() => backups.create()).toThrow("ist fehlgeschlagen");
    expect(existsSync(missing)).toBe(false);
  });

  test("reports a failure and keeps the app running", () => {
    const { db, backups, home, paths } = setup();
    writeSettings(db, {
      ...readSettings(db, paths.defaultExportDir),
      backupDir: join(home, "missing"),
    });
    expect(() => backups.runIfDue()).not.toThrow();
    expect(backups.status().error).toContain("ist fehlgeschlagen");
  });

  test("logs a repeating failure once and clears it after success", () => {
    const { db, backups, home, paths } = setup();
    const settings = readSettings(db, paths.defaultExportDir);
    writeSettings(db, { ...settings, backupDir: join(home, "missing") });
    backups.runIfDue();
    backups.runIfDue();
    const failed = () =>
      db
        .select()
        .from(auditEvents)
        .all()
        .filter((event) => event.type === "backup.failed");
    expect(failed()).toHaveLength(1);
    writeSettings(db, settings);
    backups.create();
    expect(backups.error).toBeNull();
  });

  test("leaves no draft behind", () => {
    const { db, backups, home, paths } = setup();
    const folder = mkdtempSync(join(home, "ro-"));
    writeFileSync(join(folder, `${backupName(NOW)}.tmp`), "stale");
    writeSettings(db, {
      ...readSettings(db, paths.defaultExportDir),
      backupDir: folder,
    });
    backups.create();
    expect(readdirSync(folder)).toEqual([backupName(NOW)]);
  });

  test("keeps foreign files in the folder", () => {
    const { clock, backups, folder } = setup();
    backups.create();
    writeFileSync(join(folder, "notes.txt"), "keep");
    for (let day = 1; day < 40; day += 1) {
      clock.now += DAY;
      backups.create();
    }
    expect(existsSync(join(folder, "notes.txt"))).toBe(true);
    expect(readdirSync(folder).length).toBeLessThan(20);
  });

  test("rejects a read-only folder", () => {
    const { db, backups, home, paths } = setup();
    const folder = mkdtempSync(join(home, "ro-"));
    chmodSync(folder, 0o500);
    writeSettings(db, {
      ...readSettings(db, paths.defaultExportDir),
      backupDir: folder,
    });
    expect(() => backups.create()).toThrow("ist fehlgeschlagen");
    chmodSync(folder, 0o700);
    rmSync(folder, { recursive: true });
  });
});
