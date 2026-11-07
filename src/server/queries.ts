import { desc, eq } from "drizzle-orm";
import { isPaymentKind, isRevenueKind } from "../shared/kinds.ts";
import type { StatRow } from "../shared/statistics.ts";
import { OTHER, productLabel } from "../shared/statistics.ts";
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
  const rows = db
    .select()
    .from(transactions)
    .where(eq(transactions.hidden, false))
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .all();
  const customers = customerIndex(rows);
  return rows
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
      const status = statusOf(row, batchId, baseline);
      const fees = row.source === "fees";
      const counted = countsAsRevenue(row, status);
      const customerKey = fees ? null : customers.keyOf(row);
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
        method: fees ? null : row.method,
        feeBasis: fees ? row.method : null,
        reviewReason: row.reviewReason,
        status,
        batchId,
        xmrAtomic: row.xmrAtomic,
        xmrRate: row.xmrRate,
        rateSource: row.rateSource,
        marketValueCents: row.marketValueCents,
        product: row.product,
        walletLabel: row.walletLabel,
        customerKey,
        customerName: customerKey ? customers.nameOf(customerKey) : null,
        productLabel: productOf(row, counted),
        countsAsRevenue: counted,
      };
    });
}

function productOf(row: Row, counted: boolean): string | null {
  if (row.source === "fees") {
    return null;
  }
  const label = productLabel(row.product ?? row.description ?? row.purpose);
  return label ?? (counted ? OTHER : null);
}

function countsAsRevenue(row: Row, status: TransactionStatus): boolean {
  const unconfirmed = row.source === "monero" && status === "review";
  return isRevenueKind(row.kind) && !row.hidden && !row.ignored && !unconfirmed;
}

function nameKey(name: string | null): string | null {
  const key = name?.trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
  return key || null;
}

type CustomerRow = Pick<Row, "name" | "customerId" | "occurredAt">;

interface CustomerIndex {
  keyOf: (row: CustomerRow) => string | null;
  nameOf: (key: string) => string | null;
}

function customerIndex(rows: CustomerRow[]): CustomerIndex {
  const idsByName = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.customerId) {
      continue;
    }
    const name = nameKey(row.name);
    if (name) {
      const ids = idsByName.get(name) ?? new Set<string>();
      ids.add(row.customerId);
      idsByName.set(name, ids);
    }
  }
  const keyOf = (row: CustomerRow): string | null => {
    if (row.customerId) {
      return `id:${row.customerId}`;
    }
    const name = nameKey(row.name);
    if (!name) {
      return null;
    }
    const ids = idsByName.get(name);
    const [only] = ids ?? [];
    return ids?.size === 1 && only ? `id:${only}` : `name:${name}`;
  };
  const names = new Map<string, { name: string; at: number }>();
  for (const row of rows) {
    const key = keyOf(row);
    const name = row.name?.trim();
    const seen = key ? names.get(key) : undefined;
    if (key && name && (!seen || row.occurredAt > seen.at)) {
      names.set(key, { name, at: row.occurredAt });
    }
  }
  return { keyOf, nameOf: (key) => names.get(key)?.name ?? null };
}

export function listStatRows(db: Db, settings: SettingsDto): StatRow[] {
  const batches = activeBatches(db);
  const baseline = baselineEnd(settings);
  const rows = db.select().from(transactions).all();
  const customers = customerIndex(rows);
  return rows.flatMap((row) => {
    if (row.source === "fees") {
      return [];
    }
    const status = statusOf(row, batches.get(row.id) ?? null, baseline);
    const counted = countsAsRevenue(row, status);
    if (row.source === "monero" && !counted) {
      return [];
    }
    const customer = counted ? customers.keyOf(row) : null;
    return [
      {
        day: localDay(row.occurredAt),
        feeDay: new Date(row.occurredAt * 1000).toISOString().slice(0, 10),
        source: row.source,
        account: settings.accounts[row.source],
        revenueCents: counted ? row.amountCents : 0,
        stripeFeeCents: row.stripeFeeCents,
        passthroughFeeCents: row.passthroughFeeCents,
        product: productOf(row, counted),
        payment: counted && isPaymentKind(row.kind),
        customer,
        customerName: customer ? customers.nameOf(customer) : null,
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
