import { and, eq, gte, lt } from "drizzle-orm";
import { PAYPAL_NAME, STRIPE_NAME } from "./constants.ts";
import type { Db } from "./db/client.ts";
import { type Company, exportRows, transactions } from "./db/schema.ts";
import {
  lastDayOfMonth,
  localMidnight,
  monthOf,
  monthStartUtc,
  nextMonth,
} from "./time.ts";

export interface MonthFees {
  stripeCents: number;
  passthroughCents: number;
  count: number;
}

export function sumMonthFees(db: Db, month: string): MonthFees {
  const rows = db
    .select({
      stripe: transactions.stripeFeeCents,
      passthrough: transactions.passthroughFeeCents,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.source, "stripe"),
        gte(transactions.occurredAt, monthStartUtc(month)),
        lt(transactions.occurredAt, monthStartUtc(nextMonth(month))),
      ),
    )
    .all();
  return {
    stripeCents: rows.reduce((sum, row) => sum + row.stripe, 0),
    passthroughCents: rows.reduce((sum, row) => sum + row.passthrough, 0),
    count: rows.length,
  };
}

function isExported(db: Db, id: string): boolean {
  const row = db
    .select({ active: exportRows.active })
    .from(exportRows)
    .where(and(eq(exportRows.transactionId, id), eq(exportRows.active, true)))
    .get();
  return row !== undefined;
}

function upsertFeeRow(
  db: Db,
  values: {
    id: string;
    kind: string;
    day: number;
    name: string;
    company: Company;
    amountCents: number;
    count: number;
  },
): boolean {
  if (values.amountCents === 0 || isExported(db, values.id)) {
    return false;
  }
  const row = {
    id: values.id,
    source: "fees" as const,
    kind: values.kind,
    occurredAt: values.day,
    valueAt: values.day,
    name: values.name,
    company: values.company,
    purpose: values.kind,
    amountCents: values.amountCents,
    method: `${values.count} Stripe-Transaktionen`,
    createdAt: Math.floor(Date.now() / 1000),
  };
  const existing = db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.id, values.id))
    .get();
  db.insert(transactions)
    .values(row)
    .onConflictDoUpdate({
      target: transactions.id,
      set: { amountCents: row.amountCents, method: row.method, hidden: false },
    })
    .run();
  return existing === undefined;
}

function hideClosedFeeRows(db: Db, closedThrough: string): void {
  if (!closedThrough) {
    return;
  }
  const rows = db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.source, "fees"),
        lt(transactions.occurredAt, monthStartUtc(nextMonth(closedThrough))),
      ),
    )
    .all();
  for (const row of rows) {
    if (!isExported(db, row.id)) {
      db.update(transactions)
        .set({ hidden: true })
        .where(eq(transactions.id, row.id))
        .run();
    }
  }
}

export function rebuildFeeRows(
  db: Db,
  closedThrough: string,
  firstMonth: string,
  now: number,
): number {
  const currentMonth = monthOf(now);
  hideClosedFeeRows(db, closedThrough);
  let month = closedThrough ? nextMonth(closedThrough) : firstMonth;
  if (month < firstMonth) {
    month = firstMonth;
  }
  let created = 0;
  while (month < currentMonth) {
    const fees = sumMonthFees(db, month);
    const day = localMidnight(lastDayOfMonth(month));
    const stripeAdded = upsertFeeRow(db, {
      id: `fee:${month}:stripe`,
      kind: "stripe_fee",
      day,
      name: STRIPE_NAME,
      company: "stripe",
      amountCents: -fees.stripeCents,
      count: fees.count,
    });
    const paypalAdded = upsertFeeRow(db, {
      id: `fee:${month}:paypal`,
      kind: "payment_method_passthrough_fee",
      day,
      name: PAYPAL_NAME,
      company: "paypal",
      amountCents: -fees.passthroughCents,
      count: fees.count,
    });
    created += Number(stripeAdded) + Number(paypalAdded);
    month = nextMonth(month);
  }
  return created;
}
