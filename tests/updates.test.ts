import { describe, expect, test } from "bun:test";
import { openDatabase } from "../src/server/db/client.ts";
import { readUpdateCheck } from "../src/server/settings.ts";
import {
  availableUpdate,
  checkForUpdate,
  isNewer,
  parseRelease,
} from "../src/server/updates.ts";

const DAY = 86400;
const NOW = 1793900000;
const release = (tag: string) => ({
  tag_name: tag,
  html_url: `https://github.com/virtbase/virtbase-bookkeeping/releases/tag/${tag}`,
});
const answer = (body: unknown, status = 200) => {
  let calls = 0;
  return {
    source: async () => {
      calls += 1;
      return Response.json(body, { status });
    },
    calls: () => calls,
  };
};

describe("isNewer", () => {
  test("compares numbers, not text", () => {
    expect(isNewer("0.10.0", "0.9.0")).toBe(true);
    expect(isNewer("1.0.0", "0.9.9")).toBe(true);
    expect(isNewer("0.2.1", "0.2.0")).toBe(true);
  });

  test("ignores the same or an older version", () => {
    expect(isNewer("0.2.0", "0.2.0")).toBe(false);
    expect(isNewer("0.1.9", "0.2.0")).toBe(false);
  });

  test("ignores names that are no version", () => {
    expect(isNewer("nightly", "0.2.0")).toBe(false);
    expect(isNewer("0.3.0-rc1", "0.2.0")).toBe(false);
  });
});

describe("parseRelease", () => {
  test("reads tag and page", () => {
    expect(parseRelease(release("v0.3.0"))).toEqual({
      version: "0.3.0",
      url: "https://github.com/virtbase/virtbase-bookkeeping/releases/tag/v0.3.0",
    });
  });

  test("accepts only links to GitHub", () => {
    expect(
      parseRelease({ tag_name: "v0.3.0", html_url: "https://evil.example/x" }),
    ).toBeNull();
    expect(
      parseRelease({ tag_name: "v0.3.0", html_url: "javascript:alert(1)" }),
    ).toBeNull();
  });

  test("survives unexpected answers", () => {
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease({ message: "Not Found" })).toBeNull();
  });
});

describe("checkForUpdate", () => {
  const fresh = () => openDatabase(":memory:");

  test("reports a newer release", async () => {
    const db = fresh();
    await checkForUpdate(db, NOW, answer(release("v9.0.0")).source);
    expect(availableUpdate(db, "0.2.0")?.version).toBe("9.0.0");
  });

  test("stays quiet on the installed version", async () => {
    const db = fresh();
    await checkForUpdate(db, NOW, answer(release("v0.2.0")).source);
    expect(availableUpdate(db, "0.2.0")).toBeNull();
  });

  test("stops hinting after the update was installed", async () => {
    const db = fresh();
    await checkForUpdate(db, NOW, answer(release("v0.3.0")).source);
    expect(availableUpdate(db, "0.3.0")).toBeNull();
  });

  test("asks once a day", async () => {
    const db = fresh();
    const feed = answer(release("v0.3.0"));
    await checkForUpdate(db, NOW, feed.source);
    await checkForUpdate(db, NOW + DAY - 1, feed.source);
    expect(feed.calls()).toBe(1);
    await checkForUpdate(db, NOW + DAY, feed.source);
    expect(feed.calls()).toBe(2);
  });

  test("treats a private repository as no release", async () => {
    const db = fresh();
    await checkForUpdate(db, NOW, answer({ message: "Not Found" }, 404).source);
    expect(availableUpdate(db, "0.2.0")).toBeNull();
    expect(readUpdateCheck(db).checkedAt).toBe(NOW);
  });

  test("retries soon when offline and keeps the known release", async () => {
    const db = fresh();
    await checkForUpdate(db, NOW, answer(release("v9.0.0")).source);
    const offline = async (): Promise<Response> => {
      throw new Error("offline");
    };
    await checkForUpdate(db, NOW + DAY, offline);
    expect(readUpdateCheck(db).checkedAt).toBe(NOW);
    expect(availableUpdate(db, "0.2.0")?.version).toBe("9.0.0");
  });

  test("survives broken JSON", async () => {
    const db = fresh();
    const broken = async () => new Response("<html>");
    await expect(checkForUpdate(db, NOW, broken)).resolves.toBeUndefined();
  });
});
