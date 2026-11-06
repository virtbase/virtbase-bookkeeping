import { version as currentVersion } from "../../package.json";
import type { UpdateDto } from "../shared/types.ts";
import { RELEASES_API } from "./constants.ts";
import type { Db } from "./db/client.ts";
import { readUpdateCheck, writeUpdateCheck } from "./settings.ts";

const CHECK_INTERVAL_SECONDS = 86400;
const REQUEST_TIMEOUT_MS = 5000;
const RELEASE_PAGE = "https://github.com/";

function parts(version: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return match ? match.slice(1).map(Number) : null;
}

export function isNewer(candidate: string, current: string): boolean {
  const next = parts(candidate);
  const installed = parts(current);
  if (!next || !installed) {
    return false;
  }
  for (const [index, value] of next.entries()) {
    const other = installed[index] ?? 0;
    if (value !== other) {
      return value > other;
    }
  }
  return false;
}

export function parseRelease(body: unknown): UpdateDto | null {
  const { tag_name: tag, html_url: url } = (body ?? {}) as {
    tag_name?: unknown;
    html_url?: unknown;
  };
  if (
    typeof tag !== "string" ||
    typeof url !== "string" ||
    !parts(tag) ||
    !url.startsWith(RELEASE_PAGE)
  ) {
    return null;
  }
  return { version: tag.replace(/^v/, ""), url };
}

export type ReleaseSource = () => Promise<Response>;

const github: ReleaseSource = () =>
  fetch(RELEASES_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "virtbase-bookkeeping",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

export async function checkForUpdate(
  db: Db,
  now: number,
  source: ReleaseSource = github,
): Promise<void> {
  const { checkedAt } = readUpdateCheck(db);
  if (checkedAt !== null && now - checkedAt < CHECK_INTERVAL_SECONDS) {
    return;
  }
  try {
    const response = await source();
    const latest = response.ok ? parseRelease(await response.json()) : null;
    writeUpdateCheck(db, { checkedAt: now, latest });
  } catch {
    return;
  }
}

export function availableUpdate(
  db: Db,
  installed: string = currentVersion,
): UpdateDto | null {
  const { latest } = readUpdateCheck(db);
  return latest && isNewer(latest.version, installed) ? latest : null;
}
