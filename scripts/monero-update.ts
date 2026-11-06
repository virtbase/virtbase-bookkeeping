import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

export const SIGNING_KEY_FINGERPRINT =
  "81AC591FE9C4B65C5806AFC3F0AF4D462A0BDF92";
const SIGNING_KEY_FILE = "packaging/keys/binaryfate.asc";
const BUNDLE_FILE = "src/server/monero/bundle.ts";
const RELEASE_API =
  "https://api.github.com/repos/monero-project/monero/releases/latest";
const HASHES_URL = "https://www.getmonero.org/downloads/hashes.txt";

export function parseTag(tag: string): string {
  const match = /^v(\d+\.\d+\.\d+\.\d+)$/.exec(tag);
  if (!match?.[1]) {
    throw new Error(`Unexpected Monero release tag: ${tag}`);
  }
  return match[1];
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const left = candidate.split(".").map(Number);
  const right = current.split(".").map(Number);
  for (const [index, value] of left.entries()) {
    const other = right[index] ?? 0;
    if (value !== other) {
      return value > other;
    }
  }
  return false;
}

export function findArchiveHash(signedText: string, version: string): string {
  const file = `monero-linux-x64-v${version}.tar.bz2`;
  const line = signedText
    .split("\n")
    .find((entry) => entry.trim().endsWith(`  ${file}`));
  const hash = line?.trim().split(/\s+/)[0];
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error(`No signed checksum for ${file}`);
  }
  return hash;
}

export function assertSignature(status: string): void {
  const signed = status
    .split("\n")
    .find((line) => line.includes(" VALIDSIG "))
    ?.trim()
    .split(/\s+/)
    .at(-1);
  if (signed !== SIGNING_KEY_FINGERPRINT) {
    throw new Error("hashes.txt is not signed by the pinned Monero key");
  }
}

export function rewriteBundle(
  source: string,
  version: string,
  archiveHash: string,
  binaryHash: string,
): string {
  const replace = (text: string, pattern: RegExp, value: string) => {
    if (!pattern.test(text)) {
      throw new Error(`Could not update ${BUNDLE_FILE}`);
    }
    return text.replace(pattern, value);
  };
  const withVersion = replace(
    source,
    /MONERO_VERSION = "[^"]+"/,
    `MONERO_VERSION = "${version}"`,
  );
  const withArchive = replace(
    withVersion,
    /(MONERO_ARCHIVE_SHA256 =\s*")[0-9a-f]{64}"/,
    `$1${archiveHash}"`,
  );
  return replace(
    withArchive,
    /(WALLET_RPC_SHA256 =\s*")[0-9a-f]{64}"/,
    `$1${binaryHash}"`,
  );
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

async function latestVersion(): Promise<string> {
  const token = process.env.GH_TOKEN;
  const response = await fetch(RELEASE_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "virtbase-bookkeeping",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Monero release lookup failed: ${response.status}`);
  }
  const { tag_name: tag } = (await response.json()) as { tag_name: string };
  return parseTag(tag);
}

async function verifiedHashes(work: string): Promise<string> {
  const home = join(work, "gnupg");
  const signed = join(work, "hashes.txt");
  const plain = join(work, "hashes.plain.txt");
  const response = await fetch(HASHES_URL);
  if (!response.ok) {
    throw new Error(`hashes.txt download failed: ${response.status}`);
  }
  await Bun.write(signed, response);
  mkdirSync(home, { mode: 0o700 });
  await $`gpg --homedir ${home} --batch --quiet --import ${SIGNING_KEY_FILE}`.quiet();
  const verify =
    await $`gpg --homedir ${home} --batch --status-fd 1 --verify ${signed}`
      .quiet()
      .text();
  assertSignature(verify);
  await $`gpg --homedir ${home} --batch --quiet --output ${plain} --decrypt ${signed}`.quiet();
  return readFileSync(plain, "utf8");
}

async function verifiedBinaryHash(
  work: string,
  version: string,
  archiveHash: string,
): Promise<string> {
  const archive = join(work, "monero.tar.bz2");
  const url = `https://downloads.getmonero.org/cli/monero-linux-x64-v${version}.tar.bz2`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Monero download failed: ${response.status}`);
  }
  await Bun.write(archive, response);
  if (sha256(readFileSync(archive)) !== archiveHash) {
    throw new Error("Monero archive does not match the signed checksum");
  }
  await $`tar -xjf ${archive} -C ${work} --strip-components=1 --wildcards ${"*/monero-wallet-rpc"}`.quiet();
  const binary = join(work, "monero-wallet-rpc");
  const reported = await $`${binary} --version`.quiet().text();
  if (!reported.includes(version)) {
    throw new Error(`Unexpected wallet version: ${reported.trim()}`);
  }
  return sha256(readFileSync(binary));
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const source = readFileSync(BUNDLE_FILE, "utf8");
  const current = /MONERO_VERSION = "([^"]+)"/.exec(source)?.[1] ?? "0";
  const latest = await latestVersion();
  const outputs = process.env.GITHUB_OUTPUT;
  if (!force && !isNewerVersion(latest, current)) {
    console.log(`Monero ${current} is up to date.`);
    return;
  }
  const work = mkdtempSync(join(tmpdir(), "monero-update-"));
  try {
    const archiveHash = findArchiveHash(await verifiedHashes(work), latest);
    const binaryHash = await verifiedBinaryHash(work, latest, archiveHash);
    writeFileSync(
      BUNDLE_FILE,
      rewriteBundle(source, latest, archiveHash, binaryHash),
    );
    console.log(`Verified Monero ${latest}.`);
    if (outputs) {
      appendFileSync(outputs, `version=${latest}\n`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await main();
}
