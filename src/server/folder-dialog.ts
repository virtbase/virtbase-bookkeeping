import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { ExportError } from "./export/service.ts";

const TITLE = "Exportordner wählen";

interface FolderDialog {
  command: string;
  args: (start: string) => string[];
}

const KDIALOG: FolderDialog = {
  command: "kdialog",
  args: (start) => ["--title", TITLE, "--getexistingdirectory", start],
};

const ZENITY: FolderDialog = {
  command: "zenity",
  args: (start) => [
    "--file-selection",
    "--directory",
    `--title=${TITLE}`,
    `--filename=${start}/`,
  ],
};

const OSASCRIPT: FolderDialog = {
  command: "osascript",
  args: (start) => [
    "-e",
    "on run argv",
    "-e",
    "POSIX path of (choose folder with prompt (item 1 of argv) default location (POSIX file (item 2 of argv)))",
    "-e",
    "end run",
    TITLE,
    start,
  ],
};

export function preferred(
  platform: NodeJS.Platform = process.platform,
): FolderDialog[] {
  if (platform === "darwin") {
    return [OSASCRIPT];
  }
  const desktop = process.env.XDG_CURRENT_DESKTOP ?? "";
  return desktop.includes("KDE") ? [KDIALOG, ZENITY] : [ZENITY, KDIALOG];
}

let open = false;

export async function chooseFolder(current: string): Promise<string | null> {
  const dialog = preferred()
    .map((entry) => ({
      ...entry,
      path: Bun.which(entry.command, { PATH: process.env.PATH ?? "" }),
    }))
    .find((entry) => entry.path);
  if (!dialog?.path) {
    throw new ExportError(
      "Kein Ordnerdialog gefunden. Installiere zenity oder trage den Pfad von Hand ein.",
    );
  }
  if (open) {
    throw new ExportError("Der Ordnerdialog ist bereits geöffnet.");
  }
  const start =
    current.startsWith("/") && existsSync(current) ? current : homedir();
  open = true;
  try {
    const child = Bun.spawn([dialog.path, ...dialog.args(start)], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const [output, code] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ]);
    const path = output.trim().replace(/(?<=.)\/$/, "");
    return code === 0 && path ? path : null;
  } finally {
    open = false;
  }
}
