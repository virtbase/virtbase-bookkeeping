import { createHash, randomBytes } from "node:crypto";

export interface DigestChallenge {
  realm: string;
  nonce: string;
  qop: string;
  opaque?: string;
}

export interface DigestInput {
  username: string;
  password: string;
  method: string;
  uri: string;
  cnonce: string;
  count: number;
  challenge: DigestChallenge;
}

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

export function digestResponse(input: DigestInput): string {
  const { challenge } = input;
  const nc = input.count.toString(16).padStart(8, "0");
  const ha1 = md5(`${input.username}:${challenge.realm}:${input.password}`);
  const ha2 = md5(`${input.method}:${input.uri}`);
  return md5(
    `${ha1}:${challenge.nonce}:${nc}:${input.cnonce}:${challenge.qop}:${ha2}`,
  );
}

export function parseChallenge(header: string): DigestChallenge | null {
  const entries = header.split(/(?=Digest\s)/).filter((part) => part.trim());
  const parsed = entries.map((entry) => {
    const fields: Record<string, string> = {};
    for (const match of entry.matchAll(/(\w+)=(?:"([^"]*)"|([^\s,]+))/g)) {
      const name = match[1];
      if (name) {
        fields[name.toLowerCase()] = match[2] ?? match[3] ?? "";
      }
    }
    return fields;
  });
  const chosen = parsed.find(
    (fields) => (fields.algorithm ?? "MD5").toUpperCase() === "MD5",
  );
  if (!chosen?.realm || !chosen.nonce) {
    return null;
  }
  return {
    realm: chosen.realm,
    nonce: chosen.nonce,
    qop: "auth",
    ...(chosen.opaque ? { opaque: chosen.opaque } : {}),
  };
}

export class WalletRpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

interface RpcResponse<T> {
  result?: T;
  error?: { code: number; message: string };
}

export class WalletRpc {
  private challenge: DigestChallenge | null = null;
  private count = 0;

  constructor(
    private readonly url: string,
    private readonly username: string,
    private readonly password: string,
  ) {}

  private authorization(): string | null {
    const { challenge } = this;
    if (!challenge) {
      return null;
    }
    this.count += 1;
    const cnonce = randomBytes(8).toString("hex");
    const uri = "/json_rpc";
    const nc = this.count.toString(16).padStart(8, "0");
    const response = digestResponse({
      username: this.username,
      password: this.password,
      method: "POST",
      uri,
      cnonce,
      count: this.count,
      challenge,
    });
    return [
      `Digest username="${this.username}"`,
      `realm="${challenge.realm}"`,
      `nonce="${challenge.nonce}"`,
      `uri="${uri}"`,
      "algorithm=MD5",
      `response="${response}"`,
      `qop=${challenge.qop}`,
      `nc=${nc}`,
      `cnonce="${cnonce}"`,
      ...(challenge.opaque ? [`opaque="${challenge.opaque}"`] : []),
    ].join(", ");
  }

  private send(body: string): Promise<Response> {
    const authorization = this.authorization();
    return fetch(`${this.url}/json_rpc`, {
      method: "POST",
      body,
      timeout: false,
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
    });
  }

  async call<T>(method: string, params: object = {}): Promise<T> {
    const body = JSON.stringify({ jsonrpc: "2.0", id: "0", method, params });
    let response = await this.send(body);
    if (response.status === 401) {
      this.challenge = parseChallenge(
        response.headers.get("www-authenticate") ?? "",
      );
      this.count = 0;
      response = await this.send(body);
    }
    if (!response.ok) {
      throw new WalletRpcError(`Wallet-RPC: Fehler ${response.status}`, 0);
    }
    const payload = (await response.json()) as RpcResponse<T>;
    if (payload.result === undefined) {
      throw new WalletRpcError(
        payload.error?.message || `${method} ist fehlgeschlagen.`,
        payload.error?.code ?? 0,
      );
    }
    return payload.result;
  }
}
