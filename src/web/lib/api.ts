import type { MoneroWalletForm, SetupForm } from "@shared/schemas.ts";
import type { StatisticsDto } from "@shared/statistics.ts";
import type {
  AuditEventDto,
  AuditExportDto,
  BackupStatusDto,
  BatchDto,
  ExportsDto,
  FileNameStatusDto,
  FolderChoiceDto,
  InvoiceLookupDto,
  MoneroImportResultDto,
  MoneroStatusDto,
  PreferencesDto,
  RegeneratedExportDto,
  RenameResultDto,
  RestoreResultDto,
  SettingsDto,
  SummaryDto,
  SyncResultDto,
  TestResultDto,
  TransactionDto,
} from "@shared/types.ts";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...init,
    credentials: "same-origin",
  });
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: string; field?: string })
    | null;
  if (!response.ok) {
    throw new ApiError(body?.error ?? `Fehler ${response.status}`, body?.field);
  }
  return body as T;
}

function json(method: string, value: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}

export interface TransactionEdit {
  name?: string;
  product?: string;
  amountCents?: number;
  rate?: number;
  invoiceId?: string | null;
}

export const api = {
  summary: () => request<SummaryDto>("summary"),
  transactions: () => request<TransactionDto[]>("transactions"),
  sync: () => request<SyncResultDto>("sync", { method: "POST" }),
  importMonero: (text: string) =>
    request<MoneroImportResultDto>("monero/import", {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: text,
    }),
  invoices: (id: string) =>
    request<InvoiceLookupDto>(
      `transactions/${encodeURIComponent(id)}/invoices`,
    ),
  editTransaction: (id: string, edit: TransactionEdit) =>
    request(`transactions/${encodeURIComponent(id)}`, json("PATCH", edit)),
  ignoreTransactions: (ids: string[], ignored: boolean) =>
    request("transactions/ignore", json("POST", { ids, ignored })),
  moneroStatus: () => request<MoneroStatusDto>("monero/status"),
  moneroSync: () => request<MoneroStatusDto>("monero/sync", { method: "POST" }),
  setupMonero: (form: MoneroWalletForm) =>
    request<MoneroStatusDto>("monero/wallet", json("PUT", form)),
  removeMonero: () =>
    request<MoneroStatusDto>("monero/wallet", { method: "DELETE" }),
  audit: () => request<AuditEventDto[]>("audit"),
  preferences: () => request<PreferencesDto>("preferences"),
  savePreferences: (patch: Partial<PreferencesDto>) =>
    request<PreferencesDto>("preferences", json("PUT", patch)),
  completeSetup: (values: SetupForm) =>
    request<{ tourPending: boolean }>("setup/complete", json("POST", values)),
  restoreBackup: (file: File) =>
    request<RestoreResultDto>("setup/restore", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    }),
  backups: () => request<BackupStatusDto>("backups"),
  createBackup: () => request<BackupStatusDto>("backups", { method: "POST" }),
  statistics: () => request<StatisticsDto>("statistics"),
  statisticsExported: (rows: number) =>
    request<{ ok: boolean }>("statistics/export", json("POST", { rows })),
  exportAudit: (ids: number[]) =>
    request<AuditExportDto>("audit/export", json("POST", { ids })),
  reset: (scope: "exports" | "all") =>
    request(`reset/${scope}`, { method: "POST" }),
  exports: () => request<ExportsDto>("exports"),
  createExport: (ids: string[]) =>
    request<BatchDto[]>("exports", json("POST", { ids })),
  voidExport: (id: number) => request(`exports/${id}/void`, { method: "POST" }),
  markImported: (id: number) =>
    request(`exports/${id}/imported`, { method: "POST" }),
  renamePreview: (template: string) =>
    request<FileNameStatusDto>(
      "exports/rename/preview",
      json("POST", { template }),
    ),
  renameExports: () =>
    request<RenameResultDto>("exports/rename", { method: "POST" }),
  regenerateExport: (id: number) =>
    request<RegeneratedExportDto>(`exports/${id}/regenerate`, {
      method: "POST",
    }),
  revealExport: (id: number) =>
    request(`exports/${id}/reveal`, { method: "POST" }),
  chooseFolder: (current: string) =>
    request<FolderChoiceDto>("system/folder", json("POST", { current })),
  settings: () => request<SettingsDto>("settings"),
  saveSettings: (value: SettingsDto) =>
    request<SettingsDto>("settings", json("PUT", value)),
  saveSecret: (name: "stripe" | "lexware", value: string) =>
    request(`secrets/${name}`, json("PUT", { value })),
  testSecret: (name: "stripe" | "lexware") =>
    request<TestResultDto>(`secrets/${name}/test`, { method: "POST" }),
};
