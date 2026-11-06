import { buildDeb } from "./deb.ts";
import type { Product } from "./product.ts";

export interface PackageContext {
  product: Product;
  target: PackageTarget;
  binary: string;
  outDir: string;
  root: string;
}

export interface PackageTarget {
  id: string;
  bunTarget: string;
  architecture: string;
  build: (context: PackageContext) => Promise<string>;
}

export const TARGETS: PackageTarget[] = [
  {
    id: "deb-amd64",
    bunTarget: "bun-linux-x64",
    architecture: "amd64",
    build: buildDeb,
  },
];
