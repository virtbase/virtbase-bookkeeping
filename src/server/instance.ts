import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomToken, sameToken } from "./security.ts";

interface InstanceRecord {
  pid?: number;
  port?: number;
  token?: string;
}

export interface ClaimedInstance {
  kind: "claimed";
  publish(open: () => string): void;
  release(): void;
}

export interface RunningInstance {
  kind: "running";
  url: string;
}

interface ClaimOptions {
  startupWaitMs?: number;
  requestTimeoutMs?: number;
}

function readRecord(path: string): InstanceRecord | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as InstanceRecord;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : {};
  }
}

function isAlive(pid: number | undefined): boolean {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function askRunning(
  record: InstanceRecord,
  timeoutMs: number,
): Promise<string | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${record.port}/open`, {
      method: "POST",
      headers: { authorization: `Bearer ${record.token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

function createClaim(path: string): ClaimedInstance {
  let control: ReturnType<typeof Bun.serve> | null = null;
  return {
    kind: "claimed",
    publish(open) {
      const token = randomToken();
      control = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
          const header = request.headers.get("authorization") ?? "";
          if (
            request.method !== "POST" ||
            !sameToken(header, `Bearer ${token}`)
          ) {
            return new Response(null, { status: 403 });
          }
          return new Response(open());
        },
      });
      const draft = `${path}.${process.pid}`;
      writeFileSync(
        draft,
        JSON.stringify({ pid: process.pid, port: control.port, token }),
        { mode: 0o600 },
      );
      renameSync(draft, path);
    },
    release() {
      control?.stop(true);
      rmSync(path, { force: true });
    },
  };
}

export async function claimInstance(
  path: string,
  options: ClaimOptions = {},
): Promise<ClaimedInstance | RunningInstance> {
  const { startupWaitMs = 3000, requestTimeoutMs = 1000 } = options;
  const deadline = Date.now() + startupWaitMs;

  while (true) {
    try {
      writeFileSync(path, JSON.stringify({ pid: process.pid }), {
        flag: "wx",
        mode: 0o600,
      });
      return createClaim(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }

    const record = readRecord(path);
    if (record === null) {
      continue;
    }
    if (record.port) {
      const url = await askRunning(record, requestTimeoutMs);
      if (url !== null) {
        return { kind: "running", url };
      }
      rmSync(path, { force: true });
      continue;
    }
    if (isAlive(record.pid) && Date.now() < deadline) {
      await Bun.sleep(100);
      continue;
    }
    rmSync(path, { force: true });
  }
}
