import { isIP } from "node:net";
import { connect } from "node:tls";

export interface NodeTarget {
  url: string;
  host: string;
  port: number;
  tls: boolean;
}

interface NodeInfo {
  status?: string;
  synchronized?: boolean;
  nettype?: string;
  height?: number;
}

export type NodeFetch = (url: string) => Promise<NodeInfo>;

const MAX_BLOCKS_BEHIND = 5;
const PROBE_TIMEOUT_MS = 8000;

export function parseNode(url: string): NodeTarget {
  const parsed = new URL(url);
  const tls = parsed.protocol === "https:";
  return {
    url,
    host: parsed.hostname,
    port: Number(parsed.port) || (tls ? 443 : 80),
    tls,
  };
}

async function fetchInfo(url: string): Promise<NodeInfo> {
  const response = await fetch(`${url}/get_info`, {
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  return (await response.json()) as NodeInfo;
}

export async function pickNodes(
  urls: string[],
  load: NodeFetch = fetchInfo,
): Promise<NodeTarget[]> {
  const probes = await Promise.all(
    urls.map(async (url) => {
      try {
        const info = await load(url);
        const healthy =
          info.status === "OK" &&
          info.synchronized === true &&
          info.nettype === "mainnet";
        return healthy ? { url, height: info.height ?? 0 } : null;
      } catch {
        return null;
      }
    }),
  );
  const healthy = probes.flatMap((probe) => (probe ? [probe] : []));
  const tip = Math.max(0, ...healthy.map((probe) => probe.height));
  const usable = healthy.filter(
    (probe) => tip - probe.height <= MAX_BLOCKS_BEHIND,
  );
  if (usable.length === 0) {
    throw new Error("Kein Monero-Node erreichbar. Prüfe die Node-Liste.");
  }
  return usable.map((probe) => parseNode(probe.url));
}

export function certificateFingerprint(node: NodeTarget): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(
      {
        host: node.host,
        port: node.port,
        rejectUnauthorized: true,
        ...(isIP(node.host) ? {} : { servername: node.host }),
      },
      () => {
        const { fingerprint256 } = socket.getPeerCertificate();
        socket.destroy();
        resolve(fingerprint256.replaceAll(":", "").toLowerCase());
      },
    );
    socket.setTimeout(PROBE_TIMEOUT_MS, () => {
      socket.destroy();
      reject(new Error(`${node.host} antwortet nicht.`));
    });
    socket.on("error", reject);
  });
}

export function daemonTlsArgs(fingerprint: string | null): string[] {
  return fingerprint
    ? [
        "--daemon-ssl=enabled",
        `--daemon-ssl-allowed-fingerprints=${fingerprint}`,
      ]
    : ["--daemon-ssl=disabled"];
}
