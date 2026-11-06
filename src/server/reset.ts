import { sql } from "drizzle-orm";
import { audit } from "./audit.ts";
import type { Db } from "./db/client.ts";
import {
  auditEvents,
  exportBatches,
  exportRows,
  lexwareInvoices,
  settings,
  transactions,
} from "./db/schema.ts";
import { ExportError } from "./export/service.ts";
import type { MoneroSync } from "./monero/sync.ts";
import type { Paths } from "./paths.ts";
import type { SecretStore } from "./secrets.ts";
import {
  clearStripeSync,
  readMoneroMarks,
  writeMoneroMarks,
} from "./settings.ts";

function backup(db: Db, paths: Paths): void {
  if (paths.database === ":memory:") {
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = `${paths.database}.reset-${stamp}.bak`.replaceAll("'", "''");
  db.run(sql.raw(`VACUUM INTO '${target}'`));
}

function clearLedger(db: Db): void {
  db.delete(exportRows).run();
  db.delete(exportBatches).run();
  db.delete(transactions).run();
  db.delete(lexwareInvoices).run();
  db.run(sql`DELETE FROM sqlite_sequence WHERE name = 'export_batches'`);
}

function assertIdle(monero: MoneroSync): void {
  if (monero.status().running) {
    throw new ExportError(
      "Die Monero-Synchronisierung läuft noch. Bitte kurz warten.",
    );
  }
}

export function resetExports(db: Db, paths: Paths, monero: MoneroSync): void {
  assertIdle(monero);
  backup(db, paths);
  db.transaction(() => {
    clearLedger(db);
    clearStripeSync(db);
    writeMoneroMarks(db, { ...readMoneroMarks(db), lastSyncAt: null });
  });
  monero.clearResult();
  audit(db, "reset.exports", {});
}

export function resetEverything(
  db: Db,
  paths: Paths,
  secrets: SecretStore,
  monero: MoneroSync,
): void {
  assertIdle(monero);
  backup(db, paths);
  monero.remove();
  db.transaction(() => {
    clearLedger(db);
    db.delete(settings).run();
    db.delete(auditEvents).run();
  });
  secrets.clear();
  monero.clearResult();
  audit(db, "reset.all", {});
}
