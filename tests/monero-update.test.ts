import { describe, expect, test } from "bun:test";
import {
  assertSignature,
  findArchiveHash,
  isNewerVersion,
  parseTag,
  rewriteBundle,
  SIGNING_KEY_FINGERPRINT,
} from "../scripts/monero-update.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

describe("parseTag", () => {
  test("reads a release tag", () => {
    expect(parseTag("v0.18.5.4")).toBe("0.18.5.4");
  });

  test("rejects anything else", () => {
    expect(() => parseTag("v0.18.5")).toThrow();
    expect(() => parseTag("v0.18.5.4; rm -rf /")).toThrow();
  });
});

describe("isNewerVersion", () => {
  test("compares numbers", () => {
    expect(isNewerVersion("0.18.10.0", "0.18.9.0")).toBe(true);
    expect(isNewerVersion("0.19.0.0", "0.18.5.4")).toBe(true);
  });

  test("refuses the same or an older version", () => {
    expect(isNewerVersion("0.18.5.4", "0.18.5.4")).toBe(false);
    expect(isNewerVersion("0.18.5.3", "0.18.5.4")).toBe(false);
  });
});

describe("findArchiveHash", () => {
  const signed = `## CLI\n${HASH_A}  monero-linux-x64-v0.18.5.4.tar.bz2\n${HASH_B}  monero-win-x64-v0.18.5.4.zip\n`;

  test("finds the Linux archive", () => {
    expect(findArchiveHash(signed, "0.18.5.4")).toBe(HASH_A);
  });

  test("fails without an entry for the version", () => {
    expect(() => findArchiveHash(signed, "0.18.5.5")).toThrow("No signed");
  });
});

describe("assertSignature", () => {
  const status = (fingerprint: string) =>
    `[GNUPG:] GOODSIG 1 binaryFate\n[GNUPG:] VALIDSIG ABC 2026-10-16 1 0 4 0 1 8 01 ${fingerprint}\n`;

  test("accepts the pinned key", () => {
    expect(() =>
      assertSignature(status(SIGNING_KEY_FINGERPRINT)),
    ).not.toThrow();
  });

  test("rejects another key", () => {
    expect(() => assertSignature(status("DEADBEEF"))).toThrow("not signed");
  });

  test("rejects a bad signature", () => {
    expect(() => assertSignature("[GNUPG:] BADSIG 1 someone\n")).toThrow(
      "not signed",
    );
  });
});

describe("rewriteBundle", () => {
  const source = `export const MONERO_VERSION = "0.18.5.4";
export const MONERO_ARCHIVE_SHA256 =
  "${HASH_A}";
export const WALLET_RPC_SHA256 =
  "${HASH_A}";
`;

  test("updates version and both hashes", () => {
    const next = rewriteBundle(source, "0.18.6.0", HASH_B, "c".repeat(64));
    expect(next).toContain('MONERO_VERSION = "0.18.6.0"');
    expect(next).toContain(`MONERO_ARCHIVE_SHA256 =\n  "${HASH_B}"`);
    expect(next).toContain(`WALLET_RPC_SHA256 =\n  "${"c".repeat(64)}"`);
  });

  test("fails when the file no longer matches", () => {
    expect(() => rewriteBundle("nothing", "1", HASH_A, HASH_B)).toThrow(
      "Could not update",
    );
  });
});
