const euro = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatEuro(cents: number): string {
  return `${euro.format(Math.abs(cents) / 100)} €`;
}

export function formatSignedEuro(cents: number): string {
  const sign = cents < 0 ? "−" : cents > 0 ? "+" : "";
  return `${sign}${formatEuro(cents)}`;
}

export function plainAmount(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function formatPlainGerman(cents: number): string {
  return euro.format(Math.abs(cents) / 100);
}

export function parseEuroInput(value: string): number | null {
  const normalized = value.trim().replace(/\s|€/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }
  return Math.round(Number(normalized) * 100);
}

export function atomicToXmr(atomic: string): string {
  const padded = atomic.padStart(13, "0");
  const whole = padded.slice(0, -12);
  const fraction = padded.slice(-12);
  return `${whole}.${fraction.slice(0, 8)}`;
}
