import { eq } from "drizzle-orm";
import { atomicToXmr } from "../../shared/money.ts";
import type { MoneroImportResultDto } from "../../shared/types.ts";
import { audit } from "../audit.ts";
import type { Db } from "../db/client.ts";
import { transactions } from "../db/schema.ts";
import { type MoneroRow, parseMoneroCsv, withStableIds } from "./csv.ts";
import type { Rate, RateProvider } from "./rates.ts";

const DEFAULT_LABEL = "Primary account";
const REASON_NAME = "Name und Produkt ergänzen.";
const REASON_RATE = "Kurs nicht gefunden, bitte eintragen.";

function marketCents(atomic: string, eur: number): number {
  return Math.round((Number(atomic) / 1e12) * eur * 100);
}

function walletLabel(row: MoneroRow): string | null {
  if (row.note) {
    return row.note;
  }
  return row.label && row.label !== DEFAULT_LABEL ? row.label : null;
}

export function importMoneroCsv(
  db: Db,
  text: string,
  rates: RateProvider,
  now: number,
): Promise<MoneroImportResultDto> {
  return importMoneroRows(db, parseMoneroCsv(text), rates, now);
}

export async function importMoneroRows(
  db: Db,
  rows: MoneroRow[],
  rates: RateProvider,
  now: number,
): Promise<MoneroImportResultDto> {
  let added = 0;
  let skipped = 0;
  let withoutRate = 0;
  for (const row of withStableIds(rows)) {
    const { id } = row;
    const known = db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.id, id))
      .get();
    if (known) {
      skipped += 1;
      continue;
    }
    const rate: Rate | null = await rates.rateAt(row.occurredAt);
    if (!rate) {
      withoutRate += 1;
    }
    const market = rate ? marketCents(row.atomic, rate.eur) : null;
    db.insert(transactions)
      .values({
        id,
        source: "monero",
        kind: "incoming",
        occurredAt: row.occurredAt,
        valueAt: row.occurredAt,
        name: null,
        purpose: `${atomicToXmr(row.atomic)} XMR`,
        amountCents: market ?? 0,
        method: "Monero",
        reference: row.txid,
        needsReview: true,
        reviewReason: rate ? REASON_NAME : REASON_RATE,
        xmrAtomic: row.atomic,
        xmrRate: rate?.eur ?? null,
        rateSource: rate?.source ?? null,
        rateWindow: rate?.window ?? null,
        marketValueCents: market,
        walletLabel: walletLabel(row),
        createdAt: now,
      })
      .run();
    added += 1;
  }
  audit(db, "monero.import", { added, skipped, withoutRate });
  return { added, skipped, withoutRate };
}
