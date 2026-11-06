import type { RateSource } from "../../shared/types.ts";

export interface Rate {
  eur: number;
  source: string;
  window: string;
}

export interface RateProvider {
  rateAt(unix: number): Promise<Rate | null>;
}

const WINDOWS_MINUTES = [30, 180, 720];
const LOOKUP_GAP_MS = 1100;

interface KrakenResponse {
  error: string[];
  result?: Record<string, unknown>;
}

function vwap(trades: [number, number][]): number | null {
  const volume = trades.reduce((sum, [, amount]) => sum + amount, 0);
  if (volume === 0) {
    return null;
  }
  return (
    trades.reduce((sum, [price, amount]) => sum + price * amount, 0) / volume
  );
}

export async function krakenRate(unix: number): Promise<Rate | null> {
  for (const minutes of WINDOWS_MINUTES) {
    const from = unix - minutes * 60;
    const to = unix + minutes * 60;
    const url = new URL("https://api.kraken.com/0/public/Trades");
    url.searchParams.set("pair", "XMREUR");
    url.searchParams.set("since", `${from}000000000`);
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as KrakenResponse;
    const entries = Object.entries(body.result ?? {}).find(
      ([key]) => key !== "last",
    );
    if (body.error.length > 0 || !entries) {
      return null;
    }
    const trades = (entries[1] as [string, string, number][])
      .filter(([, , time]) => time >= from && time <= to)
      .map(([price, amount]): [number, number] => [
        Number(price),
        Number(amount),
      ]);
    const eur = vwap(trades);
    if (eur !== null) {
      return { eur, source: "Kraken", window: `VWAP ±${minutes} min` };
    }
  }
  return null;
}

export async function coingeckoRate(unix: number): Promise<Rate | null> {
  const url = new URL(
    "https://api.coingecko.com/api/v3/coins/monero/market_chart/range",
  );
  url.searchParams.set("vs_currency", "eur");
  url.searchParams.set("from", String(unix - 6 * 3600));
  url.searchParams.set("to", String(unix + 6 * 3600));
  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as { prices?: [number, number][] };
  const nearest = (body.prices ?? []).reduce<[number, number] | null>(
    (best, entry) =>
      best === null ||
      Math.abs(entry[0] - unix * 1000) < Math.abs(best[0] - unix * 1000)
        ? entry
        : best,
    null,
  );
  return nearest
    ? { eur: nearest[1], source: "CoinGecko", window: "nächster Wert" }
    : null;
}

export function providerFor(source: RateSource): RateProvider {
  let nextLookupAt = 0;
  return {
    async rateAt(unix) {
      if (source === "manual") {
        return null;
      }
      const wait = nextLookupAt - Date.now();
      if (wait > 0) {
        await Bun.sleep(wait);
      }
      nextLookupAt = Date.now() + LOOKUP_GAP_MS;
      const primary =
        source === "auto" ? await krakenRate(unix).catch(() => null) : null;
      return primary ?? coingeckoRate(unix).catch(() => null);
    },
  };
}
