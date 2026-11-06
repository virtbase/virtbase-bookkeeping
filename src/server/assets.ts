import { existsSync } from "node:fs";
import { join } from "node:path";

const DIST = join(import.meta.dir, "../../dist/web");
const ALLOWED = /^\/(assets\/[\w.-]+|favicon\.svg|index\.html)$/;

export async function readAsset(pathname: string): Promise<Blob | null> {
  const target = pathname === "/" ? "/index.html" : pathname;
  if (!ALLOWED.test(target)) {
    return null;
  }
  const baseName = target.split("/").at(-1);
  const embedded = Bun.embeddedFiles.find((file) =>
    (file as Blob & { name?: string }).name?.endsWith(`${baseName}.asset`),
  );
  if (embedded) {
    return embedded;
  }
  const path = join(DIST, target);
  return existsSync(path) ? Bun.file(path) : null;
}

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  woff2: "font/woff2",
  svg: "image/svg+xml",
};

export function assetType(pathname: string): string {
  const extension = pathname === "/" ? "html" : pathname.split(".").at(-1);
  return TYPES[extension ?? ""] ?? "application/octet-stream";
}
