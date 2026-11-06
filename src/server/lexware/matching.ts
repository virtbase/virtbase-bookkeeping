import { and, eq, gt, isNotNull, ne } from "drizzle-orm";
import type { InvoiceMatchDto } from "../../shared/types.ts";
import type { Db } from "../db/client.ts";
import { lexwareInvoices, transactions } from "../db/schema.ts";
import { localDay } from "../time.ts";
import type { InvoiceReader, Voucher } from "./client.ts";

const DAYS_BEFORE = 3;
const DAYS_AFTER = 1;
const MIN_TOLERANCE_CENTS = 50;
const TOLERANCE_RATIO = 0.08;
const MAX_MATCHES = 5;
const STRIPE_WINDOW_SECONDS = 3 * 24 * 60 * 60;
const CLOSED_STATUSES = new Set(["voided", "draft"]);

interface StripePayment {
  name: string;
  amountCents: number;
  occurredAt: number;
}

function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayOfVoucher(value: string): string {
  return value.slice(0, 10);
}

export function isCandidate(
  voucherCents: number,
  targetCents: number,
): boolean {
  const tolerance = Math.max(
    MIN_TOLERANCE_CENTS,
    Math.round(targetCents * TOLERANCE_RATIO),
  );
  return Math.abs(voucherCents - targetCents) <= tolerance;
}

function stripePayments(db: Db): StripePayment[] {
  return db
    .select({
      name: transactions.name,
      amountCents: transactions.amountCents,
      occurredAt: transactions.occurredAt,
    })
    .from(transactions)
    .where(
      and(eq(transactions.source, "stripe"), gt(transactions.amountCents, 0)),
    )
    .all()
    .flatMap((row) =>
      row.name ? [{ ...row, name: row.name.toLowerCase() }] : [],
    );
}

function isPaidByStripe(voucher: Voucher, payments: StripePayment[]): boolean {
  const name = voucher.contactName?.toLowerCase();
  const issuedAt = Date.parse(voucher.voucherDate) / 1000;
  const amountCents = Math.round(voucher.totalAmount * 100);
  return payments.some(
    (payment) =>
      payment.name === name &&
      payment.amountCents === amountCents &&
      Math.abs(payment.occurredAt - issuedAt) <= STRIPE_WINDOW_SECONDS,
  );
}

async function resolve(
  db: Db,
  client: InvoiceReader,
  voucher: Voucher,
  now: number,
): Promise<InvoiceMatchDto> {
  const cached = db
    .select()
    .from(lexwareInvoices)
    .where(eq(lexwareInvoices.id, voucher.id))
    .get();
  if (cached) {
    return {
      id: cached.id,
      number: cached.number,
      date: cached.day,
      amountCents: cached.amountCents,
      customer: cached.customer,
      product: cached.product,
    };
  }
  const invoice = await client.retrieveInvoice(voucher.id);
  const row = {
    id: voucher.id,
    number: invoice.voucherNumber ?? voucher.voucherNumber,
    day: dayOfVoucher(invoice.voucherDate),
    amountCents: Math.round(
      (invoice.totalPrice?.totalGrossAmount ?? voucher.totalAmount) * 100,
    ),
    customer: invoice.address?.name ?? "",
    product: invoice.lineItems?.[0]?.name ?? null,
    fetchedAt: now,
  };
  db.insert(lexwareInvoices).values(row).onConflictDoNothing().run();
  return {
    id: row.id,
    number: row.number,
    date: row.day,
    amountCents: row.amountCents,
    customer: row.customer,
    product: row.product,
  };
}

export async function findInvoices(
  db: Db,
  client: InvoiceReader,
  transactionId: string,
  now: number,
): Promise<InvoiceMatchDto[]> {
  const row = db
    .select()
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .get();
  if (!row) {
    return [];
  }
  const day = localDay(row.occurredAt);
  const target = row.marketValueCents ?? row.amountCents;
  const used = new Set(
    db
      .select({ id: transactions.invoiceId })
      .from(transactions)
      .where(
        and(
          isNotNull(transactions.invoiceId),
          ne(transactions.id, transactionId),
        ),
      )
      .all()
      .map((entry) => entry.id),
  );
  const vouchers = await client.listInvoices(
    shiftDay(day, -DAYS_BEFORE),
    shiftDay(day, DAYS_AFTER),
  );
  const paidByStripe = stripePayments(db);
  const distance = (voucher: Voucher) =>
    Math.abs(Date.parse(dayOfVoucher(voucher.voucherDate)) - Date.parse(day));
  const candidates = vouchers
    .filter(
      (voucher) =>
        !CLOSED_STATUSES.has(voucher.voucherStatus ?? "") &&
        !used.has(voucher.id) &&
        !isPaidByStripe(voucher, paidByStripe) &&
        isCandidate(Math.round(voucher.totalAmount * 100), target),
    )
    .sort(
      (a, b) =>
        distance(a) - distance(b) ||
        Math.abs(a.totalAmount * 100 - target) -
          Math.abs(b.totalAmount * 100 - target),
    )
    .slice(0, MAX_MATCHES);
  const matches: InvoiceMatchDto[] = [];
  for (const voucher of candidates) {
    matches.push(await resolve(db, client, voucher, now));
  }
  return matches;
}
