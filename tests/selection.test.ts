import { describe, expect, test } from "bun:test";
import type { TransactionDto } from "../src/shared/types.ts";
import { parseTime } from "../src/web/components/date-time-picker.tsx";
import { selectedVisibleRows } from "../src/web/lib/selection.ts";

function row(id: string, status: TransactionDto["status"]) {
  return { id, status } as TransactionDto;
}

describe("selectedVisibleRows", () => {
  const fees = row("fee", "ready");
  const stripe = row("txn", "ready");

  test("leaves out selected rows hidden by a filter", () => {
    const selection = { fee: true, txn: true };
    expect(selectedVisibleRows([fees], selection)).toEqual([fees]);
  });

  test("keeps rows that are visible and selected", () => {
    const selection = { fee: true, txn: true };
    expect(selectedVisibleRows([fees, stripe], selection)).toEqual([
      fees,
      stripe,
    ]);
  });

  test("leaves out unselected and unready rows", () => {
    const review = row("xmr", "review");
    const exported = row("old", "exported");
    const selection = { xmr: true, old: true };
    expect(selectedVisibleRows([fees, review, exported], selection)).toEqual(
      [],
    );
  });
});

describe("parseTime", () => {
  test("accepts 24-hour times with and without a colon", () => {
    expect(parseTime("15:29")).toBe("15:29");
    expect(parseTime("1529")).toBe("15:29");
    expect(parseTime(" 00:00 ")).toBe("00:00");
    expect(parseTime("23:59")).toBe("23:59");
  });

  test("rejects everything else", () => {
    for (const text of ["24:00", "12:60", "9:30", "15:2", "abc", ""]) {
      expect(parseTime(text)).toBeNull();
    }
  });
});
