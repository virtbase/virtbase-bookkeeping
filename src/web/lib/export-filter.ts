import type { BatchDto, BatchStatus } from "@shared/types.ts";
import { formatDayRange, isoDay } from "@/lib/format";

export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  pending: "Lexware ausstehend",
  imported: "Importiert",
  void: "Storniert",
};

export const NO_ACCOUNT_LABEL = "Ohne Konto";

export interface ExportFilter {
  search: string;
  accounts: string[];
  statuses: BatchStatus[];
  from: string | null;
  to: string | null;
}

export const EMPTY_EXPORT_FILTER: ExportFilter = {
  search: "",
  accounts: [],
  statuses: [],
  from: null,
  to: null,
};

export function isFiltered(filter: ExportFilter): boolean {
  return (
    filter.search.trim() !== "" ||
    filter.accounts.length > 0 ||
    filter.statuses.length > 0 ||
    filter.from !== null
  );
}

function searchText(batch: BatchDto): string {
  return [
    `#${batch.id}`,
    batch.account || NO_ACCOUNT_LABEL,
    BATCH_STATUS_LABELS[batch.status],
    batch.fileName,
    formatDayRange(batch.firstAt, batch.lastAt),
  ]
    .join(" ")
    .toLowerCase();
}

export function filterBatches(
  batches: BatchDto[],
  filter: ExportFilter,
): BatchDto[] {
  const query = filter.search.trim().toLowerCase();
  const { from } = filter;
  const to = filter.to ?? from;
  return batches.filter(
    (batch) =>
      (filter.accounts.length === 0 ||
        filter.accounts.includes(batch.account)) &&
      (filter.statuses.length === 0 ||
        filter.statuses.includes(batch.status)) &&
      (!from ||
        !to ||
        (isoDay(batch.lastAt) >= from && isoDay(batch.firstAt) <= to)) &&
      (!query || searchText(batch).includes(query)),
  );
}
