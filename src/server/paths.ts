import { homedir } from "node:os";
import { join } from "node:path";

export interface Paths {
  home: string;
  database: string;
  secrets: string;
  defaultExportDir: string;
}

export function resolvePaths(): Paths {
  const home = process.env.BOOKKEEPING_HOME ?? join(homedir(), "Bookkeeping");
  return {
    home,
    database: join(home, "bookkeeping.sqlite"),
    secrets: join(home, "secrets.json"),
    defaultExportDir: join(home, "exports"),
  };
}
