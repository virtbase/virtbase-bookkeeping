import { randomBytes } from "node:crypto";
import { existsSync, renameSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import type { FileNameStatusDto, RenameResultDto } from "../../shared/types.ts";
import { audit } from "../audit.ts";
import type { Db } from "../db/client.ts";
import { exportBatches } from "../db/schema.ts";
import { batchFileName } from "./file-names.ts";
import { ExportError } from "./service.ts";

interface RenamePlan {
  id: number;
  from: string;
  to: string;
  fileName: string;
}

interface Move {
  from: string;
  to: string;
}

function planRenames(
  db: Db,
  template: string,
  exportDir: string,
): RenamePlan[] {
  return db
    .select()
    .from(exportBatches)
    .orderBy(exportBatches.id)
    .all()
    .flatMap((batch) => {
      const fileName = batchFileName(batch, template);
      if (fileName === batch.fileName) {
        return [];
      }
      const from = batch.filePath || join(exportDir, batch.fileName);
      return [
        { id: batch.id, from, to: join(dirname(from), fileName), fileName },
      ];
    });
}

function sameFile(left: string, right: string): boolean {
  try {
    const a = statSync(left);
    const b = statSync(right);
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
}

function occupied(target: string): ExportError {
  return new ExportError(
    `${basename(target)} gibt es schon im Ordner. Bitte verschiebe die Datei und versuche es erneut.`,
  );
}

function undo(step: Move): boolean {
  try {
    renameSync(step.to, step.from);
    return true;
  } catch {
    return false;
  }
}

export function fileNameStatus(
  db: Db,
  template: string,
  exportDir: string,
): FileNameStatusDto {
  const plans = planRenames(db, template, exportDir);
  const latest = plans.at(-1);
  return {
    pending: plans.length,
    example: latest
      ? { from: basename(latest.from), to: latest.fileName }
      : null,
  };
}

export function renameExports(
  db: Db,
  template: string,
  exportDir: string,
): RenameResultDto {
  const plans = planRenames(db, template, exportDir);
  const present = plans.filter((entry) => existsSync(entry.from));
  const blocked = present.find(
    (entry) =>
      existsSync(entry.to) &&
      !present.some((other) => sameFile(other.from, entry.to)),
  );
  if (blocked) {
    throw occupied(blocked.to);
  }

  const moved: Move[] = [];
  const move = (from: string, to: string) => {
    renameSync(from, to);
    moved.push({ from, to });
  };
  const suffix = randomBytes(4).toString("hex");
  try {
    const staged = present.map((entry) => {
      const temp = join(dirname(entry.from), `.${entry.id}-${suffix}.tmp`);
      move(entry.from, temp);
      return { entry, temp };
    });
    for (const { entry, temp } of staged) {
      if (existsSync(entry.to)) {
        throw occupied(entry.to);
      }
      move(temp, entry.to);
    }
    db.transaction((tx) => {
      for (const entry of plans) {
        tx.update(exportBatches)
          .set({ fileName: entry.fileName, filePath: entry.to })
          .where(eq(exportBatches.id, entry.id))
          .run();
      }
    });
  } catch (error) {
    const failed = moved.reverse().filter((step) => !undo(step));
    if (failed.length > 0) {
      throw new ExportError(
        "Das Umbenennen ist mittendrin fehlgeschlagen. Bitte prüfe den Exportordner.",
      );
    }
    throw error instanceof ExportError
      ? error
      : new ExportError(
          "Die Dateien konnten nicht umbenannt werden. Es wurde nichts geändert.",
        );
  }

  const result = {
    renamed: present.length,
    missing: plans.length - present.length,
  };
  if (plans.length > 0) {
    audit(db, "export.rename", result);
  }
  return result;
}
