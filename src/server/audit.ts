import type { Db } from "./db/client.ts";
import { auditEvents } from "./db/schema.ts";

export function audit(db: Db, type: string, detail: object): void {
  db.insert(auditEvents)
    .values({
      at: Math.floor(Date.now() / 1000),
      type,
      detail: JSON.stringify(detail),
    })
    .run();
}
