const stamp = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const day = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function countLabel(
  count: number,
  singular: string,
  plural: string,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function rowLabel(count: number): string {
  return countLabel(count, "Zeile", "Zeilen");
}

export function formatStamp(unix: number): string {
  return stamp.format(new Date(unix * 1000)).replace(",", "");
}

const isoDayFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function isoDay(unix: number): string {
  return isoDayFormat.format(new Date(unix * 1000));
}

export function formatDay(unix: number): string {
  return day.format(new Date(unix * 1000));
}

export function formatIsoDay(value: string): string {
  const [year, month, date] = value.split("-");
  return `${date}.${month}.${year}`;
}

export function formatDayRange(first: number, last: number): string {
  const from = formatDay(first);
  const to = formatDay(last);
  return from === to ? from : `${from.slice(0, 6)}–${to}`;
}
