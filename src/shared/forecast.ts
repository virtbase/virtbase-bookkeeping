import type { Granularity } from "./periods.ts";
import { bucketKey, bucketKeys, nextKey, shiftDay } from "./periods.ts";

export interface ForecastPlan {
  basis: number;
  earned: number;
  values: number[];
}

export interface ForecastRange {
  low: number;
  high: number;
}

export type DailyRevenue = Map<string, number>;

const MINIMUM_HISTORY: Record<Granularity, number> = {
  day: 14,
  week: 4,
  month: 3,
};
const TREND_BASIS: Record<Granularity, number> = {
  day: 28,
  week: 12,
  month: 12,
};
const RECENT_DAYS: Record<Granularity, number> = {
  day: 56,
  week: 56,
  month: 91,
};
const SEASON_MONTHS = 24;
const MINIMUM_ORIGINS = 8;
const RANGE_QUANTILES = { low: 0.1, high: 0.9 };
const ALPHAS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const BETAS = [0.01, 0.05, 0.1, 0.2, 0.3];
const PHIS = [0.8, 0.85, 0.9, 0.95, 0.98];

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function quantile(sorted: number[], share: number): number {
  const position = (sorted.length - 1) * share;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? 0;
  const high = sorted[upper] ?? low;
  return low + (high - low) * (position - lower);
}

export function dailyRevenue(
  rows: { day: string; revenueCents: number }[],
): DailyRevenue {
  const daily: DailyRevenue = new Map();
  for (const row of rows) {
    if (row.revenueCents !== 0) {
      daily.set(row.day, (daily.get(row.day) ?? 0) + row.revenueCents);
    }
  }
  return daily;
}

function firstDayOf(daily: DailyRevenue): string | null {
  let first: string | null = null;
  for (const day of daily.keys()) {
    if (first === null || day < first) {
      first = day;
    }
  }
  return first;
}

function daysFrom(from: string, until: string): string[] {
  const days: string[] = [];
  for (let day = from; day < until; day = shiftDay(day, 1)) {
    days.push(day);
  }
  return days;
}

export function dampedTrend(values: number[], steps: number): number[] {
  const first = values[0] ?? 0;
  let best = {
    error: Number.POSITIVE_INFINITY,
    level: first,
    trend: 0,
    phi: 1,
  };
  for (const alpha of ALPHAS) {
    for (const beta of BETAS) {
      for (const phi of PHIS) {
        let level = first;
        let trend = 0;
        let error = 0;
        for (const value of values.slice(1)) {
          const predicted = level + phi * trend;
          error += (value - predicted) ** 2;
          const previous = level;
          level = alpha * value + (1 - alpha) * predicted;
          trend = beta * (level - previous) + (1 - beta) * phi * trend;
        }
        if (error < best.error) {
          best = { error, level, trend, phi };
        }
      }
    }
  }
  const forecast: number[] = [];
  let damping = 0;
  for (let step = 1; step <= steps; step += 1) {
    damping += best.phi ** step;
    forecast.push(best.level + damping * best.trend);
  }
  return forecast;
}

function seasonalFactors(
  months: { key: string; rate: number }[],
): number[] | null {
  if (months.length < SEASON_MONTHS) {
    return null;
  }
  const ratios: number[][] = Array.from({ length: 12 }, () => []);
  for (let index = 6; index + 6 < months.length; index += 1) {
    const window = months.slice(index - 6, index + 7).map((m) => m.rate);
    const centered =
      ((window[0] ?? 0) / 2 +
        sum(window.slice(1, 12)) +
        (window[12] ?? 0) / 2) /
      12;
    const month = months[index];
    if (month && centered > 0) {
      ratios[Number(month.key.slice(5, 7)) - 1]?.push(month.rate / centered);
    }
  }
  if (ratios.some((list) => list.length === 0)) {
    return null;
  }
  const raw = ratios.map((list) => Math.max(0.1, mean(list)));
  const average = mean(raw);
  return raw.map((factor) => factor / average);
}

export function forecastBuckets(
  daily: DailyRevenue,
  today: string,
  granularity: Granularity,
  steps: number,
): ForecastPlan | null {
  const firstDay = firstDayOf(daily);
  if (!firstDay || firstDay >= today) {
    return null;
  }
  const current = bucketKey(today, granularity);
  const completed = bucketKeys(firstDay, today, granularity).filter(
    (key) => key < current,
  );
  if (completed.length < MINIMUM_HISTORY[granularity]) {
    return null;
  }

  const revenue = (day: string) => daily.get(day) ?? 0;
  const daysOf = (key: string, scale: Granularity) =>
    daysFrom(key, nextKey(key, scale)).filter((day) => day >= firstDay);
  const thisMonth = bucketKey(today, "month");
  const months = bucketKeys(firstDay, today, "month")
    .filter((key) => key < thisMonth)
    .map((key) => {
      const days = daysOf(key, "month");
      return { key, rate: sum(days.map(revenue)) / days.length };
    });
  const factors = seasonalFactors(months);
  const factor = (day: string) =>
    factors ? (factors[Number(day.slice(5, 7)) - 1] ?? 1) : 1;
  const rate = (days: string[]) => {
    const weight = sum(days.map(factor));
    return weight > 0 ? sum(days.map(revenue)) / weight : 0;
  };

  const basis = completed.slice(-TREND_BASIS[granularity]);
  const history = basis.map((key) => rate(daysOf(key, granularity)));
  const recent = rate(
    daysFrom(shiftDay(today, -RECENT_DAYS[granularity]), today).filter(
      (day) => day >= firstDay,
    ),
  );
  const trend = dampedTrend(history, steps);

  const values: number[] = [];
  let earnedSoFar = 0;
  let key = current;
  for (let step = 0; step < steps; step += 1) {
    const expected = Math.max(0, (recent + (trend[step] ?? recent)) / 2);
    const days = daysFrom(key, nextKey(key, granularity));
    const open = step === 0 ? days.filter((day) => day >= today) : days;
    const earned =
      step === 0 ? sum(days.filter((day) => day < today).map(revenue)) : 0;
    earnedSoFar += earned;
    values.push(Math.round(earned + expected * sum(open.map(factor))));
    key = nextKey(key, granularity);
  }
  return { basis: basis.length, earned: earnedSoFar, values };
}

function pastRatios(
  daily: DailyRevenue,
  today: string,
  granularity: Granularity,
  skip: number,
  count: number,
): number[] {
  const firstDay = firstDayOf(daily);
  if (!firstDay) {
    return [];
  }
  const ratios: number[] = [];
  for (const origin of bucketKeys(firstDay, today, granularity)) {
    if (origin <= firstDay) {
      continue;
    }
    let start = origin;
    for (let step = 0; step < skip; step += 1) {
      start = nextKey(start, granularity);
    }
    let end = start;
    for (let step = 0; step < count; step += 1) {
      end = nextKey(end, granularity);
    }
    if (end > today) {
      break;
    }
    const plan = forecastBuckets(daily, origin, granularity, skip + count);
    const predicted = plan ? sum(plan.values.slice(skip)) : 0;
    if (predicted > 0) {
      const actual = sum(
        daysFrom(start, end).map((day) => daily.get(day) ?? 0),
      );
      ratios.push(actual / predicted);
    }
  }
  return ratios;
}

function rangeOf(ratios: number[]): ForecastRange | null {
  if (ratios.length < MINIMUM_ORIGINS) {
    return null;
  }
  const sorted = [...ratios].sort((a, b) => a - b);
  return {
    low: quantile(sorted, RANGE_QUANTILES.low),
    high: quantile(sorted, RANGE_QUANTILES.high),
  };
}

export function forecastRange(
  daily: DailyRevenue,
  today: string,
  granularity: Granularity,
  horizon: number,
): ForecastRange | null {
  return rangeOf(pastRatios(daily, today, granularity, 1, horizon));
}

export function bucketRange(
  daily: DailyRevenue,
  today: string,
  granularity: Granularity,
): ForecastRange | null {
  return rangeOf(pastRatios(daily, today, granularity, 0, 1));
}
