import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Paths } from "../paths.ts";
import type { SecretStore } from "../secrets.ts";
import { randomToken } from "../security.ts";
import { ensureWalletRpc } from "./bundle.ts";
import type { MoneroRow } from "./csv.ts";
import type { NodeTarget } from "./nodes.ts";
import { certificateFingerprint, daemonTlsArgs, pickNodes } from "./nodes.ts";
import { WalletRpc, WalletRpcError } from "./rpc.ts";

const WALLET_NAME = "bookkeeping-view";
const NO_NODE_MESSAGE = "Kein Monero-Node erreichbar. Prüfe die Node-Liste.";
const MIN_CONFIRMATIONS = 10;
const START_TIMEOUT_MS = 30000;
const STOP_TIMEOUT_MS = 10000;
const RPC_USER = "bookkeeping";
const NO_DAEMON = -38;
const REFRESH_TIMEOUT_MS = 30 * 60 * 1000;

export interface WalletKeys {
  address: string;
  viewKey: string;
  restoreHeight: number;
}

export interface WalletBackend {
  create(keys: WalletKeys, nodes: string[]): Promise<void>;
  fetchIncoming(nodes: string[]): Promise<MoneroRow[]>;
  remove(): void;
}

interface Transfer {
  txid: string;
  amount: number;
  timestamp: number;
  confirmations?: number;
  locked?: boolean;
  note?: string;
  subaddr_index?: { major: number; minor: number };
}

interface TransfersResult {
  in?: Transfer[];
}

function freePort(): number {
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data() {} },
  });
  const { port } = listener;
  listener.stop(true);
  return port;
}

const running = new Set<Bun.Subprocess>();

export function stopWalletProcesses(): void {
  for (const child of running) {
    child.kill();
  }
}

export function incomingRows(transfers: Transfer[]): MoneroRow[] {
  return transfers
    .filter(
      (transfer) =>
        !transfer.locked && (transfer.confirmations ?? 0) >= MIN_CONFIRMATIONS,
    )
    .map((transfer) => ({
      txid: transfer.txid,
      occurredAt: transfer.timestamp,
      atomic: String(transfer.amount),
      label: "",
      note: transfer.note ?? "",
    }));
}

export class MoneroWallet implements WalletBackend {
  private readonly dir: string;

  constructor(
    private readonly paths: Paths,
    private readonly secrets: SecretStore,
  ) {
    this.dir = join(paths.home, "monero");
  }

  private async withRpc<T>(
    nodes: string[],
    action: (rpc: WalletRpc) => Promise<T>,
  ): Promise<T> {
    const candidates = await pickNodes(nodes);
    const binary = await ensureWalletRpc(join(this.paths.home, "bin"));
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    for (const [index, node] of candidates.entries()) {
      try {
        return await this.runOnNode(node, binary, action);
      } catch (error) {
        const lastNode = index === candidates.length - 1;
        const noDaemon =
          error instanceof WalletRpcError && error.code === NO_DAEMON;
        if (!noDaemon || lastNode) {
          throw noDaemon ? new Error(NO_NODE_MESSAGE) : error;
        }
      }
    }
    throw new Error(NO_NODE_MESSAGE);
  }

  private async runOnNode<T>(
    node: NodeTarget,
    binary: string,
    action: (rpc: WalletRpc) => Promise<T>,
  ): Promise<T> {
    const fingerprint = node.tls ? await certificateFingerprint(node) : null;
    const password = randomToken();
    const port = freePort();
    const config = join(this.dir, `rpc-${port}.conf`);
    writeFileSync(config, `rpc-login=${RPC_USER}:${password}\n`, {
      mode: 0o600,
    });

    const child = Bun.spawn(
      [
        binary,
        `--config-file=${config}`,
        `--wallet-dir=${this.dir}`,
        "--rpc-bind-ip=127.0.0.1",
        `--rpc-bind-port=${port}`,
        `--daemon-address=${node.host}:${node.port}`,
        ...daemonTlsArgs(fingerprint),
        "--untrusted-daemon",
        "--non-interactive",
        "--log-level=0",
        `--log-file=${join(this.dir, "wallet-rpc.log")}`,
        "--max-log-file-size=1000000",
      ],
      { stdout: "ignore", stderr: "ignore", stdin: "ignore" },
    );
    running.add(child);

    const rpc = new WalletRpc(`http://127.0.0.1:${port}`, RPC_USER, password);
    try {
      await this.waitUntilReady(rpc, child);
      const result = await action(rpc);
      await rpc.call("store").catch(() => undefined);
      await rpc.call("stop_wallet").catch(() => undefined);
      await Promise.race([child.exited, Bun.sleep(STOP_TIMEOUT_MS)]);
      return result;
    } finally {
      child.kill();
      running.delete(child);
      rmSync(config, { force: true });
    }
  }

  private async waitUntilReady(
    rpc: WalletRpc,
    child: Bun.Subprocess,
  ): Promise<void> {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error("Das Monero-Programm konnte nicht gestartet werden.");
      }
      try {
        await rpc.call("get_version");
        return;
      } catch (error) {
        if (error instanceof WalletRpcError) {
          throw error;
        }
        await Bun.sleep(250);
      }
    }
    throw new Error("Das Monero-Programm antwortet nicht.");
  }

  private walletPassword(): string {
    const stored = this.secrets.read().moneroWalletPassword;
    if (stored) {
      return stored;
    }
    const created = randomToken();
    this.secrets.update({ moneroWalletPassword: created });
    return created;
  }

  async create(keys: WalletKeys, nodes: string[]): Promise<void> {
    this.remove();
    await this.withRpc(nodes, async (rpc) => {
      await rpc.call("generate_from_keys", {
        filename: WALLET_NAME,
        address: keys.address,
        viewkey: keys.viewKey,
        restore_height: keys.restoreHeight,
        password: this.walletPassword(),
        autosave_current: true,
      });
      if (!existsSync(join(this.dir, `${WALLET_NAME}.keys`))) {
        throw new Error("Das Wallet konnte nicht angelegt werden.");
      }
      if (await this.canSpend(rpc)) {
        throw new Error("Das Wallet darf keine Zahlungen ausführen können.");
      }
    }).catch((error) => {
      this.remove();
      throw error;
    });
  }

  private async canSpend(rpc: WalletRpc): Promise<boolean> {
    const result = await rpc
      .call<{ key: string }>("query_key", { key_type: "spend_key" })
      .catch(() => null);
    return result !== null && /[1-9a-f]/i.test(result.key);
  }

  fetchIncoming(nodes: string[]): Promise<MoneroRow[]> {
    return this.withRpc(nodes, async (rpc) => {
      await rpc.call("open_wallet", {
        filename: WALLET_NAME,
        password: this.walletPassword(),
      });
      if (await this.canSpend(rpc)) {
        throw new Error("Das Wallet darf keine Zahlungen ausführen können.");
      }
      await Promise.race([
        rpc.call("refresh"),
        Bun.sleep(REFRESH_TIMEOUT_MS).then(() => {
          throw new Error("Die Synchronisierung dauert zu lange.");
        }),
      ]);
      const transfers = await rpc.call<TransfersResult>("get_transfers", {
        in: true,
        all_accounts: true,
      });
      return incomingRows(transfers.in ?? []);
    });
  }

  remove(): void {
    if (!existsSync(this.dir)) {
      return;
    }
    for (const file of readdirSync(this.dir)) {
      if (file.startsWith(WALLET_NAME)) {
        rmSync(join(this.dir, file), { force: true });
      }
    }
  }
}
