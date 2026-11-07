import { renderFileName } from "../../shared/file-name.ts";
import type { exportBatches } from "../db/schema.ts";
import { germanDay } from "../time.ts";

type NamedBatch = Pick<
  typeof exportBatches.$inferSelect,
  "id" | "account" | "firstAt" | "lastAt" | "createdAt" | "rowCount"
>;

export function batchFileName(batch: NamedBatch, template: string): string {
  const from = germanDay(batch.firstAt);
  const until = germanDay(batch.lastAt);
  return renderFileName(template, {
    nummer: String(batch.id).padStart(4, "0"),
    konto: batch.account,
    zeitraum: from === until ? from : `${from} bis ${until}`,
    von: from,
    bis: until,
    erstellt: germanDay(batch.createdAt),
    zeilen: String(batch.rowCount),
  });
}
