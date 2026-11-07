export type Granularity = "day" | "week" | "month";

export function toUtc(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

export function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function shiftDay(day: string, days: number): string {
  const date = toUtc(day);
  date.setUTCDate(date.getUTCDate() + days);
  return toDay(date);
}

export function shiftMonth(day: string, months: number): string {
  const date = toUtc(`${day.slice(0, 7)}-01`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return toDay(date);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86400000);
}

export function bucketKey(day: string, granularity: Granularity): string {
  if (granularity === "day") {
    return day;
  }
  if (granularity === "month") {
    return `${day.slice(0, 7)}-01`;
  }
  const weekday = (toUtc(day).getUTCDay() + 6) % 7;
  return shiftDay(day, -weekday);
}

export function nextKey(key: string, granularity: Granularity): string {
  if (granularity === "day") {
    return shiftDay(key, 1);
  }
  return granularity === "week" ? shiftDay(key, 7) : shiftMonth(key, 1);
}

export function bucketEnd(key: string, granularity: Granularity): string {
  return shiftDay(nextKey(key, granularity), -1);
}

export function bucketKeys(
  from: string,
  to: string,
  granularity: Granularity,
): string[] {
  const keys: string[] = [];
  let key = bucketKey(from, granularity);
  const last = bucketKey(to, granularity);
  while (key <= last) {
    keys.push(key);
    key = nextKey(key, granularity);
  }
  return keys;
}
