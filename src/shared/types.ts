import type { PurposeTemplates } from "./purpose.ts";

export type Source = "stripe" | "monero" | "fees";
export type TransactionStatus = "ready" | "review" | "exported" | "ignored";
export type BatchStatus = "pending" | "imported" | "void";
export type DateFormat = "iso" | "de";
export type DecimalFormat = "dot" | "comma";
export type RateSource = "auto" | "coingecko" | "manual";

export interface TransactionDto {
  id: string;
  source: Source;
  account: string;
  kind: string;
  occurredAt: number;
  valueAt: number;
  name: string | null;
  purpose: string;
  amountCents: number;
  stripeFeeCents: number;
  passthroughFeeCents: number;
  method: string | null;
  reviewReason: string | null;
  status: TransactionStatus;
  batchId: number | null;
  xmrAtomic: string | null;
  xmrRate: number | null;
  rateSource: string | null;
  marketValueCents: number | null;
  product: string | null;
  walletLabel: string | null;
}

export interface SummaryDto {
  balanceCents: number | null;
  lastSyncAt: number | null;
  openCount: number;
  stripeConfigured: boolean;
  stripeKeyType: "restricted" | "secret" | null;
  lexwareConfigured: boolean;
  moneroConfigured: boolean;
  backupFailed: boolean;
  setupRequired: boolean;
  update: UpdateDto | null;
  openFeeMonths: OpenFeeMonthDto[];
}

export interface UpdateDto {
  version: string;
  url: string;
}

export interface OpenFeeMonthDto {
  month: string;
  feeCents: number;
}

export interface RegeneratedExportDto {
  fileName: string;
  existed: boolean;
  identical: boolean;
}

export interface RestoreResultDto {
  transactions: number;
  exports: number;
}

export interface PreferencesDto {
  theme: "light" | "dark" | null;
  privacy: boolean;
  tourPending: boolean;
  singleKeyShortcuts: boolean;
}

export interface BackupStatusDto {
  directory: string;
  defaultDirectory: string;
  lastAt: number | null;
  count: number;
  sizeBytes: number;
  error: string | null;
}

export interface MoneroStatusDto {
  configured: boolean;
  address: string | null;
  restoreHeight: number | null;
  running: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  lastAdded: number;
}

export interface BatchDto {
  id: number;
  account: string;
  createdAt: number;
  firstAt: number;
  lastAt: number;
  rowCount: number;
  netCents: number;
  status: BatchStatus;
  fileName: string;
  filePath: string;
  sha256: string;
}

export interface ExportsDto {
  batches: BatchDto[];
  coveredUntil: number | null;
  missingCount: number;
  missingDays: string[];
}

export interface SettingsDto {
  exportDir: string;
  backupDir: string;
  dateFormat: DateFormat;
  decimalFormat: DecimalFormat;
  baselineDate: string;
  feesClosedThrough: string;
  rateSource: RateSource;
  stripeName: string;
  paypalName: string;
  accounts: Record<Source, string>;
  moneroNodes: string[];
  purposeTemplates: PurposeTemplates;
}

export interface AuditEventDto {
  id: number;
  at: number;
  type: string;
  detail: Record<string, unknown>;
}

export interface AuditExportDto {
  fileName: string;
  content: string;
}

export interface FolderChoiceDto {
  path: string | null;
}

export interface InvoiceMatchDto {
  id: string;
  number: string;
  date: string;
  amountCents: number;
  customer: string;
  product: string | null;
}

export interface InvoiceLookupDto {
  configured: boolean;
  matches: InvoiceMatchDto[];
}

export interface SyncResultDto {
  added: number;
  feeRows: number;
}

export interface MoneroImportResultDto {
  added: number;
  skipped: number;
  withoutRate: number;
}

export interface TestResultDto {
  ok: boolean;
  message: string;
}
