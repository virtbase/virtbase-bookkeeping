import { chmodSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { renderCopyright } from "./linux.ts";
import type { Product } from "./product.ts";
import type { PackageContext, PackageTarget } from "./targets.ts";

export function tarFileName(product: Product, target: PackageTarget): string {
  return `${product.id}_${product.version}_${target.architecture}.tar.gz`;
}

export async function buildTar(context: PackageContext): Promise<string> {
  const { product, target, binary, outDir, root } = context;
  const stage = join(outDir, `.stage-${target.id}`);
  const folder = join(stage, product.id);
  const output = join(outDir, tarFileName(product, target));
  rmSync(stage, { recursive: true, force: true });
  try {
    mkdirSync(folder, { recursive: true });
    cpSync(binary, join(folder, product.id));
    chmodSync(join(folder, product.id), 0o755);
    cpSync(join(root, "LICENSE"), join(folder, "LICENSE"));
    writeFileSync(
      join(folder, "THIRD-PARTY-NOTICES.txt"),
      renderCopyright(product, root, target.platform),
    );
    await $`tar -czf ${output} -C ${stage} ${product.id}`.quiet();
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  return output;
}
