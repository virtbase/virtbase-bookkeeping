import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app.ts";
import { openDatabase } from "../src/server/db/client.ts";
import { auditEvents, transactions } from "../src/server/db/schema.ts";
import type { MoneroSync } from "../src/server/monero/sync.ts";
import type { WalletBackend } from "../src/server/monero/wallet.ts";
import { resetExports } from "../src/server/reset.ts";
import { SecretStore } from "../src/server/secrets.ts";
import { createSessionState } from "../src/server/security.ts";
import {
  readMoneroMarks,
  readSettings,
  readSyncMarks,
  writeMoneroMarks,
  writeSettings,
  writeSyncMarks,
} from "../src/server/settings.ts";

const port = 4103;
const base = `http://127.0.0.1:${port}`;
const row = {
  source: "stripe" as const,
  kind: "charge",
  occurredAt: 1000,
  valueAt: 1000,
  name: "Anna",
  purpose: "EPYC-01",
  amountCents: 399,
  createdAt: 1000,
};

async function setup() {
  const home = mkdtempSync(join(tmpdir(), "bookkeeping-"));
  const database = join(home, "bookkeeping.sqlite");
  const exportDir = join(home, "exports");
  const session = createSessionState(port);
  const db = openDatabase(database);
  const secrets = new SecretStore(join(home, "secrets.json"));
  secrets.update({
    stripeKey: "rk_live_abc",
    lexwareKey: "lexware-key-abcdefgh",
  });
  writeSettings(db, {
    ...readSettings(db, exportDir),
    stripeName: "Eigener Name",
    feesClosedThrough: "2026-09",
  });
  writeSyncMarks(db, { lastSyncAt: 5, syncedFrom: 1, balanceCents: 7 });
  writeMoneroMarks(db, { address: "4a", restoreHeight: 9, lastSyncAt: 3 });
  db.insert(transactions)
    .values([
      { ...row, id: "a" },
      { ...row, id: "b", ignored: true },
    ])
    .run();
  let removed = 0;
  const moneroBackend: WalletBackend = {
    create: async () => undefined,
    fetchIncoming: async () => [],
    remove: () => {
      removed += 1;
    },
  };
  const app = createApp({
    db,
    paths: {
      home,
      database,
      secrets: join(home, "secrets.json"),
      defaultExportDir: exportDir,
    },
    secrets,
    session,
    moneroBackend,
  });
  const login = await app.request(`${base}/?token=${session.bootstrapToken}`, {
    headers: { host: `127.0.0.1:${port}` },
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  const send = (path: string, method = "POST", body?: unknown) =>
    app.request(`${base}/api/${path}`, {
      method,
      headers: {
        host: `127.0.0.1:${port}`,
        cookie,
        origin: base,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { db, home, exportDir, secrets, send, removed: () => removed };
}

const backups = (home: string) =>
  readdirSync(home).filter((file) => file.includes(".reset-"));

describe("resetting exports", () => {
  test("clears the ledger and keeps settings, keys and wallet", async () => {
    const context = await setup();
    const [batch] = (await (
      await context.send("exports", "POST", { ids: ["a"] })
    ).json()) as { id: number; filePath: string }[];

    expect((await context.send("reset/exports")).status).toBe(200);

    expect(context.db.select().from(transactions).all()).toEqual([]);
    expect(
      (
        (await (await context.send("exports", "GET")).json()) as {
          batches: unknown[];
        }
      ).batches,
    ).toEqual([]);
    expect(readSettings(context.db, "").stripeName).toBe("Eigener Name");
    expect(readSettings(context.db, "").feesClosedThrough).toBe("2026-09");
    expect(context.secrets.read().stripeKey).toBe("rk_live_abc");
    expect(readMoneroMarks(context.db)).toEqual({
      address: "4a",
      restoreHeight: 9,
      lastSyncAt: null,
    });
    expect(context.removed()).toBe(0);
    expect(readSyncMarks(context.db).syncedFrom).toBeNull();
    expect(existsSync(batch?.filePath ?? "")).toBe(true);
    expect(backups(context.home)).toHaveLength(1);
  });

  test("a new first export never overwrites an old file", async () => {
    const context = await setup();
    const [first] = (await (
      await context.send("exports", "POST", { ids: ["a"] })
    ).json()) as { id: number; filePath: string }[];
    const content = readFileSync(first?.filePath ?? "", "utf8");
    await context.send("reset/exports");
    context.db
      .insert(transactions)
      .values({ ...row, id: "c", amountCents: 799 })
      .run();

    const response = await context.send("exports", "POST", { ids: ["c"] });
    const [second] = (await response.json()) as {
      id: number;
      filePath: string;
    }[];

    expect(response.status).toBe(200);
    expect(second?.id).toBe(1);
    expect(second?.filePath).not.toBe(first?.filePath);
    expect(second?.filePath.endsWith("_2.csv")).toBe(true);
    expect(readFileSync(first?.filePath ?? "", "utf8")).toBe(content);
    expect(readFileSync(second?.filePath ?? "", "utf8")).toContain("7.99");
  });
});

describe("resetting everything", () => {
  test("removes settings, keys, wallet and data but keeps files", async () => {
    const context = await setup();
    const [batch] = (await (
      await context.send("exports", "POST", { ids: ["a"] })
    ).json()) as { filePath: string }[];

    expect((await context.send("reset/all")).status).toBe(200);

    expect(context.db.select().from(transactions).all()).toEqual([]);
    expect(readSettings(context.db, "/default").stripeName).toBe(
      "Stripe Technology Europe, Limited",
    );
    expect(readSettings(context.db, "/default").feesClosedThrough).toBe("");
    expect(context.secrets.read()).toEqual({});
    expect(readMoneroMarks(context.db).address).toBeNull();
    expect(context.removed()).toBe(1);
    expect(readSyncMarks(context.db).balanceCents).toBeNull();
    expect(
      context.db
        .select()
        .from(auditEvents)
        .all()
        .map((event) => event.type),
    ).toEqual(["reset.all"]);
    expect(existsSync(batch?.filePath ?? "")).toBe(true);
    expect(backups(context.home)).toHaveLength(1);
    const summary = (await (await context.send("summary", "GET")).json()) as {
      stripeConfigured: boolean;
      moneroConfigured: boolean;
      openCount: number;
    };
    expect(summary).toMatchObject({
      stripeConfigured: false,
      moneroConfigured: false,
      openCount: 0,
    });
  });
});

describe("safety", () => {
  test("refuses while a Monero sync runs", () => {
    const db = openDatabase(":memory:");
    db.insert(transactions)
      .values({ ...row, id: "a" })
      .run();
    const running = { status: () => ({ running: true }) } as MoneroSync;
    const paths = {
      home: "",
      database: ":memory:",
      secrets: "",
      defaultExportDir: "",
    };
    expect(() => resetExports(db, paths, running)).toThrow("Synchronisierung");
    expect(db.select().from(transactions).all()).toHaveLength(1);
  });

  test("a reset cannot be triggered by a GET request", async () => {
    const context = await setup();
    const response = await context.send("reset/all", "GET");
    expect(response.status).toBe(404);
    expect(context.db.select().from(transactions).all()).toHaveLength(2);
  });
});
