import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { version } from "../package.json";

const START_TIMEOUT_MS = 10000;
const packages = "dist/packages";

function fail(message: string): never {
  throw new Error(`Smoke test failed: ${message}`);
}

async function waitForUrl(app: ReturnType<typeof Bun.spawn>): Promise<string> {
  const reader = (app.stdout as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + START_TIMEOUT_MS;
  let output = "";
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    output += decoder.decode(value);
    const match = /http:\/\/127\.0\.0\.1:\d+\/\?token=\w+/.exec(output);
    if (match) {
      return match[0];
    }
  }
  return fail(`no start link, output: ${output.slice(0, 200)}`);
}

async function check(binary: string, home: string): Promise<void> {
  const app = Bun.spawn([binary], {
    env: {
      PATH: process.env.PATH,
      BOOKKEEPING_HOME: home,
      BOOKKEEPING_NO_OPEN: "1",
    },
    stdout: "pipe",
    stderr: "inherit",
  });
  try {
    const url = await waitForUrl(app);
    const { origin } = new URL(url);
    const login = await fetch(url, { redirect: "manual" });
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    if (login.status !== 302 || !cookie) {
      fail(`login returned ${login.status}`);
    }
    const page = await fetch(`${origin}/`, { headers: { cookie } });
    const html = await page.text();
    const script = /assets\/index-[\w-]+\.js/.exec(html)?.[0];
    if (!page.ok || !script) {
      fail(`page returned ${page.status}`);
    }
    const asset = await fetch(`${origin}/${script}`, { headers: { cookie } });
    if (!asset.ok) {
      fail(`script returned ${asset.status}`);
    }
    const summary = await fetch(`${origin}/api/summary`, {
      headers: { cookie, "sec-fetch-site": "same-origin" },
    });
    const body = (await summary.json()) as { setupRequired?: boolean };
    if (!summary.ok || body.setupRequired !== true) {
      fail(`summary returned ${summary.status}`);
    }
  } finally {
    app.kill();
    await app.exited;
  }
}

const deb = readdirSync(packages).find((file) =>
  file.endsWith(`_${version.replace("-", "~")}_amd64.deb`),
);
if (!deb) {
  fail(`no package for ${version} in ${packages}`);
}
const work = mkdtempSync(join(tmpdir(), "bookkeeping-smoke-"));
try {
  await $`dpkg-deb -x ${join(packages, deb)} ${work}`.quiet();
  await check(join(work, "usr/bin/virtbase-bookkeeping"), join(work, "home"));
  console.log(`Smoke test passed for ${deb}.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
