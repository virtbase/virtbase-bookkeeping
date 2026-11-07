import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app.ts";
import { audit } from "../src/server/audit.ts";
import { openDatabase } from "../src/server/db/client.ts";
import { transactions } from "../src/server/db/schema.ts";
import { renderAuditCsv } from "../src/server/export/csv.ts";
import { baselineEnd, listTransactions } from "../src/server/queries.ts";
import { SecretStore } from "../src/server/secrets.ts";
import { createSessionState } from "../src/server/security.ts";
import { readSettings, writeSettings } from "../src/server/settings.ts";
import { auditLabel, formatAuditDetail } from "../src/shared/audit.ts";
import { DEFAULT_FILE_NAME_TEMPLATE } from "../src/shared/file-name.ts";
import { DEFAULT_PURPOSE_TEMPLATES } from "../src/shared/purpose.ts";
import { settingsSchema } from "../src/shared/schemas.ts";
import type { SettingsDto } from "../src/shared/types.ts";

const base: SettingsDto = {
  exportDir: "/tmp",
  backupDir: "",
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
  fileNameTemplate: DEFAULT_FILE_NAME_TEMPLATE,
};

const row = {
  source: "stripe" as const,
  kind: "charge",
  valueAt: 1,
  name: "Anna",
  purpose: "EPYC-01",
  amountCents: 399,
  createdAt: 1,
};

describe("baseline down to the minute", () => {
  const at = (iso: string) => Date.parse(iso) / 1000;
  const statuses = (baselineDate: string) => {
    const db = openDatabase(":memory:");
    db.insert(transactions)
      .values([
        { ...row, id: "first", occurredAt: at("2026-11-05T15:29:00+01:00") },
        { ...row, id: "last", occurredAt: at("2026-11-05T15:29:59+01:00") },
        { ...row, id: "next", occurredAt: at("2026-11-05T15:30:00+01:00") },
      ])
      .run();
    return Object.fromEntries(
      listTransactions(db, { ...base, baselineDate }).map((entry) => [
        entry.id,
        entry.status,
      ]),
    );
  };

  test("includes the whole chosen minute and nothing after it", () => {
    expect(statuses("2026-11-05T15:29")).toEqual({
      first: "exported",
      last: "exported",
      next: "ready",
    });
  });

  test("uses German time in summer and winter", () => {
    expect(baselineEnd({ ...base, baselineDate: "2026-07-01T12:00" })).toBe(
      at("2026-07-01T12:01:00+02:00"),
    );
    expect(baselineEnd({ ...base, baselineDate: "2026-01-01T12:00" })).toBe(
      at("2026-01-01T12:01:00+01:00"),
    );
  });

  test("reads an old date-only value as the end of that day", () => {
    const db = openDatabase(":memory:");
    writeSettings(db, { ...base, baselineDate: "2026-11-04" });
    expect(readSettings(db, "/tmp").baselineDate).toBe("2026-11-04T23:59");
  });

  test("rejects a time later today but accepts the past", () => {
    const check = (baselineDate: string) =>
      settingsSchema.safeParse({ ...base, baselineDate }).success;
    expect(check("2999-01-01T00:00")).toBe(false);
    expect(check("2020-01-01T00:00")).toBe(true);
    expect(check("")).toBe(true);
  });
});

describe("audit texts", () => {
  test("labels known events and keeps unknown ones", () => {
    expect(auditLabel("export.void")).toBe("Export storniert");
    expect(auditLabel("something.new")).toBe("something.new");
  });

  test("writes details readably", () => {
    expect(
      formatAuditDetail({ id: 3, rows: 10, ids: ["a", "b"], other: true }),
    ).toBe("Nr.: 3, Zeilen: 10, Zeilen: a, b, other: true");
    expect(formatAuditDetail({})).toBe("");
    expect(formatAuditDetail({ from: 1793854123 })).toBe(
      "ab: 05.11.2026 05:48:43",
    );
  });

  test("renders a safe CSV", () => {
    const csv = renderAuditCsv([
      { at: 1793854123, type: "=evil", detail: { note: "a;b" } },
    ]);
    expect(csv).toBe(
      'Zeitpunkt;Ereignis;Details\r\n05.11.2026 05:48:43;\'=evil;"note: a;b"\r\n',
    );
  });
});

describe("audit API", () => {
  const port = 4104;
  const url = `http://127.0.0.1:${port}`;

  async function setup() {
    const home = mkdtempSync(join(tmpdir(), "bookkeeping-"));
    const session = createSessionState(port);
    const db = openDatabase(":memory:");
    audit(db, "settings", {});
    audit(db, "export", { id: 1, rows: 2 });
    audit(db, "reset.exports", {});
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
    const login = await app.request(`${url}/?token=${session.bootstrapToken}`, {
      headers: { host: `127.0.0.1:${port}` },
    });
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    return (path: string, method = "GET", body?: unknown) =>
      app.request(`${url}/api/${path}`, {
        method,
        headers: {
          host: `127.0.0.1:${port}`,
          cookie,
          origin: url,
          "sec-fetch-site": "same-origin",
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
  }

  const list = async (send: Awaited<ReturnType<typeof setup>>) =>
    (await (await send("audit")).json()) as {
      id: number;
      type: string;
      detail: Record<string, unknown>;
    }[];

  test("lists events with the newest first", async () => {
    const send = await setup();
    const events = await list(send);
    expect(events.map((event) => event.type)).toEqual([
      "reset.exports",
      "export",
      "settings",
    ]);
    expect(events[1]?.detail).toEqual({ id: 1, rows: 2 });
  });

  test("exports only the chosen entries and records it", async () => {
    const send = await setup();
    const events = await list(send);
    const chosen = events[1]?.id ?? 0;
    const response = await send("audit/export", "POST", { ids: [chosen] });
    const result = (await response.json()) as {
      fileName: string;
      content: string;
    };
    expect(result.fileName).toMatch(/^audit-log_\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = result.content.trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Export erstellt;Nr.: 1, Zeilen: 2");
    const after = await list(send);
    expect(after[0]).toMatchObject({
      type: "audit.export",
      detail: { rows: 1 },
    });
  });

  test("refuses an empty selection", async () => {
    const send = await setup();
    const response = await send("audit/export", "POST", { ids: [] });
    expect(response.status).toBe(400);
  });
});
