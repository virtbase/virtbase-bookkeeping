import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { $ } from "bun";

const web = "dist/web";
const embed = "dist/embed";

export const DEFAULT_OUTFILE = "dist/virtbase-bookkeeping";

export async function compileBinary(
  outfile: string,
  bunTarget?: string,
): Promise<void> {
  await $`bun scripts/fetch-monero.ts`;
  await $`bunx vite build`;

  rmSync(embed, { recursive: true, force: true });
  mkdirSync(embed, { recursive: true });
  const files = [
    join(web, "index.html"),
    ...readdirSync(join(web, "assets")).map((file) =>
      join(web, "assets", file),
    ),
  ];
  const vendored = readdirSync("vendor/monero").map((file) =>
    join("vendor/monero", file),
  );
  const assets = [...files, ...vendored].map((file) => {
    const target = join(embed, `${basename(file)}.asset`);
    cpSync(file, target);
    return target;
  });

  const targetFlag = bunTarget ? [`--target=${bunTarget}`] : [];
  await $`bun build --compile ${targetFlag} --asset-naming=[name].[ext] --loader .asset:file src/server/index.ts ${assets} --outfile ${outfile}`;
  rmSync(embed, { recursive: true, force: true });
}

if (import.meta.main) {
  await compileBinary(DEFAULT_OUTFILE);
}
