import {
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { stageLinuxApp } from "./linux.ts";
import type { Product } from "./product.ts";
import type { PackageContext } from "./targets.ts";

const MINIMUM_GLIBC = "2.25";
const DESCRIPTION_WIDTH = 78;

export function debianVersion(version: string): string {
  return version.replace("-", "~");
}

function installedKilobytes(directory: string): number {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .map((entry) => statSync(join(directory, entry)))
    .filter((entry) => entry.isFile())
    .reduce((sum, entry) => sum + Math.ceil(entry.size / 1024), 0);
}

function wrap(text: string): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + word.length + 1 > DESCRIPTION_WIDTH) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  return [...lines, line];
}

export function renderControl(
  product: Product,
  architecture: string,
  installedSize: number,
): string {
  return `${[
    `Package: ${product.id}`,
    `Version: ${debianVersion(product.version)}`,
    `Architecture: ${architecture}`,
    `Maintainer: ${product.maintainer}`,
    `Installed-Size: ${installedSize}`,
    `Depends: libc6 (>= ${MINIMUM_GLIBC}), xdg-utils`,
    "Recommends: kdialog | zenity",
    "Section: utils",
    "Priority: optional",
    `Homepage: ${product.homepage}`,
    `Description: ${product.summary}`,
    ...wrap(product.description).map((line) => ` ${line}`),
  ].join("\n")}\n`;
}

export async function buildDeb(context: PackageContext): Promise<string> {
  const { product, target, binary, outDir, root } = context;
  const stage = join(outDir, `.stage-${target.id}`);
  const output = join(
    outDir,
    `${product.id}_${debianVersion(product.version)}_${target.architecture}.deb`,
  );
  rmSync(stage, { recursive: true, force: true });
  try {
    stageLinuxApp(stage, product, binary, root);
    const size = installedKilobytes(stage);
    mkdirSync(join(stage, "DEBIAN"));
    writeFileSync(
      join(stage, "DEBIAN/control"),
      renderControl(product, target.architecture, size),
    );
    await $`dpkg-deb --root-owner-group -Zxz --build ${stage} ${output}`.quiet();
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  return output;
}
