import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app.ts";
import { openDatabase } from "../src/server/db/client.ts";
import { transactions } from "../src/server/db/schema.ts";
import { importMoneroCsv } from "../src/server/monero/service.ts";
import { SecretStore } from "../src/server/secrets.ts";
import { createSessionState } from "../src/server/security.ts";
import { DEFAULT_PURPOSE_TEMPLATES } from "../src/shared/purpose.ts";

const port = 4101;
const base = `http://127.0.0.1:${port}`;

function setup(balance: () => Promise<number>) {
  const home = mkdtempSync(join(tmpdir(), "bookkeeping-"));
  const session = createSessionState(port);
  const secrets = new SecretStore(join(home, "secrets.json"));
  const app = createApp({
    db: openDatabase(":memory:"),
    paths: {
      home,
      database: ":memory:",
      secrets: join(home, "secrets.json"),
      defaultExportDir: join(home, "exports"),
    },
    secrets,
    session,
    stripeFactory: () => ({
      listBalanceTransactions: async () => [],
      retrieveBalanceCents: balance,
    }),
  });
  return { app, session, secrets, home };
}

async function send(
  context: ReturnType<typeof setup>,
  path: string,
  method: string,
  body: unknown,
) {
  const login = await context.app.request(
    `${base}/?token=${context.session.bootstrapToken}`,
    { headers: { host: `127.0.0.1:${port}` } },
  );
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  context.session.bootstrapToken = "used";
  return context.app.request(`${base}${path}`, {
    method,
    headers: {
      host: `127.0.0.1:${port}`,
      cookie,
      origin: base,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("field errors", () => {
  test("names the field for an invalid setting", async () => {
    const context = setup(async () => 0);
    const response = await send(context, "/api/settings", "PUT", {
      exportDir: "relative/path",
      dateFormat: "iso",
      decimalFormat: "dot",
      baselineDate: "",
      feesClosedThrough: "",
      rateSource: "auto",
      stripeName: "Stripe",
      paypalName: "PayPal",
      moneroNodes: ["https://node.example.org:18089"],
      accounts: { stripe: "Stripe", fees: "Stripe", monero: "Monero" },
      purposeTemplates: DEFAULT_PURPOSE_TEMPLATES,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ field: "exportDir" });
  });

  test("refuses a malformed key without calling Stripe", async () => {
    let called = false;
    const context = setup(async () => {
      called = true;
      return 0;
    });
    const response = await send(context, "/api/secrets/stripe", "PUT", {
      value: "not-a-key",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ field: "value" });
    expect(called).toBe(false);
    expect(context.secrets.read().stripeKey).toBeUndefined();
  });

  test("does not store a key that Stripe rejects", async () => {
    const context = setup(async () => {
      throw new Error("Stripe: Invalid API Key");
    });
    const response = await send(context, "/api/secrets/stripe", "PUT", {
      value: "rk_live_abc123",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Stripe: Invalid API Key",
      field: "value",
    });
    expect(context.secrets.read().stripeKey).toBeUndefined();
  });

  test("stores a working key", async () => {
    const context = setup(async () => 100);
    const response = await send(context, "/api/secrets/stripe", "PUT", {
      value: "rk_live_abc123",
    });
    expect(response.status).toBe(200);
    expect(context.secrets.read().stripeKey).toBe("rk_live_abc123");
  });
});

describe("Monero GUI files", () => {
  const header =
    "blockHeight,epoch,date,direction,amount,atomicAmount,fee,txid,label,subaddrAccount,paymentId,description";
  const row = (epoch: number, txid: string) =>
    `3799702,${epoch},2026-11-05 12:09:53,in,0.014152390000,14152390000,0.000122560000,${txid},"Primary account",0,,""`;
  const rates = {
    rateAt: async () => ({ eur: 500, source: "Test", window: "VWAP" }),
  };

  test("imports the real export format and hides the default label", async () => {
    const db = openDatabase(":memory:");
    const csv = `${[header, row(1793876993, "aa")].join("\n")}\n\n`;
    expect(await importMoneroCsv(db, csv, rates, 1793900000)).toEqual({
      added: 1,
      skipped: 0,
      withoutRate: 0,
    });
    expect(db.select().from(transactions).get()).toMatchObject({
      walletLabel: null,
      marketValueCents: 708,
      needsReview: true,
    });
  });
});
