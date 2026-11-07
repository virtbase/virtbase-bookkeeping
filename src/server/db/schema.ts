import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { BatchStatus, Source } from "../../shared/types.ts";

export type Company = "stripe" | "paypal";

export const transactions = sqliteTable(
  "transactions",
  {
    id: text().primaryKey(),
    source: text().$type<Source>().notNull(),
    kind: text().notNull(),
    occurredAt: integer("occurred_at").notNull(),
    valueAt: integer("value_at").notNull(),
    name: text(),
    purpose: text().notNull(),
    amountCents: integer("amount_cents").notNull(),
    stripeFeeCents: integer("stripe_fee_cents").notNull().default(0),
    passthroughFeeCents: integer("passthrough_fee_cents").notNull().default(0),
    method: text(),
    reference: text(),
    needsReview: integer("needs_review", { mode: "boolean" })
      .notNull()
      .default(false),
    reviewReason: text("review_reason"),
    hidden: integer({ mode: "boolean" }).notNull().default(false),
    ignored: integer({ mode: "boolean" }).notNull().default(false),
    description: text(),
    refundReason: text("refund_reason"),
    company: text().$type<Company>(),
    xmrAtomic: text("xmr_atomic"),
    xmrRate: real("xmr_rate"),
    rateSource: text("rate_source"),
    rateWindow: text("rate_window"),
    marketValueCents: integer("market_value_cents"),
    product: text(),
    walletLabel: text("wallet_label"),
    invoiceId: text("invoice_id"),
    customerId: text("customer_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("transactions_occurred_at").on(table.occurredAt)],
);

export const exportBatches = sqliteTable("export_batches", {
  id: integer().primaryKey({ autoIncrement: true }),
  account: text().notNull().default(""),
  createdAt: integer("created_at").notNull(),
  firstAt: integer("first_at").notNull(),
  lastAt: integer("last_at").notNull(),
  rowCount: integer("row_count").notNull(),
  netCents: integer("net_cents").notNull(),
  status: text().$type<BatchStatus>().notNull().default("pending"),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  sha256: text().notNull(),
});

export const exportRows = sqliteTable(
  "export_rows",
  {
    batchId: integer("batch_id")
      .notNull()
      .references(() => exportBatches.id),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id),
    active: integer({ mode: "boolean" }).notNull().default(true),
  },
  (table) => [
    uniqueIndex("export_rows_one_active")
      .on(table.transactionId)
      .where(sql`active = 1`),
    index("export_rows_batch").on(table.batchId),
  ],
);

export const settings = sqliteTable("settings", {
  key: text().primaryKey(),
  value: text().notNull(),
});

export const auditEvents = sqliteTable("audit_events", {
  id: integer().primaryKey({ autoIncrement: true }),
  at: integer().notNull(),
  type: text().notNull(),
  detail: text().notNull(),
});

export const lexwareInvoices = sqliteTable("lexware_invoices", {
  id: text().primaryKey(),
  number: text().notNull(),
  day: text().notNull(),
  amountCents: integer("amount_cents").notNull(),
  customer: text().notNull(),
  product: text(),
  fetchedAt: integer("fetched_at").notNull(),
});
