import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import {
  moneroArchiveUrl,
  moneroPlatform,
  moneroPlatformKey,
} from "../src/server/monero/bundle.ts";

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export async function extractFromArchive(
  archive: string,
  target: string,
  files: string[],
): Promise<void> {
  const listing = await $`tar -tjf ${archive}`.quiet().text();
  const members = listing
    .split("\n")
    .filter((member) => files.includes(member.split("/").at(-1) ?? ""));
  await $`tar -xjf ${archive} -C ${target} --strip-components=1 ${members}`.quiet();
}

export async function fetchMonero(key: string): Promise<string> {
  const { archiveSha256, walletRpcSha256 } = moneroPlatform(key);
  const vendor = join("vendor/monero", key);
  const binary = join(vendor, "monero-wallet-rpc");
  if (existsSync(binary) && sha256(binary) === walletRpcSha256) {
    return vendor;
  }

  const work = mkdtempSync(join(tmpdir(), "monero-cli-"));
  try {
    const archive = join(work, "monero.tar.bz2");
    console.log(`Monero CLI für ${key} wird geladen...`);
    const response = await fetch(moneroArchiveUrl(key));
    if (!response.ok) {
      throw new Error(`Download fehlgeschlagen: ${response.status}`);
    }
    await Bun.write(archive, response);
    if (sha256(archive) !== archiveSha256) {
      throw new Error("Prüfsumme des Monero-Archivs stimmt nicht.");
    }
    await extractFromArchive(archive, work, ["monero-wallet-rpc", "LICENSE"]);
    const extracted = join(work, "monero-wallet-rpc");
    if (sha256(extracted) !== walletRpcSha256) {
      throw new Error("Prüfsumme von monero-wallet-rpc stimmt nicht.");
    }
    mkdirSync(vendor, { recursive: true });
    cpSync(extracted, binary);
    cpSync(join(work, "LICENSE"), join(vendor, "LICENSE"));
    chmodSync(binary, 0o755);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return vendor;
}

if (import.meta.main) {
  await fetchMonero(process.argv[2] ?? moneroPlatformKey());
}
