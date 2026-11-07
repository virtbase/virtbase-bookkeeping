import { auditLabel, formatAuditDetail } from "@shared/audit.ts";
import type { AuditEventDto } from "@shared/types.ts";
import { isoDay } from "@/lib/format";

export type AuditTarget =
  | { type: "export"; id: number }
  | { type: "transaction"; id: string };

export interface AuditFilter {
  search: string;
  types: string[];
  from: string | null;
  to: string | null;
  target: AuditTarget | null;
}

export const EMPTY_AUDIT_FILTER: AuditFilter = {
  search: "",
  types: [],
  from: null,
  to: null,
  target: null,
};

export function exportIdOf(event: AuditEventDto): number | null {
  const { id } = event.detail;
  return (event.type === "export" || event.type.startsWith("export.")) &&
    typeof id === "number"
    ? id
    : null;
}

export function transactionIdsOf(event: AuditEventDto): string[] {
  if (!event.type.startsWith("transaction.")) {
    return [];
  }
  const { id, ids } = event.detail;
  if (typeof id === "string") {
    return [id];
  }
  return Array.isArray(ids)
    ? ids.filter((value): value is string => typeof value === "string")
    : [];
}

function concerns(event: AuditEventDto, target: AuditTarget): boolean {
  return target.type === "export"
    ? exportIdOf(event) === target.id
    : transactionIdsOf(event).includes(target.id);
}

export function filterAudit(
  events: AuditEventDto[],
  filter: AuditFilter,
): AuditEventDto[] {
  const query = filter.search.trim().toLowerCase();
  const { from, target } = filter;
  const to = filter.to ?? from;
  return events.filter((event) => {
    const day = from ? isoDay(event.at) : "";
    return (
      (filter.types.length === 0 || filter.types.includes(event.type)) &&
      (!from || !to || (day >= from && day <= to)) &&
      (!target || concerns(event, target)) &&
      (!query ||
        `${auditLabel(event.type)} ${formatAuditDetail(event.detail)}`
          .toLowerCase()
          .includes(query))
    );
  });
}
