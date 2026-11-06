import { buildDeb, debFileName } from "./deb.ts";
import type { Product } from "./product.ts";
import { buildTar, tarFileName } from "./tar.ts";

export interface PackageContext {
  product: Product;
  target: PackageTarget;
  binary: string;
  outDir: string;
  root: string;
}

export interface PackageTarget {
  id: string;
  platform: string;
  bunTarget: string;
  architecture: string;
  format: "deb" | "tar";
  build: (context: PackageContext) => Promise<string>;
  fileName: (product: Product, target: PackageTarget) => string;
}

const deb = { format: "deb", build: buildDeb, fileName: debFileName } as const;
const tar = { format: "tar", build: buildTar, fileName: tarFileName } as const;

export const TARGETS: PackageTarget[] = [
  {
    id: "deb-amd64",
    platform: "linux-x64",
    bunTarget: "bun-linux-x64",
    architecture: "amd64",
    ...deb,
  },
  {
    id: "deb-arm64",
    platform: "linux-arm64",
    bunTarget: "bun-linux-arm64",
    architecture: "arm64",
    ...deb,
  },
  {
    id: "tar-linux-x64",
    platform: "linux-x64",
    bunTarget: "bun-linux-x64",
    architecture: "linux-x64",
    ...tar,
  },
  {
    id: "tar-linux-arm64",
    platform: "linux-arm64",
    bunTarget: "bun-linux-arm64",
    architecture: "linux-arm64",
    ...tar,
  },
  {
    id: "tar-darwin-arm64",
    platform: "darwin-arm64",
    bunTarget: "bun-darwin-arm64",
    architecture: "darwin-arm64",
    ...tar,
  },
];
