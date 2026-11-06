import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimInstance } from "../src/server/instance.ts";

function lockPath(): string {
  return join(mkdtempSync(join(tmpdir(), "bookkeeping-")), "instance.json");
}

const VERSION = "1.0.0";
const fast = {
  version: VERSION,
  startupWaitMs: 50,
  requestTimeoutMs: 100,
  updateWaitMs: 400,
};
const handlers = (open: () => string, stop: () => boolean = () => true) => ({
  open,
  stop,
});

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
    first.publish(
      handlers(() => {
        opened += 1;
        return "http://127.0.0.1:1/?token=fresh";
      }),
    );
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
    first.publish(handlers(() => ""));
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
    claim.publish(handlers(() => ""));
    claim.release();
    expect(existsSync(path)).toBe(false);
  });

  test("rejects a control request without the token", async () => {
    const path = lockPath();
    const claim = await claimed(path);
    claim.publish(handlers(() => "secret-url"));
    const { port } = JSON.parse(await Bun.file(path).text());
    const response = await fetch(`http://127.0.0.1:${port}/open`, {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
    });
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("");
    claim.release();
  });

  test("replaces an instance of another version", async () => {
    const path = lockPath();
    const old = await claimed(path);
    let stopped = 0;
    old.publish(
      handlers(
        () => "old",
        () => {
          stopped += 1;
          old.release();
          return true;
        },
      ),
    );
    const next = await claimInstance(path, { ...fast, version: "2.0.0" });
    expect(stopped).toBe(1);
    expect(next.kind).toBe("claimed");
    if (next.kind === "claimed") {
      next.release();
    }
  });

  test("keeps a busy older instance and opens it instead", async () => {
    const path = lockPath();
    const old = await claimed(path);
    old.publish(
      handlers(
        () => "still-old",
        () => false,
      ),
    );
    expect(await claimInstance(path, { ...fast, version: "2.0.0" })).toEqual({
      kind: "running",
      url: "still-old",
    });
    old.release();
  });

  test("never signals a process that is not this app", async () => {
    const path = lockPath();
    const old = await claimed(path);
    old.publish(handlers(() => "legacy-tab"));
    const record = JSON.parse(await Bun.file(path).text());
    writeFileSync(path, JSON.stringify({ ...record, version: undefined }));
    expect(
      await claimInstance(path, {
        ...fast,
        isOwnProcess: () => false,
      }),
    ).toEqual({ kind: "running", url: "legacy-tab" });
    old.release();
  });
});
