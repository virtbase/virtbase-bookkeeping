import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const MONERO_VERSION = "0.18.5.4";
export const MONERO_ARCHIVE_URL = `https://downloads.getmonero.org/cli/monero-linux-x64-v${MONERO_VERSION}.tar.bz2`;
export const MONERO_ARCHIVE_SHA256 =
  "ba2928962c101b609434bf8c1b43ad59ebe96c5525977284ca599d8bf0f02d10";
export const WALLET_RPC_SHA256 =
  "06f36de37bda72ff377c11700ba622fef435d27510c883e9c83a27ba3c46ba1f";
export const WALLET_RPC_ASSET = "monero-wallet-rpc.asset";

const VENDOR_BINARY = join(
  import.meta.dir,
  "../../../vendor/monero/monero-wallet-rpc",
);

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

async function bundledBytes(): Promise<Uint8Array | null> {
  const embedded = Bun.embeddedFiles.find((file) =>
    (file as Blob & { name?: string }).name?.endsWith(WALLET_RPC_ASSET),
  );
  if (embedded) {
    return new Uint8Array(await embedded.arrayBuffer());
  }
  return existsSync(VENDOR_BINARY) ? readFileSync(VENDOR_BINARY) : null;
}

export async function ensureWalletRpc(binDir: string): Promise<string> {
  const target = join(binDir, `monero-wallet-rpc-${MONERO_VERSION}`);
  if (
    existsSync(target) &&
    sha256(readFileSync(target)) === WALLET_RPC_SHA256
  ) {
    return target;
  }
  const bytes = await bundledBytes();
  if (!bytes) {
    throw new Error(
      "Das Monero-Programm fehlt. Starte die App mit bun run start oder baue sie mit bun run compile.",
    );
  }
  if (sha256(bytes) !== WALLET_RPC_SHA256) {
    throw new Error("Das Monero-Programm ist beschädigt oder wurde verändert.");
  }
  mkdirSync(binDir, { recursive: true, mode: 0o700 });
  rmSync(target, { force: true });
  writeFileSync(target, bytes, { mode: 0o700 });
  chmodSync(target, 0o700);
  return target;
}
