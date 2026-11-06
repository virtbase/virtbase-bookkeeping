import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { createApp } from "../src/server/app.ts";
import { openDatabase } from "../src/server/db/client.ts";
import { SecretStore } from "../src/server/secrets.ts";
import { createSessionState, guard } from "../src/server/security.ts";

const port = 4100;
const host = `127.0.0.1:${port}`;

function setup() {
  const home = mkdtempSync(join(tmpdir(), "bookkeeping-"));
  const session = createSessionState(port);
  const secrets = new SecretStore(join(home, "secrets.json"));
  secrets.update({ stripeKey: "sk_live_never_leaves_the_server" });
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
  });
  return { app, session };
}

async function login(app: ReturnType<typeof setup>["app"], token: string) {
  const response = await app.request(`http://${host}/?token=${token}`, {
    headers: { host },
  });
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

const api = (cookie: string, extra: Record<string, string> = {}) => ({
  host,
  cookie,
  "sec-fetch-site": "same-origin",
  ...extra,
});

describe("localhost guard", () => {
  test("a valid bootstrap token works once", async () => {
    const { app, session } = setup();
    const token = session.bootstrapToken ?? "";
    expect(await login(app, token)).toContain("bookkeeping_session=");
    const replay = await app.request(`http://${host}/?token=${token}`, {
      headers: { host },
    });
    expect(replay.status).toBe(401);
  });

  test("rejects a wrong token", async () => {
    const { app } = setup();
    const response = await app.request(`http://${host}/?token=nope`, {
      headers: { host },
    });
    expect(response.status).toBe(401);
  });

  test("blocks DNS rebinding through the Host header", async () => {
    const { app, session } = setup();
    const cookie = await login(app, session.bootstrapToken ?? "");
    const response = await app.request(`http://${host}/api/summary`, {
      headers: api(cookie, { host: "evil.example:4100" }),
    });
    expect(response.status).toBe(403);
  });

  test("requires a session for the API and the page", async () => {
    const { app } = setup();
    const apiResponse = await app.request(`http://${host}/api/summary`, {
      headers: api(""),
    });
    expect(apiResponse.status).toBe(401);
    const page = await app.request(`http://${host}/`, { headers: { host } });
    expect(page.status).toBe(401);
  });

  test("blocks cross-site requests even with a valid cookie", async () => {
    const { app, session } = setup();
    const cookie = await login(app, session.bootstrapToken ?? "");
    const read = await app.request(`http://${host}/api/transactions`, {
      headers: api(cookie, { "sec-fetch-site": "cross-site" }),
    });
    expect(read.status).toBe(403);
    const write = await app.request(`http://${host}/api/exports`, {
      method: "POST",
      headers: api(cookie, { origin: "https://evil.example" }),
      body: JSON.stringify({ ids: ["x"] }),
    });
    expect(write.status).toBe(403);
    const noOrigin = await app.request(`http://${host}/api/exports`, {
      method: "POST",
      headers: api(cookie),
      body: JSON.stringify({ ids: ["x"] }),
    });
    expect(noOrigin.status).toBe(403);
  });

  test("allows same-origin requests and never returns the key", async () => {
    const { app, session } = setup();
    const cookie = await login(app, session.bootstrapToken ?? "");
    const response = await app.request(`http://${host}/api/summary`, {
      headers: api(cookie),
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('"stripeKeyType":"secret"');
    expect(text).not.toContain("never_leaves");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
  });

  test("sets a strict, HttpOnly session cookie", async () => {
    const { app, session } = setup();
    const response = await app.request(
      `http://${host}/?token=${session.bootstrapToken}`,
      { headers: { host } },
    );
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
  });
});

describe("presence socket", () => {
  async function socket() {
    const session = createSessionState(port);
    const app = new Hono();
    app.use(guard(session));
    app.get("/api/presence", (context) => context.text("connected"));
    app.get("/api/summary", (context) => context.text("data"));
    const cookie = await login(app as never, session.bootstrapToken ?? "");
    const upgrade = { host, cookie, upgrade: "websocket" };
    return { app, cookie, upgrade };
  }

  test("connects from the app itself", async () => {
    const { app, upgrade } = await socket();
    const response = await app.request(`http://${host}/api/presence`, {
      headers: { ...upgrade, origin: `http://${host}` },
    });
    expect(response.status).toBe(200);
  });

  test("rejects a foreign origin", async () => {
    const { app, upgrade } = await socket();
    const response = await app.request(`http://${host}/api/presence`, {
      headers: { ...upgrade, origin: "http://evil.example" },
    });
    expect(response.status).toBe(403);
  });

  test("rejects a missing origin", async () => {
    const { app, upgrade } = await socket();
    const response = await app.request(`http://${host}/api/presence`, {
      headers: upgrade,
    });
    expect(response.status).toBe(403);
  });

  test("rejects a missing session", async () => {
    const { app } = await socket();
    const response = await app.request(`http://${host}/api/presence`, {
      headers: { host, upgrade: "websocket", origin: `http://${host}` },
    });
    expect(response.status).toBe(401);
  });

  test("keeps the strict check on other routes", async () => {
    const { app, upgrade } = await socket();
    const response = await app.request(`http://${host}/api/summary`, {
      headers: { ...upgrade, origin: `http://${host}` },
    });
    expect(response.status).toBe(403);
  });

  test("keeps the strict check for normal requests to the route", async () => {
    const { app, cookie } = await socket();
    const response = await app.request(`http://${host}/api/presence`, {
      headers: { host, cookie, origin: `http://${host}` },
    });
    expect(response.status).toBe(403);
  });
});
