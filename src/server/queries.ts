import { desc, eq } from "drizzle-orm";
import { productLabel, type StatRow } from "../shared/statistics.ts";
import type {
  AuditEventDto,
  BatchDto,
  ExportsDto,
  SettingsDto,
  TransactionDto,
  TransactionStatus,
} from "../shared/types.ts";
import type { Db } from "./db/client.ts";
import {
  auditEvents,
  exportBatches,
  exportRows,
  transactions,
} from "./db/schema.ts";
import { frozenRow, resolveRow } from "./resolve.ts";
import { syncStart } from "./stripe/sync.ts";
import { localDay, localMinute } from "./time.ts";

type Row = typeof transactions.$inferSelect;

export function baselineEnd(settings: SettingsDto): number | null {
  return settings.baselineDate ? localMinute(settings.baselineDate) + 60 : null;
}

export function statusOf(
  row: Pick<Row, "source" | "occurredAt" | "needsReview" | "ignored">,
  batchId: number | null,
  baseline: number | null,
): TransactionStatus {
  if (batchId !== null) {
    return "exported";
  }
  if (row.ignored) {
    return "ignored";
  }
  if (row.source !== "fees" && baseline !== null && row.occurredAt < baseline) {
    return "exported";
  }
  return row.needsReview ? "review" : "ready";
}

function activeBatches(db: Db): Map<string, number> {
  const rows = db
    .select({
      transactionId: exportRows.transactionId,
      batchId: exportRows.batchId,
    })
    .from(exportRows)
    .where(eq(exportRows.active, true))
    .all();
  return new Map(rows.map((row) => [row.transactionId, row.batchId]));
}

export function listTransactions(
  db: Db,
  settings: SettingsDto,
  now = Math.floor(Date.now() / 1000),
): TransactionDto[] {
  const batches = activeBatches(db);
  const baseline = baselineEnd(settings);
  const start = syncStart(settings, now);
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.hidden, false))
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .all()
    .filter(
      (row) =>
        row.source !== "stripe" ||
        row.occurredAt >= start ||
        batches.has(row.id),
    )
    .map((row) => {
      const batchId = batches.get(row.id) ?? null;
      const resolved =
        batchId === null ? resolveRow(row, settings) : frozenRow(row);
      return {
        id: row.id,
        source: row.source,
        account: settings.accounts[row.source],
        kind: row.kind,
        occurredAt: row.occurredAt,
        valueAt: row.valueAt,
        name: resolved.name,
        purpose: resolved.purpose,
        amountCents: row.amountCents,
        stripeFeeCents: row.stripeFeeCents,
        passthroughFeeCents: row.passthroughFeeCents,
        method: row.method,
        reviewReason: row.reviewReason,
        status: statusOf(row, batchId, baseline),
        batchId,
        xmrAtomic: row.xmrAtomic,
        xmrRate: row.xmrRate,
        rateSource: row.rateSource,
        marketValueCents: row.marketValueCents,
        product: row.product,
        walletLabel: row.walletLabel,
      };
    });
}

const REVENUE_KINDS = new Set([
  "charge",
  "payment",
  "refund",
  "payment_refund",
  "payment_failure_refund",
  "incoming",
]);
const PAYMENT_KINDS = new Set(["charge", "payment", "incoming"]);

export function listStatRows(db: Db, settings: SettingsDto): StatRow[] {
  const batches = activeBatches(db);
  const baseline = baselineEnd(settings);
  return db
    .select()
    .from(transactions)
    .all()
    .flatMap((row) => {
      if (row.source === "fees") {
        return [];
      }
      const status = statusOf(row, batches.get(row.id) ?? null, baseline);
      const unconfirmed = row.source === "monero" && status === "review";
      const counted =
        REVENUE_KINDS.has(row.kind) && !row.hidden && !row.ignored;
      if (row.source === "monero" && (!counted || unconfirmed)) {
        return [];
      }
      return [
        {
          day: localDay(row.occurredAt),
          feeDay: new Date(row.occurredAt * 1000).toISOString().slice(0, 10),
          source: row.source,
          account: settings.accounts[row.source],
          revenueCents: counted ? row.amountCents : 0,
          stripeFeeCents: row.stripeFeeCents,
          passthroughFeeCents: row.passthroughFeeCents,
          product: productLabel(row.product ?? row.description ?? row.purpose),
          payment: counted && PAYMENT_KINDS.has(row.kind),
        },
      ];
    });
}

export function listAudit(db: Db): AuditEventDto[] {
  return db
    .select()
    .from(auditEvents)
    .orderBy(desc(auditEvents.id))
    .all()
    .map((event) => ({
      ...event,
      detail: JSON.parse(event.detail) as Record<string, unknown>,
    }));
}

export function listExports(db: Db, settings: SettingsDto): ExportsDto {
  const batches: BatchDto[] = db
    .select()
    .from(exportBatches)
    .orderBy(desc(exportBatches.id))
    .all();
  const active = batches.filter((batch) => batch.status !== "void");
  const coveredUntil =
    active.length > 0 ? Math.max(...active.map((batch) => batch.lastAt)) : null;

  const exported = activeBatches(db);
  const baseline = baselineEnd(settings) ?? 0;
  const firstExport =
    active.length > 0 ? Math.min(...active.map((batch) => batch.firstAt)) : 0;
  const floor = Math.max(baseline, firstExport);
  const missing =
    coveredUntil === null
      ? []
      : db
          .select({
            id: transactions.id,
            occurredAt: transactions.occurredAt,
            source: transactions.source,
            ignored: transactions.ignored,
          })
          .from(transactions)
          .where(eq(transactions.hidden, false))
          .all()
          .filter(
            (row) =>
              row.source === "stripe" &&
              !row.ignored &&
              !exported.has(row.id) &&
              row.occurredAt >= floor &&
              row.occurredAt <= coveredUntil,
          );

  return {
    batches,
    coveredUntil,
    missingCount: missing.length,
    missingDays: [
      ...new Set(missing.map((row) => localDay(row.occurredAt))),
    ].sort(),
  };
}
