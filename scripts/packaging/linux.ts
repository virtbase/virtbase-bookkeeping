import {
  chmodSync,
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { renderBundledLicenses } from "./licenses.ts";
import type { Product } from "./product.ts";

const ICON_SIZES = [48, 256];

function place(
  root: string,
  path: string,
  content: string | { from: string },
  mode = 0o644,
): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  if (typeof content === "string") {
    writeFileSync(target, content);
  } else {
    cpSync(content.from, target);
  }
  chmodSync(target, mode);
}

export function renderDesktopEntry(product: Product): string {
  return `${[
    "[Desktop Entry]",
    "Type=Application",
    `Name=${product.title}`,
    "Comment=Stripe- und Monero-Transaktionen für Lexware exportieren",
    `Exec=${product.id}`,
    `Icon=${product.id}`,
    "Terminal=false",
    "Categories=Office;Finance;",
    "Keywords=Buchhaltung;Lexware;Stripe;Monero;",
  ].join("\n")}\n`;
}

export function renderCopyright(
  product: Product,
  root: string,
  platform: string,
): string {
  const read = (path: string) => readFileSync(join(root, path), "utf8").trim();
  return `${[
    product.title,
    `${product.title} is licensed under the MIT License:`,
    "",
    read("LICENSE"),
    "",
    `Source: ${product.homepage}`,
    "",
    "This package contains the following third-party software.",
    "",
    "=== Bun runtime, https://github.com/oven-sh/bun ===",
    "",
    "Parts of Bun are licensed under the LGPL-2, see /usr/share/common-licenses/LGPL-2.",
    "",
    read("packaging/licenses/bun.md"),
    "",
    "=== Monero wallet RPC, https://github.com/monero-project/monero ===",
    "",
    read(`vendor/monero/${platform}/LICENSE`),
    "",
    "=== JavaScript packages ===",
    "",
    renderBundledLicenses(root),
  ].join("\n")}\n`;
}

export function stageLinuxApp(
  stage: string,
  product: Product,
  binary: string,
  root: string,
  platform: string,
): void {
  place(stage, `usr/bin/${product.id}`, { from: binary }, 0o755);
  place(
    stage,
    `usr/share/applications/${product.id}.desktop`,
    renderDesktopEntry(product),
  );
  place(stage, `usr/share/icons/hicolor/scalable/apps/${product.id}.svg`, {
    from: join(root, "src/web/favicon.svg"),
  });
  for (const size of ICON_SIZES) {
    place(
      stage,
      `usr/share/icons/hicolor/${size}x${size}/apps/${product.id}.png`,
      { from: join(root, `packaging/icons/${size}.png`) },
    );
  }
  place(
    stage,
    `usr/share/doc/${product.id}/copyright`,
    renderCopyright(product, root, platform),
  );
}
