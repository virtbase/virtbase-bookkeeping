import {
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomToken, sameToken } from "./security.ts";

const OWN_BINARY = "virtbase-bookkeeping";
const POLL_MS = 100;
const BUSY_RETRY_MS = 1000;

interface InstanceRecord {
  pid?: number;
  port?: number;
  token?: string;
  version?: string;
}

export interface InstanceHandlers {
  open: () => string;
  stop: () => boolean;
}

export interface ClaimedInstance {
  kind: "claimed";
  publish(handlers: InstanceHandlers): void;
  release(): void;
}

export interface RunningInstance {
  kind: "running";
  url: string;
}

interface ClaimOptions {
  version: string;
  startupWaitMs?: number;
  requestTimeoutMs?: number;
  updateWaitMs?: number;
  isOwnProcess?: (pid: number) => boolean;
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

function runsOurBinary(pid: number): boolean {
  try {
    return readlinkSync(`/proc/${pid}/exe`).includes(OWN_BINARY);
  } catch {
    return false;
  }
}

function control(
  record: InstanceRecord,
  action: "open" | "stop",
  timeoutMs: number,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${record.port}/${action}`, {
    method: "POST",
    headers: { authorization: `Bearer ${record.token}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function askRunning(
  record: InstanceRecord,
  timeoutMs: number,
): Promise<string | null> {
  try {
    const response = await control(record, "open", timeoutMs);
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

async function waitForExit(pid: number | undefined, untilMs: number) {
  while (isAlive(pid) && Date.now() < untilMs) {
    await Bun.sleep(POLL_MS);
  }
  return !isAlive(pid);
}

async function stopOutdated(
  record: InstanceRecord,
  options: Required<ClaimOptions>,
): Promise<boolean> {
  const deadline = Date.now() + options.updateWaitMs;
  if (!record.version) {
    if (!record.pid || !options.isOwnProcess(record.pid)) {
      return false;
    }
    process.kill(record.pid, "SIGTERM");
    return waitForExit(record.pid, deadline);
  }
  while (Date.now() < deadline) {
    try {
      const response = await control(record, "stop", options.requestTimeoutMs);
      if (response.ok) {
        return waitForExit(record.pid, deadline);
      }
    } catch {
      return true;
    }
    await Bun.sleep(BUSY_RETRY_MS);
  }
  return false;
}

function createClaim(path: string, version: string): ClaimedInstance {
  let control: ReturnType<typeof Bun.serve> | null = null;
  return {
    kind: "claimed",
    publish({ open, stop }) {
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
          if (new URL(request.url).pathname === "/stop") {
            return new Response(null, { status: stop() ? 202 : 409 });
          }
          return new Response(open());
        },
      });
      const draft = `${path}.${process.pid}`;
      writeFileSync(
        draft,
        JSON.stringify({
          pid: process.pid,
          port: control.port,
          token,
          version,
        }),
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
  options: ClaimOptions,
): Promise<ClaimedInstance | RunningInstance> {
  const settings: Required<ClaimOptions> = {
    startupWaitMs: 3000,
    requestTimeoutMs: 1000,
    updateWaitMs: 30000,
    isOwnProcess: runsOurBinary,
    ...options,
  };
  const deadline = Date.now() + settings.startupWaitMs;

  while (true) {
    try {
      writeFileSync(path, JSON.stringify({ pid: process.pid }), {
        flag: "wx",
        mode: 0o600,
      });
      return createClaim(path, settings.version);
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
      const outdated = record.version !== settings.version;
      if (outdated && (await stopOutdated(record, settings))) {
        rmSync(path, { force: true });
        continue;
      }
      const url = await askRunning(record, settings.requestTimeoutMs);
      if (url !== null) {
        return { kind: "running", url };
      }
      rmSync(path, { force: true });
      continue;
    }
    if (isAlive(record.pid) && Date.now() < deadline) {
      await Bun.sleep(POLL_MS);
      continue;
    }
    rmSync(path, { force: true });
  }
}
