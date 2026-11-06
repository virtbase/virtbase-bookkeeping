import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { debianVersion, renderControl } from "../scripts/packaging/deb.ts";
import { bundledPackages } from "../scripts/packaging/licenses.ts";
import {
  renderCopyright,
  renderDesktopEntry,
} from "../scripts/packaging/linux.ts";
import { PRODUCT } from "../scripts/packaging/product.ts";
import { TARGETS } from "../scripts/packaging/targets.ts";
import { preferred } from "../src/server/folder-dialog.ts";
import {
  moneroPlatform,
  moneroPlatformKey,
} from "../src/server/monero/bundle.ts";
import { openCommand } from "../src/server/platform.ts";

const root = resolve(import.meta.dir, "..");

describe("targets", () => {
  test("have unique ids", () => {
    const ids = TARGETS.map((target) => target.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("platforms", () => {
  test("every target has a verified Monero entry", () => {
    for (const target of TARGETS) {
      const { archiveSha256, walletRpcSha256 } = moneroPlatform(
        target.platform,
      );
      expect(archiveSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(archiveSha256).not.toMatch(/^0+$/);
      expect(walletRpcSha256).not.toMatch(/^0+$/);
    }
  });

  test("names packages per architecture", () => {
    const names = TARGETS.map((target) => target.fileName(PRODUCT, target));
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain(
      `virtbase-bookkeeping_${PRODUCT.version}_arm64.deb`,
    );
    expect(names).toContain(
      `virtbase-bookkeeping_${PRODUCT.version}_darwin-arm64.tar.gz`,
    );
  });

  test("opens files with the system command", () => {
    expect(openCommand("/tmp/a", "linux")).toEqual(["xdg-open", "/tmp/a"]);
    expect(openCommand("/tmp/a", "darwin")).toEqual(["open", "/tmp/a"]);
  });

  test("uses the native folder dialog on macOS", () => {
    expect(preferred("darwin").map((dialog) => dialog.command)).toEqual([
      "osascript",
    ]);
    expect(preferred("linux").map((dialog) => dialog.command)).toContain(
      "zenity",
    );
  });
});

describe("debian package", () => {
  test("sorts prereleases before the final version", () => {
    expect(debianVersion("0.2.0")).toBe("0.2.0");
    expect(debianVersion("0.2.0-rc1")).toBe("0.2.0~rc1");
  });

  test("writes the required control fields", () => {
    const control = renderControl(PRODUCT, "amd64", 1234);
    expect(control).toContain("Package: virtbase-bookkeeping\n");
    expect(control).toContain(`Version: ${PRODUCT.version}\n`);
    expect(control).toContain("Architecture: amd64\n");
    expect(control).toContain(`Maintainer: ${PRODUCT.maintainer}\n`);
    expect(control).toContain("Installed-Size: 1234\n");
    expect(control).toContain("Depends: libc6 (>= 2.25), xdg-utils\n");
  });

  test("wraps the long description", () => {
    const lines = renderControl(PRODUCT, "amd64", 1).trimEnd().split("\n");
    const description = lines.slice(
      lines.findIndex((line) => line.startsWith("Description:")) + 1,
    );
    expect(description.length).toBeGreaterThan(1);
    expect(description.every((line) => line.startsWith(" "))).toBe(true);
    expect(description.every((line) => line.length <= 79)).toBe(true);
  });
});

describe("linux layout", () => {
  test("starts the installed command", () => {
    const entry = renderDesktopEntry(PRODUCT);
    expect(entry).toContain("Exec=virtbase-bookkeeping\n");
    expect(entry).toContain("Icon=virtbase-bookkeeping\n");
    expect(entry).toContain("Terminal=false\n");
  });

  test("lists the licenses of bundled software", () => {
    const copyright = renderCopyright(PRODUCT, root, moneroPlatformKey());
    expect(copyright).toContain("MIT License");
    expect(copyright).toContain("Bun itself is MIT-licensed");
    expect(copyright).toContain("The Monero Project");
    expect(copyright).toContain("react ");
  });

  test("includes transitive packages", () => {
    const names = bundledPackages(root).map((entry) => entry.name);
    expect(names).toContain("react");
    expect(names).toContain("scheduler");
  });
});
