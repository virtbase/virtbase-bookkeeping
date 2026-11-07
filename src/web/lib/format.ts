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

const monthFormat = new Intl.DateTimeFormat("de-DE", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

export function formatMonth(month: string): string {
  return monthFormat.format(new Date(`${month}-01T00:00:00Z`));
}

export function shortenMiddle(text: string, head = 12, tail = 8): string {
  return text.length > head + tail + 1
    ? `${text.slice(0, head)}…${text.slice(-tail)}`
    : text;
}

export function formatBytes(bytes: number): string {
  const megabytes = bytes / 1048576;
  return `${megabytes.toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;
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

export function dateOfDay(day: string | null): Date | undefined {
  if (!day) {
    return undefined;
  }
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
}

export function dayOfDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatIsoRange(from: string, to: string | null): string {
  return !to || to === from
    ? formatIsoDay(from)
    : `${formatIsoDay(from)} – ${formatIsoDay(to)}`;
}
