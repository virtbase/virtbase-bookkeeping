import { shiftMonth } from "../../shared/statistics.ts";
import type { SettingsDto, SyncResultDto } from "../../shared/types.ts";
import { audit } from "../audit.ts";
import type { Db } from "../db/client.ts";
import { transactions } from "../db/schema.ts";
import { rebuildFeeRows } from "../fees.ts";
import { readSyncMarks, writeSyncMarks } from "../settings.ts";
import { localMidnight, monthOf, monthStartUtc, nextMonth } from "../time.ts";
import type { BalanceReader } from "./client.ts";
import { mapBalanceTransaction } from "./mapping.ts";

const OVERLAP_SECONDS = 3 * 24 * 60 * 60;
const HISTORY_MONTHS = 24;

export function syncStart(settings: SettingsDto, now: number): number {
  const candidates: number[] = [];
  if (settings.baselineDate) {
    candidates.push(monthStartUtc(settings.baselineDate.slice(0, 7)));
    candidates.push(localMidnight(settings.baselineDate.slice(0, 10)));
  }
  if (settings.feesClosedThrough) {
    candidates.push(monthStartUtc(nextMonth(settings.feesClosedThrough)));
  }
  if (candidates.length === 0) {
    return monthStartUtc(`${monthOf(now).slice(0, 4)}-01`);
  }
  return Math.min(...candidates);
}

export function historyStart(now: number): number {
  return monthStartUtc(
    shiftMonth(`${monthOf(now)}-01`, -HISTORY_MONTHS).slice(0, 7),
  );
}

export function refreshFeeRows(
  db: Db,
  settings: SettingsDto,
  now: number,
): number {
  return rebuildFeeRows(
    db,
    settings.feesClosedThrough,
    monthOf(syncStart(settings, now)),
    now,
  );
}

export async function syncStripe(
  db: Db,
  client: BalanceReader,
  settings: SettingsDto,
  now: number,
): Promise<SyncResultDto> {
  const marks = readSyncMarks(db);
  const start = Math.min(syncStart(settings, now), historyStart(now));
  const complete = marks.syncedFrom !== null && marks.syncedFrom <= start;
  const from =
    complete && marks.lastSyncAt !== null
      ? Math.max(start, marks.lastSyncAt - OVERLAP_SECONDS)
      : start;

  const [fetched, balanceCents] = await Promise.all([
    client.listBalanceTransactions(from),
    client.retrieveBalanceCents(),
  ]);

  const known = new Set(
    db
      .select({ id: transactions.id })
      .from(transactions)
      .all()
      .map((row) => row.id),
  );
  let added = 0;
  db.transaction((tx) => {
    for (const row of fetched) {
      const mapped = mapBalanceTransaction(row);
      if (!mapped) {
        continue;
      }
      tx.insert(transactions)
        .values({ ...mapped, createdAt: now })
        .onConflictDoUpdate({
          target: transactions.id,
          set: { refundReason: mapped.refundReason },
        })
        .run();
      added += known.has(mapped.id) ? 0 : 1;
    }
  });

  const feeRows = refreshFeeRows(db, settings, now);
  writeSyncMarks(db, {
    lastSyncAt: now,
    syncedFrom: complete ? marks.syncedFrom : start,
    balanceCents,
  });
  audit(db, "sync", { from, fetched: fetched.length, added, feeRows });
  return { added, feeRows };
}
