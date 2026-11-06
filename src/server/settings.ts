import { eq, inArray } from "drizzle-orm";
import { DEFAULT_PURPOSE_TEMPLATES } from "../shared/purpose.ts";
import type {
  PreferencesDto,
  SettingsDto,
  UpdateDto,
} from "../shared/types.ts";
import {
  DEFAULT_ACCOUNTS,
  DEFAULT_MONERO_NODES,
  PAYPAL_NAME,
  STRIPE_NAME,
} from "./constants.ts";
import type { Db } from "./db/client.ts";
import { settings } from "./db/schema.ts";

const SETTINGS_KEY = "app";
const LAST_SYNC_KEY = "stripe.lastSyncAt";
const SYNC_FROM_KEY = "stripe.syncedFrom";
const BALANCE_KEY = "stripe.balanceCents";
const MONERO_KEY = "monero.wallet";
const PREFERENCES_KEY = "preferences";
const SETUP_KEY = "setup.completedAt";
const RESTORED_KEY = "setup.restoredAt";
const UPDATE_KEY = "update.check";

function readValue(db: Db, key: string): string | null {
  return (
    db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null
  );
}

function writeValue(db: Db, key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

function withMinutes(baseline: string): string {
  return baseline.length === 10 ? `${baseline}T23:59` : baseline;
}

export function readSettings(db: Db, defaultExportDir: string): SettingsDto {
  const stored = readValue(db, SETTINGS_KEY);
  const defaults: SettingsDto = {
    exportDir: defaultExportDir,
    backupDir: "",
    dateFormat: "iso",
    decimalFormat: "dot",
    baselineDate: "",
    feesClosedThrough: "",
    rateSource: "auto",
    stripeName: STRIPE_NAME,
    paypalName: PAYPAL_NAME,
    accounts: DEFAULT_ACCOUNTS,
    moneroNodes: DEFAULT_MONERO_NODES,
    purposeTemplates: DEFAULT_PURPOSE_TEMPLATES,
  };
  if (!stored) {
    return defaults;
  }
  const saved = JSON.parse(stored) as Partial<SettingsDto>;
  return {
    ...defaults,
    ...saved,
    baselineDate: withMinutes(saved.baselineDate ?? ""),
    accounts: { ...DEFAULT_ACCOUNTS, ...saved.accounts },
    purposeTemplates: {
      ...DEFAULT_PURPOSE_TEMPLATES,
      ...saved.purposeTemplates,
    },
  };
}

export function readPreferences(db: Db): PreferencesDto {
  const stored = readValue(db, PREFERENCES_KEY);
  return {
    theme: null,
    privacy: false,
    tourPending: false,
    ...(stored ? (JSON.parse(stored) as Partial<PreferencesDto>) : {}),
  };
}

export function writePreferences(db: Db, value: PreferencesDto): void {
  writeValue(db, PREFERENCES_KEY, JSON.stringify(value));
}

export interface UpdateCheck {
  checkedAt: number | null;
  latest: UpdateDto | null;
}

export function readUpdateCheck(db: Db): UpdateCheck {
  const stored = readValue(db, UPDATE_KEY);
  return stored
    ? (JSON.parse(stored) as UpdateCheck)
    : { checkedAt: null, latest: null };
}

export function writeUpdateCheck(db: Db, value: UpdateCheck): void {
  writeValue(db, UPDATE_KEY, JSON.stringify(value));
}

export function isSetupComplete(db: Db): boolean {
  return readValue(db, SETUP_KEY) !== null;
}

export function markSetupComplete(db: Db, now: number): void {
  writeValue(db, SETUP_KEY, String(now));
}

export function markRestored(db: Db, now: number): void {
  writeValue(db, RESTORED_KEY, String(now));
}

export function wasRestored(db: Db): boolean {
  return readValue(db, RESTORED_KEY) !== null;
}

export function clearRestoredState(db: Db): void {
  db.delete(settings)
    .where(inArray(settings.key, [SETUP_KEY, MONERO_KEY]))
    .run();
}

export function writeSettings(db: Db, value: SettingsDto): void {
  writeValue(db, SETTINGS_KEY, JSON.stringify(value));
}

export interface SyncMarks {
  lastSyncAt: number | null;
  syncedFrom: number | null;
  balanceCents: number | null;
}

export function readSyncMarks(db: Db): SyncMarks {
  const number = (key: string) => {
    const value = readValue(db, key);
    return value === null ? null : Number(value);
  };
  return {
    lastSyncAt: number(LAST_SYNC_KEY),
    syncedFrom: number(SYNC_FROM_KEY),
    balanceCents: number(BALANCE_KEY),
  };
}

export function writeSyncMarks(db: Db, marks: SyncMarks): void {
  writeValue(db, LAST_SYNC_KEY, String(marks.lastSyncAt));
  writeValue(db, SYNC_FROM_KEY, String(marks.syncedFrom));
  writeValue(db, BALANCE_KEY, String(marks.balanceCents));
}

export interface MoneroMarks {
  address: string | null;
  restoreHeight: number | null;
  lastSyncAt: number | null;
}

export function readMoneroMarks(db: Db): MoneroMarks {
  const stored = readValue(db, MONERO_KEY);
  return stored
    ? (JSON.parse(stored) as MoneroMarks)
    : { address: null, restoreHeight: null, lastSyncAt: null };
}

export function writeMoneroMarks(db: Db, marks: MoneroMarks): void {
  writeValue(db, MONERO_KEY, JSON.stringify(marks));
}

export function clearStripeSync(db: Db): void {
  db.delete(settings).where(eq(settings.key, LAST_SYNC_KEY)).run();
  db.delete(settings).where(eq(settings.key, SYNC_FROM_KEY)).run();
}
