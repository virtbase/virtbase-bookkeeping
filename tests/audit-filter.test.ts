import { describe, expect, test } from "bun:test";
import type { AuditEventDto } from "../src/shared/types.ts";
import type { AuditFilter } from "../src/web/lib/audit-filter.ts";
import {
  EMPTY_AUDIT_FILTER,
  exportIdOf,
  filterAudit,
  transactionIdsOf,
} from "../src/web/lib/audit-filter.ts";
import { matchesDefaults } from "../src/web/lib/filter-state.ts";

const at = (iso: string) => Date.parse(iso) / 1000;

const events: AuditEventDto[] = [
  {
    id: 1,
    at: at("2026-11-01T00:30:00+01:00"),
    type: "export",
    detail: { id: 7, account: "Stripe", rows: 3 },
  },
  {
    id: 2,
    at: at("2026-11-02T10:00:00+01:00"),
    type: "export.imported",
    detail: { id: 7 },
  },
  {
    id: 3,
    at: at("2026-11-03T10:00:00+01:00"),
    type: "transaction.edit",
    detail: { id: "txn_a" },
  },
  {
    id: 4,
    at: at("2026-11-04T10:00:00+01:00"),
    type: "transaction.ignore",
    detail: { ids: ["txn_a", "txn_b"] },
  },
  {
    id: 5,
    at: at("2026-11-04T12:00:00+01:00"),
    type: "sync",
    detail: { id: 7, added: 2 },
  },
];

const ids = (change: Partial<AuditFilter>) =>
  filterAudit(events, { ...EMPTY_AUDIT_FILTER, ...change }).map(
    (event) => event.id,
  );

describe("filterAudit", () => {
  test("finds every entry about one export", () => {
    expect(ids({ target: { type: "export", id: 7 } })).toEqual([1, 2]);
  });

  test("finds every entry about one transaction", () => {
    expect(ids({ target: { type: "transaction", id: "txn_a" } })).toEqual([
      3, 4,
    ]);
    expect(ids({ target: { type: "transaction", id: "txn_b" } })).toEqual([4]);
  });

  test("filters by German day", () => {
    expect(ids({ from: "2026-11-01", to: null })).toEqual([1]);
    expect(ids({ from: "2026-11-02", to: "2026-11-03" })).toEqual([2, 3]);
  });

  test("combines type, search and target", () => {
    expect(ids({ types: ["export.imported"], search: "7" })).toEqual([2]);
    expect(matchesDefaults(EMPTY_AUDIT_FILTER, EMPTY_AUDIT_FILTER)).toBe(true);
    expect(
      matchesDefaults(
        { ...EMPTY_AUDIT_FILTER, target: { type: "export", id: 7 } },
        EMPTY_AUDIT_FILTER,
      ),
    ).toBe(false);
  });

  test("reads links only from matching event types", () => {
    expect(events.map(exportIdOf)).toEqual([7, 7, null, null, null]);
    expect(events.map(transactionIdsOf)).toEqual([
      [],
      [],
      ["txn_a"],
      ["txn_a", "txn_b"],
      [],
    ]);
  });
});
