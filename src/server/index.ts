import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { websocket } from "hono/bun";
import { createApp } from "./app.ts";
import { BackupService } from "./backup.ts";
import { openDatabase } from "./db/client.ts";
import { claimInstance } from "./instance.ts";
import { stopWalletProcesses } from "./monero/wallet.ts";
import { resolvePaths } from "./paths.ts";
import { createPresence } from "./presence.ts";
import { SecretStore } from "./secrets.ts";
import { createSessionState, randomToken } from "./security.ts";
import { readSettings } from "./settings.ts";

const paths = resolvePaths();
mkdirSync(paths.home, { recursive: true, mode: 0o700 });

const opensBrowser = process.env.BOOKKEEPING_NO_OPEN !== "1";
const instance = await claimInstance(join(paths.home, "instance.json"));
if (instance.kind === "running") {
  console.log(`Virtbase Bookkeeping läuft bereits: ${instance.url}`);
  process.exit(0);
}

const BACKUP_CHECK_MS = 60 * 60 * 1000;

const shutdown = () => {
  stopWalletProcesses();
  backups.runIfDue();
  instance.release();
  process.exit(0);
};

const presence = createPresence({
  graceMs: Number(process.env.BOOKKEEPING_IDLE_SECONDS ?? 120) * 1000,
  onIdle: () => {
    if (opensBrowser) {
      shutdown();
    }
  },
});

const db = openDatabase(paths.database);
const backups = new BackupService(
  db,
  paths,
  () => readSettings(db, paths.defaultExportDir),
  () => Math.floor(Date.now() / 1000),
);
backups.runIfDue();
setInterval(() => backups.runIfDue(), BACKUP_CHECK_MS).unref();

const session = createSessionState();
const app = createApp({
  db,
  paths,
  secrets: new SecretStore(paths.secrets),
  session,
  presence,
  backups,
});

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.BOOKKEEPING_PORT ?? 0),
  fetch: app.fetch,
  websocket,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, shutdown);
}

session.port = server.port ?? 0;

const open = () => {
  session.bootstrapToken ??= randomToken();
  const url = `http://127.0.0.1:${session.port}/?token=${session.bootstrapToken}`;
  if (opensBrowser) {
    Bun.spawn(["xdg-open", url], { stdout: "ignore", stderr: "ignore" });
  }
  return url;
};

instance.publish(open);
console.log(`Virtbase Bookkeeping: ${open()}`);
