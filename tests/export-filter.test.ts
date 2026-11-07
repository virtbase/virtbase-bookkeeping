import { describe, expect, test } from "bun:test";
import type { BatchDto } from "../src/shared/types.ts";
import {
  EMPTY_EXPORT_FILTER,
  filterBatches,
} from "../src/web/lib/export-filter.ts";
import { matchesDefaults } from "../src/web/lib/filter-state.ts";

const at = (iso: string) => Date.parse(iso) / 1000;

function batch(values: Partial<BatchDto>): BatchDto {
  return {
    id: 1,
    account: "Stripe",
    createdAt: at("2026-11-06T08:00:00+01:00"),
    firstAt: at("2026-10-05T10:00:00+02:00"),
    lastAt: at("2026-10-12T10:00:00+02:00"),
    rowCount: 3,
    netCents: 100,
    status: "pending",
    fileName: "virtbase_stripe_2026-10-05_2026-10-12_0001.csv",
    filePath: "/exports/file.csv",
    sha256: "abc",
    ...values,
  };
}

const stripe = batch({ id: 1 });
const monero = batch({
  id: 2,
  account: "Monero",
  status: "imported",
  firstAt: at("2026-10-20T10:00:00+02:00"),
  lastAt: at("2026-10-20T12:00:00+02:00"),
  fileName: "virtbase_monero_2026-10-20_2026-10-20_0002.csv",
});
const old = batch({ id: 3, account: "", status: "void", fileName: "alt.csv" });
const all = [stripe, monero, old];

const ids = (change: Partial<typeof EMPTY_EXPORT_FILTER>) =>
  filterBatches(all, { ...EMPTY_EXPORT_FILTER, ...change }).map(
    (entry) => entry.id,
  );

describe("filterBatches", () => {
  test("keeps everything without a filter", () => {
    expect(ids({})).toEqual([1, 2, 3]);
    expect(matchesDefaults(EMPTY_EXPORT_FILTER, EMPTY_EXPORT_FILTER)).toBe(
      true,
    );
  });

  test("filters by account, including exports without one", () => {
    expect(ids({ accounts: ["Monero"] })).toEqual([2]);
    expect(ids({ accounts: [""] })).toEqual([3]);
    expect(ids({ accounts: ["Stripe", "Monero"] })).toEqual([1, 2]);
  });

  test("filters by the exact export number", () => {
    expect(ids({ batchId: 2 })).toEqual([2]);
    expect(
      matchesDefaults(
        { ...EMPTY_EXPORT_FILTER, batchId: 1 },
        EMPTY_EXPORT_FILTER,
      ),
    ).toBe(false);
  });

  test("filters by status", () => {
    expect(ids({ statuses: ["imported", "void"] })).toEqual([2, 3]);
  });

  test("searches number, account, status and file name", () => {
    expect(ids({ search: "#2" })).toEqual([2]);
    expect(ids({ search: "monero" })).toEqual([2]);
    expect(ids({ search: "STORNIERT" })).toEqual([3]);
    expect(ids({ search: "alt.csv" })).toEqual([3]);
    expect(ids({ search: "gibt es nicht" })).toEqual([]);
  });

  test("matches every export that overlaps the range", () => {
    expect(ids({ from: "2026-10-10", to: "2026-10-15" })).toEqual([1, 3]);
    expect(ids({ from: "2026-10-01", to: "2026-10-05" })).toEqual([1, 3]);
    expect(ids({ from: "2026-10-12", to: "2026-10-25" })).toEqual([1, 2, 3]);
    expect(ids({ from: "2026-10-13", to: "2026-10-19" })).toEqual([]);
  });

  test("treats a first click as a single day", () => {
    expect(ids({ from: "2026-10-20", to: null })).toEqual([2]);
  });

  test("uses German days at midnight", () => {
    const nearMidnight = batch({
      firstAt: at("2026-11-05T23:30:00Z"),
      lastAt: at("2026-11-05T23:30:00Z"),
    });
    const match = (from: string) =>
      filterBatches([nearMidnight], { ...EMPTY_EXPORT_FILTER, from, to: from });
    expect(match("2026-11-06")).toHaveLength(1);
    expect(match("2026-11-05")).toHaveLength(0);
  });

  test("combines all filters", () => {
    expect(
      ids({
        accounts: ["Stripe", "Monero"],
        statuses: ["pending"],
        from: "2026-10-01",
        to: "2026-10-31",
      }),
    ).toEqual([1]);
  });
});
