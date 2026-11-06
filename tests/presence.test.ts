import { describe, expect, mock, test } from "bun:test";
import { createPresence } from "../src/server/presence.ts";

const GRACE_MS = 20;
const LONGER = 60;

describe("createPresence", () => {
  test("stops when no tab ever connects", async () => {
    const onIdle = mock(() => {});
    createPresence({ graceMs: GRACE_MS, onIdle });
    await Bun.sleep(LONGER);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  test("keeps running while a tab is open", async () => {
    const onIdle = mock(() => {});
    const presence = createPresence({ graceMs: GRACE_MS, onIdle });
    const leave = presence.connect();
    await Bun.sleep(LONGER);
    expect(onIdle).not.toHaveBeenCalled();
    leave();
    await Bun.sleep(LONGER);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  test("survives a page reload", async () => {
    const onIdle = mock(() => {});
    const presence = createPresence({ graceMs: GRACE_MS, onIdle });
    const leave = presence.connect();
    leave();
    const again = presence.connect();
    await Bun.sleep(LONGER);
    expect(onIdle).not.toHaveBeenCalled();
    again();
  });

  test("waits for running work after the last tab closed", async () => {
    const onIdle = mock(() => {});
    const presence = createPresence({ graceMs: GRACE_MS, onIdle });
    const leave = presence.connect();
    const done = presence.begin();
    leave();
    await Bun.sleep(LONGER);
    expect(onIdle).not.toHaveBeenCalled();
    done();
    await Bun.sleep(LONGER);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  test("ignores a second release", async () => {
    const onIdle = mock(() => {});
    const presence = createPresence({ graceMs: GRACE_MS, onIdle });
    const first = presence.connect();
    const second = presence.connect();
    first();
    first();
    await Bun.sleep(LONGER);
    expect(onIdle).not.toHaveBeenCalled();
    second();
  });

  test("reports running work", () => {
    const presence = createPresence({ graceMs: GRACE_MS, onIdle: () => {} });
    expect(presence.isBusy()).toBe(false);
    const done = presence.begin();
    expect(presence.isBusy()).toBe(true);
    done();
    expect(presence.isBusy()).toBe(false);
  });
});
