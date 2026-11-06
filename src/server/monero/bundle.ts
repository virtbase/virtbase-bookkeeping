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
export const WALLET_RPC_ASSET = "monero-wallet-rpc.asset";

export interface MoneroPlatform {
  archive: string;
  archiveSha256: string;
  walletRpcSha256: string;
}

export const MONERO_PLATFORMS: Record<string, MoneroPlatform> = {
  "linux-x64": {
    archive: "monero-linux-x64",
    archiveSha256:
      "ba2928962c101b609434bf8c1b43ad59ebe96c5525977284ca599d8bf0f02d10",
    walletRpcSha256:
      "06f36de37bda72ff377c11700ba622fef435d27510c883e9c83a27ba3c46ba1f",
  },
  "linux-arm64": {
    archive: "monero-linux-armv8",
    archiveSha256:
      "d20d71e6522b41eb8e549c3425f7f4622c9c9a448fc7147525393fd0a6b59703",
    walletRpcSha256:
      "4bb812f203389245a5e3f58fc14e128ee8f7cd3781567b13ad8f4e48b00fd890",
  },
  "darwin-arm64": {
    archive: "monero-mac-armv8",
    archiveSha256:
      "d457de7c8a1ad42e3232fdea6d9f9003be9652143fb8f719c1fc906aa6b4917b",
    walletRpcSha256:
      "1db145642a0eaafeb3a502f9a09cbb8bfef85f443587193c613bba00a9105fba",
  },
};

export function moneroPlatformKey(
  platform: string = process.platform,
  arch: string = process.arch,
): string {
  return `${platform}-${arch}`;
}

export function moneroPlatform(key = moneroPlatformKey()): MoneroPlatform {
  const entry = MONERO_PLATFORMS[key];
  if (!entry) {
    throw new Error(`Monero wird auf ${key} nicht unterstützt.`);
  }
  return entry;
}

export function moneroArchiveUrl(key: string): string {
  const { archive } = moneroPlatform(key);
  return `https://downloads.getmonero.org/cli/${archive}-v${MONERO_VERSION}.tar.bz2`;
}

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
  const vendored = join(
    import.meta.dir,
    "../../../vendor/monero",
    moneroPlatformKey(),
    "monero-wallet-rpc",
  );
  return existsSync(vendored) ? readFileSync(vendored) : null;
}

export async function ensureWalletRpc(binDir: string): Promise<string> {
  const { walletRpcSha256 } = moneroPlatform();
  const target = join(binDir, `monero-wallet-rpc-${MONERO_VERSION}`);
  if (existsSync(target) && sha256(readFileSync(target)) === walletRpcSha256) {
    return target;
  }
  const bytes = await bundledBytes();
  if (!bytes) {
    throw new Error(
      "Das Monero-Programm fehlt. Starte die App mit bun run start oder baue sie mit bun run compile.",
    );
  }
  if (sha256(bytes) !== walletRpcSha256) {
    throw new Error("Das Monero-Programm ist beschädigt oder wurde verändert.");
  }
  mkdirSync(binDir, { recursive: true, mode: 0o700 });
  rmSync(target, { force: true });
  writeFileSync(target, bytes, { mode: 0o700 });
  chmodSync(target, 0o700);
  return target;
}
