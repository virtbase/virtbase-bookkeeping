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
  MONERO_ARCHIVE_SHA256,
  MONERO_ARCHIVE_URL,
  MONERO_VERSION,
  WALLET_RPC_SHA256,
} from "../src/server/monero/bundle.ts";

const vendor = "vendor/monero";
const binary = join(vendor, "monero-wallet-rpc");

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

if (existsSync(binary) && sha256(binary) === WALLET_RPC_SHA256) {
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), "monero-cli-"));
try {
  const archive = join(work, "monero.tar.bz2");
  console.log(`Monero CLI ${MONERO_VERSION} wird geladen...`);
  const response = await fetch(MONERO_ARCHIVE_URL);
  if (!response.ok) {
    throw new Error(`Download fehlgeschlagen: ${response.status}`);
  }
  await Bun.write(archive, response);
  if (sha256(archive) !== MONERO_ARCHIVE_SHA256) {
    throw new Error("Prüfsumme des Monero-Archivs stimmt nicht.");
  }
  await $`tar -xjf ${archive} -C ${work} --strip-components=1 --wildcards ${"*/monero-wallet-rpc"} ${"*/LICENSE"}`.quiet();
  const extracted = join(work, "monero-wallet-rpc");
  if (sha256(extracted) !== WALLET_RPC_SHA256) {
    throw new Error("Prüfsumme von monero-wallet-rpc stimmt nicht.");
  }
  mkdirSync(vendor, { recursive: true });
  cpSync(extracted, binary);
  cpSync(join(work, "LICENSE"), join(vendor, "LICENSE"));
  chmodSync(binary, 0o755);
} finally {
  rmSync(work, { recursive: true, force: true });
}
