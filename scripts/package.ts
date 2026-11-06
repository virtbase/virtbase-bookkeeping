import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { compileBinary } from "./compile.ts";
import { PRODUCT } from "./packaging/product.ts";
import { TARGETS } from "./packaging/targets.ts";

const root = resolve(import.meta.dir, "..");
const outDir = join(root, "dist/packages");
const requested = process.argv.slice(2);
const selected = requested.length
  ? TARGETS.filter((target) => requested.includes(target.id))
  : TARGETS;

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
for (const target of selected) {
  const binary = join(outDir, `.binary-${target.bunTarget}`);
  await compileBinary(binary, target.bunTarget);
  const output = await target.build({
    product: PRODUCT,
    target,
    binary,
    outDir,
    root,
  });
  await Bun.$`rm -f ${binary}`;
  console.log(output);
}
