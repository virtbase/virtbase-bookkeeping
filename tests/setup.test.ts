import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app.ts";
import { openDatabase } from "../src/server/db/client.ts";
import { MIGRATIONS } from "../src/server/db/migrations.ts";
import { transactions } from "../src/server/db/schema.ts";
import { SecretStore } from "../src/server/secrets.ts";
import { createSessionState } from "../src/server/security.ts";
import {
  isSetupComplete,
  readPreferences,
  readSettings,
} from "../src/server/settings.ts";
import { setupSchema } from "../src/shared/schemas.ts";

const port = 4300;
const host = `127.0.0.1:${port}`;

async function setup() {
  const home = mkdtempSync(join(tmpdir(), "bookkeeping-"));
  const session = createSessionState(port);
  const secrets = new SecretStore(join(home, "secrets.json"));
  const db = openDatabase(join(home, "bookkeeping.sqlite"));
  const paths = {
    home,
    database: join(home, "bookkeeping.sqlite"),
    secrets: join(home, "secrets.json"),
    defaultExportDir: join(home, "exports"),
  };
  const app = createApp({ db, paths, secrets, session });
  const login = await app.request(
    `http://${host}/?token=${session.bootstrapToken}`,
    { headers: { host } },
  );
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  const send = (path: string, method = "GET", body?: unknown) =>
    app.request(`http://${host}/api/${path}`, {
      method,
      headers: {
        host,
        cookie,
        origin: `http://${host}`,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const values = () => readSettings(db, paths.defaultExportDir);
  return { db, secrets, send, values };
}

async function summary(send: Awaited<ReturnType<typeof setup>>["send"]) {
  return (await (await send("summary")).json()) as { setupRequired: boolean };
}

describe("first start", () => {
  test("a new install needs setup", async () => {
    const { send } = await setup();
    expect((await summary(send)).setupRequired).toBe(true);
  });

  function upgrade(prepare: (old: Database) => void) {
    const home = mkdtempSync(join(tmpdir(), "bookkeeping-"));
    const path = join(home, "bookkeeping.sqlite");
    const old = new Database(path);
    for (const statement of MIGRATIONS.slice(0, 4)) {
      old.run(statement);
    }
    old.run("PRAGMA user_version = 4");
    prepare(old);
    old.close();
    return openDatabase(path);
  }

  test("an existing install with rows skips setup", () => {
    const db = upgrade((old) => {
      old.run(
        `INSERT INTO transactions (id, source, kind, occurred_at, value_at, purpose, amount_cents, created_at)
         VALUES ('a', 'stripe', 'charge', 1, 1, 'x', 1, 1)`,
      );
    });
    expect(isSetupComplete(db)).toBe(true);
  });

  test("an existing install with settings skips setup", () => {
    const db = upgrade((old) => {
      old.run("INSERT INTO settings (key, value) VALUES ('app', '{}')");
    });
    expect(isSetupComplete(db)).toBe(true);
  });

  test("an empty old database still gets setup", () => {
    expect(isSetupComplete(upgrade(() => {}))).toBe(false);
  });

  test("an upgrade does not start the tutorial", () => {
    const db = upgrade((old) => {
      old.run("INSERT INTO settings (key, value) VALUES ('app', '{}')");
    });
    expect(readPreferences(db).tourPending).toBe(false);
  });
});

describe("finishing setup", () => {
  test("needs the Stripe key", async () => {
    const { send, values } = await setup();
    const response = await send("setup/complete", "POST", {
      ...values(),
      nothingBooked: true,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect((await summary(send)).setupRequired).toBe(true);
  });

  test("needs a start point", async () => {
    const { secrets, send, values } = await setup();
    secrets.update({ stripeKey: "rk_live_test" });
    const response = await send("setup/complete", "POST", {
      ...values(),
      nothingBooked: false,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect((await summary(send)).setupRequired).toBe(true);
  });

  test("saves the start point and starts the tutorial", async () => {
    const { db, secrets, send, values } = await setup();
    secrets.update({ stripeKey: "rk_live_test" });
    const response = await send("setup/complete", "POST", {
      ...values(),
      baselineDate: "2026-10-31T23:59",
      feesClosedThrough: "2026-09",
      nothingBooked: false,
    });
    expect(response.status).toBe(200);
    expect((await summary(send)).setupRequired).toBe(false);
    expect(values().baselineDate).toBe("2026-10-31T23:59");
    expect(readPreferences(db).tourPending).toBe(true);
  });

  test("clears dates when nothing is booked yet", async () => {
    const { secrets, send, values } = await setup();
    secrets.update({ stripeKey: "rk_live_test" });
    await send("setup/complete", "POST", {
      ...values(),
      baselineDate: "2026-10-31T23:59",
      feesClosedThrough: "2026-09",
      nothingBooked: true,
    });
    expect(values().baselineDate).toBe("");
    expect(values().feesClosedThrough).toBe("");
  });

  test("accepts the default backup folder before it exists", async () => {
    const { secrets, send, values } = await setup();
    secrets.update({ stripeKey: "rk_live_test" });
    const { defaultDirectory, directory } = (await (
      await send("backups")
    ).json()) as { defaultDirectory: string; directory: string };
    expect(directory).toBe(defaultDirectory);
    const response = await send("setup/complete", "POST", {
      ...values(),
      backupDir: defaultDirectory,
      nothingBooked: true,
    });
    expect(response.status).toBe(200);
    expect(values().backupDir).toBe("");
  });

  test("still rejects a missing custom backup folder", async () => {
    const { secrets, send, values } = await setup();
    secrets.update({ stripeKey: "rk_live_test" });
    const response = await send("setup/complete", "POST", {
      ...values(),
      backupDir: "/mnt/gibt-es-nicht",
      nothingBooked: true,
    });
    expect(response.status).toBe(400);
    expect((await summary(send)).setupRequired).toBe(true);
  });

  test("a full reset asks for setup again", async () => {
    const { db, secrets, send, values } = await setup();
    secrets.update({ stripeKey: "rk_live_test" });
    db.insert(transactions)
      .values({
        id: "a",
        source: "stripe",
        kind: "charge",
        occurredAt: 1,
        valueAt: 1,
        purpose: "x",
        amountCents: 1,
        createdAt: 1,
      })
      .run();
    await send("setup/complete", "POST", { ...values(), nothingBooked: true });
    await send("reset/all", "POST", { confirm: true });
    expect((await summary(send)).setupRequired).toBe(true);
  });
});

describe("setupSchema", () => {
  test("names both missing fields", async () => {
    const { values } = await setup();
    const result = setupSchema.safeParse({
      ...values(),
      nothingBooked: false,
    });
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual([
      "baselineDate",
      "feesClosedThrough",
    ]);
  });
});

describe("preferences", () => {
  test("start with defaults", async () => {
    const { send } = await setup();
    expect(await (await send("preferences")).json()).toEqual({
      theme: null,
      privacy: false,
      tourPending: false,
    });
  });

  test("merge changes and survive a reload", async () => {
    const { db, send } = await setup();
    await send("preferences", "PUT", { privacy: true });
    await send("preferences", "PUT", { theme: "dark" });
    expect(readPreferences(db)).toEqual({
      theme: "dark",
      privacy: true,
      tourPending: false,
    });
  });

  test("reject unknown values", async () => {
    const { send } = await setup();
    const response = await send("preferences", "PUT", { theme: "blue" });
    expect(response.status).toBe(400);
  });
});
