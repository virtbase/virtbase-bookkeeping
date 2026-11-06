import { Database } from "bun:sqlite";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { MIGRATIONS } from "./migrations.ts";
import * as schema from "./schema.ts";

export type Db = BunSQLiteDatabase<typeof schema> & { $client: Database };

function userVersion(sqlite: Database): number {
  const row = sqlite.query("PRAGMA user_version").get() as {
    user_version: number;
  };
  return row.user_version;
}

function migrate(sqlite: Database, path: string): void {
  const current = userVersion(sqlite);
  if (current >= MIGRATIONS.length) {
    return;
  }
  if (current > 0 && path !== ":memory:") {
    sqlite.run(`VACUUM INTO '${path}.v${current}.bak'`);
  }
  MIGRATIONS.slice(current).forEach((statement, offset) => {
    sqlite.transaction(() => {
      sqlite.run(statement);
      sqlite.run(`PRAGMA user_version = ${current + offset + 1}`);
    })();
  });
}

export function openDatabase(path: string): Db {
  const sqlite = new Database(path, { create: true, strict: true });
  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run("PRAGMA synchronous = FULL");
  sqlite.run("PRAGMA foreign_keys = ON");
  sqlite.run("PRAGMA busy_timeout = 5000");
  migrate(sqlite, path);
  return drizzle(sqlite, { schema });
}
