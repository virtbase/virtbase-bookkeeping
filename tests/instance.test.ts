import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimInstance } from "../src/server/instance.ts";

function lockPath(): string {
  return join(mkdtempSync(join(tmpdir(), "bookkeeping-")), "instance.json");
}

const fast = { startupWaitMs: 50, requestTimeoutMs: 100 };

async function claimed(path: string) {
  const claim = await claimInstance(path, fast);
  if (claim.kind !== "claimed") {
    throw new Error("expected a claim");
  }
  return claim;
}

describe("claimInstance", () => {
  test("hands a second launch to the running instance", async () => {
    const path = lockPath();
    const first = await claimed(path);
    let opened = 0;
    first.publish(() => {
      opened += 1;
      return "http://127.0.0.1:1/?token=fresh";
    });
    expect(await claimInstance(path, fast)).toEqual({
      kind: "running",
      url: "http://127.0.0.1:1/?token=fresh",
    });
    expect(opened).toBe(1);
    first.release();
  });

  test("keeps the record private", async () => {
    const path = lockPath();
    const first = await claimed(path);
    first.publish(() => "");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    first.release();
  });

  test("takes over after a crash", async () => {
    const path = lockPath();
    writeFileSync(path, JSON.stringify({ pid: 1, port: 1, token: "old" }));
    const claim = await claimed(path);
    claim.release();
  });

  test("takes over from a process that is gone", async () => {
    const path = lockPath();
    writeFileSync(path, JSON.stringify({ pid: 2 ** 22 + 1 }));
    (await claimed(path)).release();
  });

  test("survives a damaged record", async () => {
    const path = lockPath();
    writeFileSync(path, "{");
    (await claimed(path)).release();
  });

  test("gives up waiting for an instance that never finishes starting", async () => {
    const path = lockPath();
    writeFileSync(path, JSON.stringify({ pid: process.pid }));
    (await claimed(path)).release();
  });

  test("removes the record on release", async () => {
    const path = lockPath();
    const claim = await claimed(path);
    claim.publish(() => "");
    claim.release();
    expect(existsSync(path)).toBe(false);
  });

  test("rejects a control request without the token", async () => {
    const path = lockPath();
    const claim = await claimed(path);
    claim.publish(() => "secret-url");
    const { port } = JSON.parse(await Bun.file(path).text());
    const response = await fetch(`http://127.0.0.1:${port}/open`, {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
    });
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("");
    claim.release();
  });
});
