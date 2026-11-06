import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

interface Manifest {
  name: string;
  version: string;
  license?: string;
  dependencies?: Record<string, string>;
}

interface Bundled {
  name: string;
  version: string;
  license: string;
  text: string | null;
}

function findPackage(name: string, from: string): string | null {
  let directory = from;
  while (true) {
    const candidate = join(directory, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) {
      return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return null;
    }
    directory = parent;
  }
}

function readManifest(directory: string): Manifest {
  return JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
}

function licenseText(directory: string): string | null {
  const file = readdirSync(directory).find((entry) =>
    /^(licen[cs]e|copying)/i.test(entry),
  );
  return file ? readFileSync(join(directory, file), "utf8").trim() : null;
}

export function bundledPackages(root: string): Bundled[] {
  const found = new Map<string, Bundled>();
  const visit = (directory: string) => {
    for (const name of Object.keys(
      readManifest(directory).dependencies ?? {},
    )) {
      const location = findPackage(name, directory);
      if (!location) {
        continue;
      }
      const manifest = readManifest(location);
      const key = `${manifest.name}@${manifest.version}`;
      if (!found.has(key)) {
        found.set(key, {
          name: manifest.name,
          version: manifest.version,
          license: manifest.license ?? "see package",
          text: licenseText(location),
        });
        visit(location);
      }
    }
  };
  visit(root);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function renderBundledLicenses(root: string): string {
  return bundledPackages(root)
    .map((entry) =>
      [
        `${entry.name} ${entry.version} (${entry.license})`,
        ...(entry.text ? ["", entry.text] : []),
      ].join("\n"),
    )
    .join("\n\n---\n\n");
}
