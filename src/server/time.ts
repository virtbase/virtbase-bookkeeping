export const ZONE = "Europe/Berlin";

const stampFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function localStamp(unix: number): string {
  return stampFormat.format(new Date(unix * 1000));
}

export function localDay(unix: number): string {
  return localStamp(unix).slice(0, 10);
}

export function germanDay(unix: number): string {
  const [year, month, day] = localDay(unix).split("-");
  return `${day}.${month}.${year}`;
}

function zoneOffsetSeconds(unix: number): number {
  const stamp = localStamp(unix).replace(" ", "T");
  return Date.parse(`${stamp}Z`) / 1000 - unix;
}

export function localMidnight(day: string): number {
  const utc = Date.parse(`${day}T00:00:00Z`) / 1000;
  const guess = utc - zoneOffsetSeconds(utc);
  return utc - zoneOffsetSeconds(guess);
}

export function localMinute(value: string): number {
  const utc = Date.parse(`${value}:00Z`) / 1000;
  const guess = utc - zoneOffsetSeconds(utc);
  return utc - zoneOffsetSeconds(guess);
}

export function monthStartUtc(month: string): number {
  return Date.parse(`${month}-01T00:00:00Z`) / 1000;
}

export function nextMonth(month: string): string {
  const [year = 0, value = 1] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value, 1));
  return date.toISOString().slice(0, 7);
}

export function monthOf(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 7);
}

export function lastDayOfMonth(month: string): string {
  const end = new Date(monthStartUtc(nextMonth(month)) * 1000 - 86400000);
  return end.toISOString().slice(0, 10);
}
