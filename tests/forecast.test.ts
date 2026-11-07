import { describe, expect, test } from "bun:test";
import {
  dailyRevenue,
  dampedTrend,
  forecastBuckets,
  forecastRange,
} from "../src/shared/forecast.ts";
import { shiftDay } from "../src/shared/periods.ts";

function days(
  from: string,
  until: string,
  cents: (day: string, index: number) => number,
) {
  const rows: { day: string; revenueCents: number }[] = [];
  let index = 0;
  for (let day = from; day < until; day = shiftDay(day, 1)) {
    rows.push({ day, revenueCents: cents(day, index) });
    index += 1;
  }
  return dailyRevenue(rows);
}

const perDay = (cents: number, from: string) => {
  const length = Number(shiftDay(from, 31).slice(8)) === 1 ? 30 : 31;
  return cents / length;
};

describe("damped trend", () => {
  test("keeps a flat series flat", () => {
    expect(dampedTrend([500, 500, 500, 500], 3)).toEqual([500, 500, 500]);
  });

  test("follows growth but flattens it", () => {
    const [first = 0, second = 0, third = 0] = dampedTrend(
      [100, 200, 300, 400, 500, 600],
      3,
    );
    expect(first).toBeGreaterThan(600);
    expect(second - first).toBeLessThan(100);
    expect(third).toBeLessThan(900);
  });
});

describe("seasonality", () => {
  const december = (day: string) => (day.slice(5, 7) === "12" ? 200 : 100);

  test("repeats a strong month after two years", () => {
    const daily = days("2023-11-01", "2026-11-06", december);
    const [, dec = 0, jan = 0] =
      forecastBuckets(daily, "2026-11-06", "month", 3)?.values ?? [];
    expect(dec / jan).toBeGreaterThan(1.7);
    expect(perDay(dec, "2026-12-01")).toBeGreaterThan(150);
  });

  test("waits for two full years", () => {
    const daily = days("2025-05-01", "2026-11-06", december);
    const [, dec = 0, jan = 0] =
      forecastBuckets(daily, "2026-11-06", "month", 3)?.values ?? [];
    expect(dec / jan).toBeLessThan(1.2);
  });
});

describe("range", () => {
  const noisy = (_: string, index: number) => 100 + ((index * 37) % 90);

  test("comes from how far earlier forecasts were off", () => {
    const daily = days("2026-03-02", "2026-11-06", noisy);
    const range = forecastRange(daily, "2026-11-06", "week", 6);
    expect(range?.low).toBeGreaterThan(0.5);
    expect(range?.high).toBeLessThan(1.5);
    expect(range?.low ?? 0).toBeLessThanOrEqual(range?.high ?? 0);
  });

  test("needs enough earlier periods", () => {
    const daily = days("2026-09-01", "2026-11-06", noisy);
    expect(forecastRange(daily, "2026-11-06", "week", 6)).toBeNull();
  });
});
