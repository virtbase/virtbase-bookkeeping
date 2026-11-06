import { Database } from "bun:sqlite";
import {
  accessSync,
  chmodSync,
  constants,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import type { BackupStatusDto, SettingsDto } from "../shared/types.ts";
import { audit } from "./audit.ts";
import type { Db } from "./db/client.ts";
import { ExportError } from "./export/service.ts";
import type { Paths } from "./paths.ts";
import { localDay } from "./time.ts";

const FILE_NAME =
  /^bookkeeping-(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})Z\.sqlite$/;
const DAY_SECONDS = 86400;
const KEEP_NEWEST = 10;
const KEEP_DAILY_DAYS = 14;

export function backupName(at: number): string {
  const stamp = new Date(at * 1000).toISOString().slice(0, 19);
  return `bookkeeping-${stamp.replaceAll(":", "")}Z.sqlite`;
}

export function backupTime(name: string): number | null {
  const match = FILE_NAME.exec(name);
  if (!match) {
    return null;
  }
  const [year, month, day, hour, minute, second] = match
    .slice(1)
    .map(Number) as [number, number, number, number, number, number];
  return Date.UTC(year, month - 1, day, hour, minute, second) / 1000;
}

export function backupsToRemove(names: string[], now: number): string[] {
  const dated = names
    .flatMap((name) => {
      const at = backupTime(name);
      return at === null ? [] : [{ name, at }];
    })
    .sort((a, b) => b.at - a.at);
  const keep = new Set<string>();
  const days = new Set<string>();
  const months = new Set<string>();
  dated.forEach(({ name, at }, index) => {
    const day = localDay(at);
    const month = day.slice(0, 7);
    if (index < KEEP_NEWEST || !months.has(month)) {
      keep.add(name);
    }
    months.add(month);
    if (now - at < KEEP_DAILY_DAYS * DAY_SECONDS && !days.has(day)) {
      keep.add(name);
      days.add(day);
    }
  });
  return dated.map(({ name }) => name).filter((name) => !keep.has(name));
}

function listBackups(directory: string): string[] {
  try {
    return readdirSync(directory).filter((name) => FILE_NAME.test(name));
  } catch {
    return [];
  }
}

function assertIntact(path: string): void {
  const copy = new Database(path, { readonly: true });
  try {
    const row = copy.query("PRAGMA integrity_check").get() as {
      integrity_check: string;
    };
    if (row.integrity_check !== "ok") {
      throw new Error(row.integrity_check);
    }
  } finally {
    copy.close();
  }
}

export function assertBackupFolder(directory: string): void {
  accessSync(directory, constants.W_OK | constants.X_OK);
  if (!statSync(directory).isDirectory()) {
    throw new Error("not a directory");
  }
}

export class BackupService {
  private baseline: number;
  private failure: string | null = null;

  constructor(
    private readonly db: Db,
    private readonly paths: Paths,
    private readonly settings: () => SettingsDto,
    private readonly now: () => number,
  ) {
    this.baseline = this.changes();
  }

  get error(): string | null {
    return this.failure;
  }

  private changes(): number {
    const row = this.db.$client
      .query("SELECT total_changes() AS count")
      .get() as { count: number };
    return row.count;
  }

  private defaultDirectory(): string {
    return join(this.paths.home, "backups");
  }

  private directory(): string {
    return this.settings().backupDir || this.defaultDirectory();
  }

  private latest(): number | null {
    const times = listBackups(this.directory()).flatMap((name) => {
      const at = backupTime(name);
      return at === null ? [] : [at];
    });
    return times.length > 0 ? Math.max(...times) : null;
  }

  status(): BackupStatusDto {
    const directory = this.directory();
    const names = listBackups(directory);
    return {
      directory,
      defaultDirectory: this.defaultDirectory(),
      lastAt: this.latest(),
      count: names.length,
      sizeBytes: names.reduce(
        (sum, name) => sum + statSync(join(directory, name)).size,
        0,
      ),
      error: this.failure,
    };
  }

  private write(directory: string): string {
    if (directory === this.defaultDirectory()) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    assertBackupFolder(directory);
    const name = backupName(this.now());
    const draft = join(directory, `${name}.tmp`);
    rmSync(draft, { force: true });
    try {
      this.db.$client.run(`VACUUM INTO '${draft.replaceAll("'", "''")}'`);
      assertIntact(draft);
      chmodSync(draft, 0o600);
      renameSync(draft, join(directory, name));
    } finally {
      rmSync(draft, { force: true });
    }
    return name;
  }

  private prune(directory: string): void {
    for (const name of backupsToRemove(listBackups(directory), this.now())) {
      rmSync(join(directory, name), { force: true });
    }
  }

  create(): BackupStatusDto {
    const directory = this.directory();
    try {
      const file = this.write(directory);
      this.prune(directory);
      this.failure = null;
      audit(this.db, "backup", { file });
      this.baseline = this.changes();
      return this.status();
    } catch (error) {
      const reason = `Die Sicherung nach ${directory} ist fehlgeschlagen. Ist der Ordner erreichbar?`;
      if (this.failure !== reason) {
        audit(this.db, "backup.failed", {
          reason: (error as Error).message,
        });
      }
      this.failure = reason;
      throw new ExportError(reason);
    }
  }

  runIfDue(): void {
    const latest = this.latest();
    const due =
      latest === null ||
      this.now() - latest >= DAY_SECONDS ||
      this.changes() !== this.baseline;
    if (due) {
      try {
        this.create();
      } catch {
        return;
      }
    }
  }
}
