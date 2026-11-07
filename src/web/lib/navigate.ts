import type { AuditFilter } from "@/lib/audit-filter";
import type { ExportFilter } from "@/lib/export-filter";
import type { StatisticsView } from "@/lib/statistics-view";
import type { TransactionFilter } from "@/lib/transaction-filter";
import type { Route } from "@/lib/use-route";
import { readSessionState, writeSessionState } from "@/lib/use-session-state";

export const TRANSACTIONS_FILTER = "transactions.filter";
export const EXPORTS_FILTER = "exports.filter";
export const AUDIT_FILTER = "audit.filter";
export const STATISTICS_VIEW = "statistics.view";

export function openPage(route: Route): void {
  window.location.hash = `#/${route}`;
}

export function showTransactions(change: Partial<TransactionFilter>): void {
  writeSessionState(TRANSACTIONS_FILTER, change);
  openPage("transaktionen");
}

export function showExports(change: Partial<ExportFilter>): void {
  writeSessionState(EXPORTS_FILTER, change);
  openPage("exporte");
}

export function showAudit(change: Partial<AuditFilter>): void {
  writeSessionState(AUDIT_FILTER, change);
  openPage("audit-log");
}

export function showStatistics(change: Partial<StatisticsView>): void {
  const current = readSessionState<Partial<StatisticsView>>(
    STATISTICS_VIEW,
    {},
  );
  writeSessionState(STATISTICS_VIEW, { ...current, ...change });
  openPage("statistiken");
}
