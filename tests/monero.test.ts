import { describe, expect, test } from "bun:test";
import { parseMoneroCsv } from "../src/server/monero/csv.ts";
import { atomicToXmr, parseEuroInput } from "../src/shared/money.ts";

const header =
  "blockHeight,epoch,date,direction,amount,atomicAmount,fee,txid,label,subaddrAccount,paymentId,description";

describe("parseMoneroCsv", () => {
  test("keeps confirmed incoming rows only", () => {
    const rows = parseMoneroCsv(
      [
        header,
        '3100000,1793732529,2026-11-02 20:12:09,in,0.015148050000,15148050000,,abc,"order, 1",0,,note',
        "3100001,1793732530,2026-11-02 20:13:09,out,0.5,500000000000,0.00001,def,,0,,",
        "0,1793732531,2026-11-02 20:14:09,in,0.1,100000000000,,ghi,,0,,",
      ].join("\n"),
    );
    expect(rows).toEqual([
      {
        txid: "abc",
        occurredAt: 1793732529,
        atomic: "15148050000",
        label: "order, 1",
        note: "note",
      },
    ]);
  });

  test("rejects other files", () => {
    expect(() => parseMoneroCsv("a,b\n1,2")).toThrow("keine Monero-GUI-CSV");
  });
});

describe("money helpers", () => {
  test("formats atomic units as XMR", () => {
    expect(atomicToXmr("15148050000")).toBe("0.01514805");
    expect(atomicToXmr("1500000000000")).toBe("1.50000000");
  });

  test("parses German euro input", () => {
    expect(parseEuroInput("7,99")).toBe(799);
    expect(parseEuroInput("7.99 €")).toBe(799);
    expect(parseEuroInput("abc")).toBeNull();
    expect(parseEuroInput("7,999")).toBeNull();
  });
});
