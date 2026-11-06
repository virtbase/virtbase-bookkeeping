import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app.ts";
import { openDatabase } from "../src/server/db/client.ts";
import { MIGRATIONS } from "../src/server/db/migrations.ts";
import { exportRows, transactions } from "../src/server/db/schema.ts";
import {
  ensureWalletRpc,
  MONERO_VERSION,
  WALLET_RPC_SHA256,
} from "../src/server/monero/bundle.ts";
import { parseMoneroCsv } from "../src/server/monero/csv.ts";
import {
  daemonTlsArgs,
  parseNode,
  pickNodes,
} from "../src/server/monero/nodes.ts";
import {
  digestResponse,
  parseChallenge,
  WalletRpc,
} from "../src/server/monero/rpc.ts";
import { importMoneroRows } from "../src/server/monero/service.ts";
import { MoneroSync } from "../src/server/monero/sync.ts";
import {
  incomingRows,
  type WalletBackend,
} from "../src/server/monero/wallet.ts";
import { SecretStore } from "../src/server/secrets.ts";
import { createSessionState } from "../src/server/security.ts";
import { writeMoneroMarks } from "../src/server/settings.ts";

describe("digest authentication", () => {
  test("matches the RFC 2617 example", () => {
    expect(
      digestResponse({
        username: "Mufasa",
        password: "Circle Of Life",
        method: "GET",
        uri: "/dir/index.html",
        cnonce: "0a4f113b",
        count: 1,
        challenge: {
          realm: "testrealm@host.com",
          nonce: "dcd98b7102dd2f0e8b11d0f600bfb0c093",
          qop: "auth",
        },
      }),
    ).toBe("6629fae49393a05397450978507c4ef1");
  });

  test("prefers MD5 when the server offers two challenges", () => {
    const header =
      'Digest qop="auth",algorithm=MD5-sess,realm="monero-rpc",nonce="a",stale=false, Digest qop="auth",algorithm=MD5,realm="monero-rpc",nonce="b",stale=false';
    expect(parseChallenge(header)).toEqual({
      realm: "monero-rpc",
      nonce: "b",
      qop: "auth",
    });
  });
});

describe("wallet RPC responses", () => {
  const replies: unknown[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => Response.json(replies.shift()),
  });
  afterAll(() => {
    server.stop(true);
  });
  const rpc = new WalletRpc(`http://127.0.0.1:${server.port}`, "u", "p");

  test("returns the result", async () => {
    replies.push({ result: { height: 5 } });
    expect(await rpc.call("get_height")).toEqual({ height: 5 });
  });

  test("accepts a result next to an empty error", async () => {
    replies.push({ result: {}, error: { code: 0, message: "" } });
    expect(await rpc.call("store")).toEqual({});
  });

  test("treats an empty error without a result as a failure", async () => {
    replies.push({ error: { code: 0, message: "" } });
    await expect(rpc.call("generate_from_keys")).rejects.toThrow(
      "generate_from_keys ist fehlgeschlagen.",
    );
  });

  test("passes on the error text", async () => {
    replies.push({ error: { code: -38, message: "no connection to daemon" } });
    await expect(rpc.call("refresh")).rejects.toMatchObject({
      code: -38,
      message: "no connection to daemon",
    });
  });
});

describe("node selection", () => {
  const info = (height: number) => ({
    status: "OK",
    synchronized: true,
    nettype: "mainnet",
    height,
  });

  test("keeps the configured order and skips dead nodes", async () => {
    const nodes = await pickNodes(
      ["https://dead.example:1", "https://a.example:2", "https://b.example:3"],
      async (url) => {
        if (url.includes("dead")) {
          throw new Error("down");
        }
        return info(100);
      },
    );
    expect(nodes.map((node) => node.host)).toEqual(["a.example", "b.example"]);
  });

  test("skips stale, unsynced and foreign nodes", async () => {
    const nodes = await pickNodes(
      [
        "https://stale.example:1",
        "https://unsynced.example:2",
        "https://testnet.example:3",
        "https://good.example:4",
      ],
      async (url) => {
        if (url.includes("stale")) {
          return info(10);
        }
        if (url.includes("unsynced")) {
          return { ...info(100), synchronized: false };
        }
        return url.includes("testnet")
          ? { ...info(100), nettype: "testnet" }
          : info(100);
      },
    );
    expect(nodes.map((node) => node.host)).toEqual(["good.example"]);
  });

  test("fails clearly when nothing is reachable", async () => {
    await expect(
      pickNodes(["https://a.example:1"], async () => {
        throw new Error("down");
      }),
    ).rejects.toThrow("Kein Monero-Node erreichbar");
  });

  test("keeps the default HTTPS port", () => {
    expect(parseNode("https://node.example.org:443")).toMatchObject({
      host: "node.example.org",
      port: 443,
      tls: true,
    });
    expect(parseNode("http://127.0.0.1:18081")).toMatchObject({
      port: 18081,
      tls: false,
    });
  });

  test("pins TLS to the verified certificate", () => {
    expect(daemonTlsArgs("abc")).toEqual([
      "--daemon-ssl=enabled",
      "--daemon-ssl-allowed-fingerprints=abc",
    ]);
    expect(daemonTlsArgs(null)).toEqual(["--daemon-ssl=disabled"]);
  });
});

describe("incoming transfers", () => {
  const transfer = {
    txid: "aa",
    amount: 15148050000,
    timestamp: 100,
    confirmations: 12,
    locked: false,
  };

  test("needs ten confirmations and an unlocked output", () => {
    expect(
      incomingRows([
        transfer,
        { ...transfer, txid: "young", confirmations: 3 },
        { ...transfer, txid: "locked", locked: true },
      ]).map((row) => row.txid),
    ).toEqual(["aa"]);
  });
});

describe("stable Monero ids", () => {
  const rates = {
    rateAt: async () => ({ eur: 500, source: "Test", window: "VWAP" }),
  };
  const csv = [
    "blockHeight,epoch,date,direction,amount,atomicAmount,fee,txid,label,subaddrAccount,paymentId,description",
    '3799702,100,x,in,0.015,15148050000,0.0001,aa,"Primary account",0,,""',
  ].join("\n");
  const rpcRow = {
    txid: "aa",
    occurredAt: 100,
    atomic: "15148050000",
    label: "",
    note: "",
  };

  test("CSV and sync never create the same payment twice", async () => {
    const db = openDatabase(":memory:");
    await importMoneroRows(db, parseMoneroCsv(csv), rates, 1000);
    const second = await importMoneroRows(db, [rpcRow], rates, 1000);
    expect(second).toEqual({ added: 0, skipped: 1, withoutRate: 0 });
    expect(db.select().from(transactions).all()).toHaveLength(1);
  });

  test("works in the other order too", async () => {
    const db = openDatabase(":memory:");
    await importMoneroRows(db, [rpcRow], rates, 1000);
    await importMoneroRows(db, parseMoneroCsv(csv), rates, 1000);
    expect(db.select().from(transactions).all()).toHaveLength(1);
  });

  test("keeps two equal outputs of one transaction apart", async () => {
    const db = openDatabase(":memory:");
    await importMoneroRows(db, [rpcRow, rpcRow], rates, 1000);
    await importMoneroRows(db, [rpcRow, rpcRow], rates, 1000);
    expect(
      db
        .select()
        .from(transactions)
        .all()
        .map((row) => row.id),
    ).toEqual(["xmr:aa:15148050000", "xmr:aa:15148050000:1"]);
  });

  test("migrates old ids and keeps export links", () => {
    const path = join(mkdtempSync(join(tmpdir(), "bookkeeping-")), "b.sqlite");
    const old = new Database(path, { create: true });
    old.run(MIGRATIONS[0] ?? "");
    old.run(MIGRATIONS[1] ?? "");
    old.run("PRAGMA user_version = 2");
    old.run(
      `INSERT INTO transactions (id, source, kind, occurred_at, value_at, purpose, amount_cents, reference, xmr_atomic, created_at) VALUES
      ('xmr:aa:5:Primary account', 'monero', 'incoming', 1, 1, 'x', 1, 'aa', '5', 1),
      ('xmr:aa:5:other', 'monero', 'incoming', 1, 1, 'x', 1, 'aa', '5', 1),
      ('txn_1', 'stripe', 'charge', 1, 1, 'x', 1, NULL, NULL, 1)`,
    );
    old.run(
      "INSERT INTO export_batches (id, created_at, first_at, last_at, row_count, net_cents, file_name, file_path, sha256) VALUES (1, 1, 1, 1, 1, 1, 'f', 'f', 'h')",
    );
    old.run(
      "INSERT INTO export_rows (batch_id, transaction_id) VALUES (1, 'xmr:aa:5:Primary account')",
    );
    old.close();

    const db = openDatabase(path);
    expect(
      db
        .select()
        .from(transactions)
        .all()
        .map((row) => row.id)
        .sort(),
    ).toEqual(["txn_1", "xmr:aa:5", "xmr:aa:5:1"]);
    expect(db.select().from(exportRows).all()[0]?.transactionId).toBe(
      "xmr:aa:5",
    );
  });
});

describe("Monero sync runs", () => {
  function backend(result: () => Promise<never[]>): WalletBackend {
    return {
      create: async () => undefined,
      fetchIncoming: result,
      remove: () => undefined,
    };
  }

  async function finished(sync: MoneroSync) {
    while (sync.status().running) {
      await Bun.sleep(1);
    }
    return sync.status();
  }

  test("does nothing without a wallet", () => {
    const sync = new MoneroSync(
      openDatabase(":memory:"),
      backend(async () => []),
      "/tmp",
    );
    expect(sync.start()).toBe(false);
  });

  test("keeps the error for the interface", async () => {
    const db = openDatabase(":memory:");
    writeMoneroMarks(db, { address: "4a", restoreHeight: 1, lastSyncAt: null });
    const sync = new MoneroSync(
      db,
      backend(async () => {
        throw new Error("Kein Monero-Node erreichbar.");
      }),
      "/tmp",
    );
    expect(sync.start()).toBe(true);
    expect(sync.start()).toBe(false);
    const status = await finished(sync);
    expect(status).toMatchObject({
      lastError: "Kein Monero-Node erreichbar.",
      lastSyncAt: null,
    });
  });

  test("records a successful run", async () => {
    const db = openDatabase(":memory:");
    writeMoneroMarks(db, { address: "4a", restoreHeight: 1, lastSyncAt: null });
    const sync = new MoneroSync(
      db,
      backend(async () => []),
      "/tmp",
    );
    sync.start();
    const status = await finished(sync);
    expect(status.lastError).toBeNull();
    expect(status.lastSyncAt).toBeGreaterThan(0);
  });
});

describe("bundled wallet program", () => {
  test("replaces a modified copy with the verified one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bookkeeping-bin-"));
    const target = join(dir, `monero-wallet-rpc-${MONERO_VERSION}`);
    writeFileSync(target, "tampered");
    expect(await ensureWalletRpc(dir)).toBe(target);
    const hash = new Bun.CryptoHasher("sha256")
      .update(readFileSync(target))
      .digest("hex");
    expect(hash).toBe(WALLET_RPC_SHA256);
  });
});

describe("hiding rows through the API", () => {
  const port = 4102;
  const base = `http://127.0.0.1:${port}`;
  const row = {
    source: "stripe" as const,
    kind: "charge",
    occurredAt: Math.floor(Date.now() / 1000),
    valueAt: 1000,
    name: "Anna",
    purpose: "EPYC-01",
    amountCents: 399,
    createdAt: 1000,
  };

  async function setup() {
    const home = mkdtempSync(join(tmpdir(), "bookkeeping-"));
    const session = createSessionState(port);
    const db = openDatabase(":memory:");
    db.insert(transactions)
      .values([
        { ...row, id: "a" },
        { ...row, id: "b" },
      ])
      .run();
    const app = createApp({
      db,
      paths: {
        home,
        database: ":memory:",
        secrets: join(home, "s.json"),
        defaultExportDir: join(home, "exports"),
      },
      secrets: new SecretStore(join(home, "s.json")),
      session,
    });
    const login = await app.request(
      `${base}/?token=${session.bootstrapToken}`,
      { headers: { host: `127.0.0.1:${port}` } },
    );
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    const send = (path: string, method = "GET", body?: unknown) =>
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
    return { send };
  }

  const statuses = async (send: Awaited<ReturnType<typeof setup>>["send"]) => {
    const rows = (await (await send("transactions")).json()) as {
      id: string;
      status: string;
    }[];
    return Object.fromEntries(rows.map((entry) => [entry.id, entry.status]));
  };

  test("hides and restores a row", async () => {
    const { send } = await setup();
    await send("transactions/ignore", "POST", { ids: ["a"], ignored: true });
    expect(await statuses(send)).toEqual({ a: "ignored", b: "ready" });
    const summary = (await (await send("summary")).json()) as {
      openCount: number;
    };
    expect(summary.openCount).toBe(1);
    await send("transactions/ignore", "POST", { ids: ["a"], ignored: false });
    expect(await statuses(send)).toEqual({ a: "ready", b: "ready" });
  });

  test("a hidden row cannot be exported", async () => {
    const { send } = await setup();
    await send("transactions/ignore", "POST", { ids: ["a"], ignored: true });
    const response = await send("exports", "POST", { ids: ["a"] });
    expect(response.status).toBe(400);
  });

  test("an exported row cannot be hidden", async () => {
    const { send } = await setup();
    await send("exports", "POST", { ids: ["a"] });
    const response = await send("transactions/ignore", "POST", {
      ids: ["a"],
      ignored: true,
    });
    expect(response.status).toBe(400);
    expect(await statuses(send)).toMatchObject({ a: "exported" });
  });
});
