import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { moneroPlatformKey } from "../src/server/monero/bundle.ts";
import { compileBinary } from "./compile.ts";
import { PRODUCT } from "./packaging/product.ts";
import { TARGETS } from "./packaging/targets.ts";

const root = resolve(import.meta.dir, "..");
const outDir = join(root, "dist/packages");
const requested = process.argv.slice(2);
const selected = requested.length
  ? TARGETS.filter((target) => requested.includes(target.id))
  : TARGETS.filter((target) => target.platform === moneroPlatformKey());

const unknown = requested.filter(
  (id) => !TARGETS.some((target) => target.id === id),
);
if (unknown.length > 0) {
  console.error(
    `Unknown target: ${unknown.join(", ")}. Available: ${TARGETS.map((target) => target.id).join(", ")}`,
  );
  process.exit(1);
}

process.umask(0o022);
mkdirSync(outDir, { recursive: true });
const binaries = new Map<string, string>();
for (const target of selected) {
  let binary = binaries.get(target.platform);
  if (!binary) {
    binary = join(outDir, `.binary-${target.platform}`);
    await compileBinary(binary, target.bunTarget, target.platform);
    binaries.set(target.platform, binary);
  }
  const output = await target.build({
    product: PRODUCT,
    target,
    binary,
    outDir,
    root,
  });
  console.log(output);
}
for (const binary of binaries.values()) {
  rmSync(binary, { force: true });
}
